import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { MAP_PRESET_CATALOG_EXPERT_DATA } from '../src/core/config/maps/MapPresetCatalogExpertData.js';
import { CollisionResponseSystem } from '../src/entities/systems/CollisionResponseSystem.js';
import { PlayerCollisionPhase } from '../src/entities/systems/lifecycle/PlayerCollisionPhase.js';
import { SpawnPlacementSystem, resolveSpawnLookaheadDistance } from '../src/entities/systems/SpawnPlacementSystem.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

// Distance a vehicle covers while the spawn protection is still running. The heading
// picked at spawn has to stay clear for at least this far, because nothing resolves an
// arena contact before the timer expires.
const PROTECTED_TRAVEL = CONFIG_BASE.PLAYER.SPEED * CONFIG_BASE.PLAYER.BOOST_MULTIPLIER * Math.max(
    CONFIG_BASE.PLAYER.SPAWN_PROTECTION,
    CONFIG_BASE.HUNT.RESPAWN.INVULNERABILITY_SECONDS
);

// Seeded roll so a distribution assertion cannot flake on an unlucky run.
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Stands in for EntityManager: the spawn placement only reaches for the arena, the
 * player list, the seeded roll and the scratch vectors it borrows from its owner.
 */
function createSpawnOwner({ checkCollision = () => false, seed = 4711 } = {}) {
    return {
        arena: {
            bounds: { minX: -500, maxX: 500, minY: 0, maxY: 500, minZ: -500, maxZ: 500 },
            checkCollision,
        },
        players: [],
        humanPlayers: [],
        entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE),
        runtimeRng: { next: mulberry32(seed) },
        _tmpDir: new THREE.Vector3(),
        _tmpDir2: new THREE.Vector3(),
        _tmpVec: new THREE.Vector3(),
        _tmpVec2: new THREE.Vector3(),
    };
}

// Fine ray without the step width of the runtime probe, so the assertions measure the
// real corridor and not the rounding of the sampling.
function measureFreeDistance(checkCollision, origin, direction, maxDistance = 400) {
    const probe = new THREE.Vector3();
    let travelled = 0;
    while (travelled < maxDistance) {
        travelled += 0.5;
        probe.set(
            origin.x + direction.x * travelled,
            origin.y + direction.y * travelled,
            origin.z + direction.z * travelled
        );
        if (checkCollision(probe, 0.8)) return travelled - 0.5;
    }
    return maxDistance;
}

test('the spawn heading spreads over the open directions instead of always facing -Z', () => {
    const owner = createSpawnOwner();
    const system = new SpawnPlacementSystem(owner);
    const origin = new THREE.Vector3(0, 50, 0);
    const picks = new Map();

    // Open space: every sampled direction is equally free, so nothing but the tie break
    // decides. Whatever it picks must not be the same heading every single time.
    for (let i = 0; i < 240; i++) {
        const direction = system.findSafeSpawnDirection(origin, 0.8);
        const key = `${direction.x.toFixed(3)}|${direction.z.toFixed(3)}`;
        picks.set(key, (picks.get(key) || 0) + 1);
    }

    const strongest = Math.max(...picks.values());
    assert.ok(
        strongest <= 240 * 0.25,
        `no single heading may take more than a quarter of the spawns, saw ${strongest} of 240`
    );
    assert.ok(picks.size >= 8, `the tie break has to reach several headings, saw ${picks.size}`);
});

test('the spawn heading keeps room for the whole protected flight', () => {
    // A slab closes off -Z a little beyond the old 36 unit probe, while every other
    // direction stays open. The old probe stopped counting at 36 and could not tell the
    // dead end apart from the open corridor.
    const checkCollision = (position) => position.z <= -40;
    const owner = createSpawnOwner({ checkCollision });
    const system = new SpawnPlacementSystem(owner);
    const origin = new THREE.Vector3(0, 50, 0);

    const direction = system.findSafeSpawnDirection(origin, 0.8).clone();
    const free = measureFreeDistance(checkCollision, origin, direction);

    assert.ok(
        free >= PROTECTED_TRAVEL,
        `the heading has to stay clear for the ${PROTECTED_TRAVEL} units of the protected flight, saw ${free}`
    );
});

test('a spawn heading does not point the machine gun at an enemy that is already in the round', () => {
    const owner = createSpawnOwner();
    const system = new SpawnPlacementSystem(owner);
    const origin = new THREE.Vector3(0, 50, 0);
    const spawning = { index: 1, alive: true, position: new THREE.Vector3(300, 50, 300) };
    const range = CONFIG_BASE.HUNT.MG.RANGE;
    const aimDot = CONFIG_BASE.HUNT.MG.AIM_DOT_MIN;

    // Open space, so every heading is equally free. Whatever the tie break would pick,
    // an enemy sits right in front of it: on the maze this was the human at match start,
    // under fire from the first frame.
    for (let round = 0; round < 20; round++) {
        const probe = new SpawnPlacementSystem(createSpawnOwner());
        probe._spawnDirectionCursor = system._spawnDirectionCursor;
        const unguarded = probe.findSafeSpawnDirection(origin, 0.8).clone();
        const enemy = {
            index: 0,
            alive: true,
            position: origin.clone().addScaledVector(unguarded, range * 0.6),
        };
        owner.players = [enemy, spawning];

        const direction = system.findSafeSpawnDirection(origin, 0.8, spawning).clone();
        const toEnemy = enemy.position.clone().sub(origin).normalize();
        assert.ok(
            direction.dot(toEnemy) < aimDot,
            `round ${round}: the spawn heading aims at the enemy (dot ${direction.dot(toEnemy).toFixed(3)})`
        );
    }
});

test('an enemy in front never outweighs a wall right ahead', () => {
    // Only +X stays open; the enemy sits there too. Turning away from it would fly the
    // protected vehicle straight into a wall, which is worse than being aimed at.
    const checkCollision = (position) => position.x < 2;
    const owner = createSpawnOwner({ checkCollision });
    const system = new SpawnPlacementSystem(owner);
    const origin = new THREE.Vector3(3, 50, 0);
    const spawning = { index: 1, alive: true, position: new THREE.Vector3(-300, 50, 0) };
    owner.players = [
        { index: 0, alive: true, position: new THREE.Vector3(60, 50, 0) },
        spawning,
    ];

    const direction = system.findSafeSpawnDirection(origin, 0.8, spawning).clone();
    const free = measureFreeDistance(checkCollision, origin, direction);

    assert.ok(free >= PROTECTED_TRAVEL, `the heading has to stay clear, saw ${free}`);
});

/** Stands in for Player: the collision phase reads pose, hitbox and the damage entry. */
function createPlayerStub({ position = new THREE.Vector3() } = {}) {
    return {
        index: 0,
        isBot: false,
        alive: true,
        isGhost: false,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        hasShield: false,
        color: 0xffffff,
        hitboxRadius: 0.8,
        spawnProtectionTimer: 0,
        arenaCollisionGraceTimer: 0,
        wallDamageCooldown: 0,
        crashDamageCooldown: 0,
        baseSpeed: 45,
        speed: 45,
        velocity: new THREE.Vector3(0, 0, -45),
        position,
        quaternion: new THREE.Quaternion(),
        trail: { forceGap() {} },
        takeDamage(amount) {
            this.hp = Math.max(0, this.hp - amount);
            return { applied: amount, absorbedByShield: 0, remainingHp: this.hp, isDead: this.hp <= 0 };
        },
        getAimDirection(out) { return out.set(0, 0, -1); },
        getDirection(out) { return out.set(0, 0, -1); },
        refreshObbCollisionQuery() { return true; },
        markRenderDiscontinuity() {},
    };
}

/** Minimal EntityManager surface the collision phase touches. */
function createEntityManagerStub({ players = [], solidBox = null } = {}) {
    const events = [];
    const kills = [];
    const manager = {
        players,
        events,
        kills,
        audio: null,
        particles: null,
        _tmpVec: new THREE.Vector3(),
        _tmpVec2: new THREE.Vector3(),
        _tmpDir: new THREE.Vector3(),
        arena: {
            getCollisionInfo(point) {
                if (!solidBox || !solidBox.containsPoint(point)) return null;
                return { hit: true, kind: 'wall', isWall: true, normal: new THREE.Vector3(0, 0, 1) };
            },
            checkCollision(point) {
                return !!solidBox && solidBox.containsPoint(point);
            },
        },
        checkGlobalCollision: () => null,
        _emitHuntDamageEvent(event) { events.push(event); },
        _killPlayer(player, cause, options) {
            player.alive = false;
            kills.push({ player, cause, killer: options?.killer || null });
        },
        _bounceBot() {},
        _bouncePlayerOnFoam() {},
        _pushPlayerOutOfCollision() { return false; },
    };
    manager.constructor = { deriveSelfTrailSkipRecentSegments: () => 0 };
    return manager;
}

test('spawn lookahead accounts for the immediately available boost speed', () => {
    assert.equal(
        resolveSpawnLookaheadDistance(createEntityRuntimeConfig(null, CONFIG_BASE)),
        PROTECTED_TRAVEL
    );
});

test('a spawn protected vehicle is stopped at the wall instead of passing through it', () => {
    // Thin wall the vehicle crosses within one frame while its protection still runs.
    const wall = new THREE.Box3(
        new THREE.Vector3(-50, -50, -0.5),
        new THREE.Vector3(50, 50, 0.5)
    );
    const player = createPlayerStub({ position: new THREE.Vector3(0, 0, -6) });
    player.spawnProtectionTimer = CONFIG_BASE.HUNT.RESPAWN.INVULNERABILITY_SECONDS;
    const entityManager = createEntityManagerStub({ players: [player], solidBox: wall });
    const phase = new PlayerCollisionPhase(entityManager);
    const strategy = new HuntModeStrategy({
        entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE),
    });

    const died = phase.run(player, new THREE.Vector3(0, 0, 6), strategy);

    assert.equal(died, false);
    assert.equal(player.hp, 100, 'the protection still has to swallow the damage');
    assert.equal(entityManager.events.length, 0, 'no damage event may be billed while protected');
    assert.ok(
        player.position.z > 0.5,
        `the protection must not carry the vehicle through the wall, ended at z ${player.position.z}`
    );
});

test('a protected vehicle that cannot leave geometry receives no grace and is checked again', () => {
    const wall = new THREE.Box3(
        new THREE.Vector3(-50, -50, -50),
        new THREE.Vector3(50, 50, 50)
    );
    const player = createPlayerStub({ position: new THREE.Vector3(0, 0, 0) });
    player.spawnProtectionTimer = CONFIG_BASE.HUNT.RESPAWN.INVULNERABILITY_SECONDS;
    const entityManager = createEntityManagerStub({ players: [player], solidBox: wall });
    const phase = new PlayerCollisionPhase(entityManager);
    const strategy = new HuntModeStrategy({ entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE) });
    let collisionChecks = 0;
    const originalCollisionInfo = entityManager.arena.getCollisionInfo;
    entityManager.arena.getCollisionInfo = (point) => {
        collisionChecks += 1;
        return originalCollisionInfo(point);
    };

    // The embedded previous pose is far enough away to take the swept branch. It must not be
    // treated as a free pose just because the sweep has no free sample before the first hit.
    phase.run(player, new THREE.Vector3(0, 0, 10), strategy);
    assert.equal(player.arenaCollisionGraceTimer, 0);
    assert.equal(entityManager.arena.checkCollision(player.position, player.hitboxRadius), true);
    const firstChecks = collisionChecks;

    phase.run(player, player.position.clone(), strategy);
    assert.ok(collisionChecks > firstChecks, 'the next protected frame checks the unresolved wall again');
    assert.equal(player.arenaCollisionGraceTimer, 0);
});

test('every mega_maze wall in the row at z -30 offers a way through', () => {
    const megaMaze = MAP_PRESET_CATALOG_EXPERT_DATA.mega_maze;
    // The three wide walls of that row span the map across X. Two of them carry a tunnel;
    // a segment without one turns its corridor into a dead end for anything flying -Z.
    const row = megaMaze.obstacles.filter(
        (obstacle) => obstacle.pos[2] === -30 && obstacle.size[0] > obstacle.size[2]
    );

    assert.equal(row.length, 3, 'the row is expected to hold three wall segments');
    for (const segment of row) {
        assert.ok(
            segment.tunnel && Number(segment.tunnel.radius) > 0,
            `the segment at x ${segment.pos[0]} has to offer a way through`
        );
    }
});

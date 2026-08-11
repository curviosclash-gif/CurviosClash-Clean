import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';
import { ParticleSystem } from '../src/entities/Particles.js';
import { PlayerCollisionPhase } from '../src/entities/systems/lifecycle/PlayerCollisionPhase.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

const MAX_PARTICLES = 1000;

function createRendererStub() {
    return {
        addToScene() {},
        removeFromScene() {},
        getGraphicsStyle: () => 'classic',
    };
}

function createPlayerStub({ index = 0, position = new THREE.Vector3(), isBot = false } = {}) {
    return {
        index,
        isBot,
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
        // Standing still by default, so contacts resolve as the slow grinding case unless
        // a test gives the vehicle a velocity into the surface.
        velocity: new THREE.Vector3(),
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

// Minimal EntityManager surface the collision phase touches.
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

test('a full particle buffer recycles the oldest particles instead of dropping the burst', () => {
    const particles = new ParticleSystem(createRendererStub(), CONFIG_BASE);
    const position = new THREE.Vector3(1, 2, 3);

    // Saturate the buffer, then ask for one more explosion.
    particles.spawn(position, MAX_PARTICLES, 0x112233, 1, 1, 5);
    assert.equal(particles.count, MAX_PARTICLES);

    particles.spawnExplosion(new THREE.Vector3(9, 9, 9), 0xff0000);

    assert.equal(particles.count, MAX_PARTICLES);
    // The recycled slots have to carry the new burst's position, not the saturating one.
    assert.equal(particles.positions[0], 9);
    assert.equal(particles.positions[1], 9);
    assert.equal(particles.positions[2], 9);

    particles.dispose();
});

test('a swept arena probe catches a wall the end-of-frame pose has already passed', () => {
    // Thin wall the player jumps across within a single frame.
    const wall = new THREE.Box3(
        new THREE.Vector3(-50, -50, -0.5),
        new THREE.Vector3(50, 50, 0.5)
    );
    const player = createPlayerStub({ position: new THREE.Vector3(0, 0, -6) });
    const entityManager = createEntityManagerStub({ players: [player], solidBox: wall });
    const phase = new PlayerCollisionPhase(entityManager);
    const strategy = new HuntModeStrategy({
        entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE),
    });
    const prevPos = new THREE.Vector3(0, 0, 6);

    const died = phase.run(player, prevPos, strategy);

    assert.equal(died, false);
    assert.equal(player.hp, 80, 'wall damage has to be applied once');
    assert.ok(player.position.z > 0.5, 'player is pulled back to the last free sample');
    assert.equal(entityManager.events[0].cause, 'WALL');
});

test('wall damage is not billed again while the wall cooldown is still running', () => {
    const strategy = new HuntModeStrategy({
        entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE),
    });
    const player = createPlayerStub();
    const entityManager = createEntityManagerStub({ players: [player] });
    const collision = { normal: new THREE.Vector3(0, 0, 1) };

    assert.equal(strategy.handleWallCollision(player, collision, entityManager), false);
    assert.equal(player.hp, 80);
    assert.ok(player.wallDamageCooldown > 0);

    // Same crash, next frame: still inside the geometry, but no second damage tick.
    assert.equal(strategy.handleWallCollision(player, collision, entityManager), false);
    assert.equal(player.hp, 80);
    assert.equal(entityManager.events.length, 1);
});

test('a frontal wall impact at speed kills instead of billing the slow damage tick', () => {
    const strategy = new HuntModeStrategy({
        entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE),
    });
    const player = createPlayerStub();
    // Straight into the surface at full travel speed; the normal points into free space.
    player.velocity.set(0, 0, -45);
    const entityManager = createEntityManagerStub({ players: [player] });
    const collision = { normal: new THREE.Vector3(0, 0, 1) };

    assert.equal(strategy.handleWallCollision(player, collision, entityManager), true);
    assert.equal(player.hp, 0, 'a crash at speed has to stay lethal');
    assert.equal(entityManager.kills.length, 1);
    assert.equal(entityManager.kills[0].cause, 'WALL');
});

test('grinding along a wall keeps the slow tick instead of the crash damage', () => {
    const strategy = new HuntModeStrategy({
        entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE),
    });
    const player = createPlayerStub();
    // Full speed, but almost entirely parallel to the surface.
    player.velocity.set(45, 0, -1);
    const entityManager = createEntityManagerStub({ players: [player] });
    const collision = { normal: new THREE.Vector3(0, 0, 1) };

    assert.equal(strategy.handleWallCollision(player, collision, entityManager), false);
    assert.equal(player.hp, 80, 'scraping stays on the rate-limited tick');
    assert.equal(entityManager.kills.length, 0);
});

test('every arena bound reports a normal that points back into the arena', () => {
    const arenaCollision = new ArenaCollision({
        bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10, minZ: -10, maxZ: 10 },
    });
    const probes = [
        { point: new THREE.Vector3(-10, 0, 0), normal: [1, 0, 0] },
        { point: new THREE.Vector3(10, 0, 0), normal: [-1, 0, 0] },
        { point: new THREE.Vector3(0, -10, 0), normal: [0, 1, 0] },
        { point: new THREE.Vector3(0, 10, 0), normal: [0, -1, 0] },
        { point: new THREE.Vector3(0, 0, -10), normal: [0, 0, 1] },
        { point: new THREE.Vector3(0, 0, 10), normal: [0, 0, -1] },
    ];

    for (const probe of probes) {
        const info = arenaCollision.getCollisionInfo(probe.point, 0.5);
        assert.equal(info?.hit, true, `bound at ${probe.point.toArray()} has to report a hit`);
        assert.deepEqual(
            info.normal.toArray(),
            probe.normal,
            `bound at ${probe.point.toArray()} has to push back into the arena`
        );
    }
});

test('an arena collision grace suspends the wall check without disarming trails', () => {
    const wall = new THREE.Box3(
        new THREE.Vector3(-50, -50, -50),
        new THREE.Vector3(50, 50, 50)
    );
    const player = createPlayerStub();
    player.arenaCollisionGraceTimer = 0.16;
    const entityManager = createEntityManagerStub({ players: [player], solidBox: wall });
    const phase = new PlayerCollisionPhase(entityManager);
    const strategy = new HuntModeStrategy({
        entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE),
    });

    const died = phase.run(player, player.position.clone(), strategy);

    assert.equal(died, false);
    assert.equal(player.hp, 100, 'the grace has to suppress the arena hit');
    assert.equal(entityManager.events.length, 0);
});

test('two colliding vehicles both take PLAYER_CRASH damage exactly once', () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const strategy = new HuntModeStrategy({ entityRuntimeConfig });
    const player = createPlayerStub({ index: 0, position: new THREE.Vector3(0, 0, 0) });
    const other = createPlayerStub({ index: 1, position: new THREE.Vector3(0.5, 0, 0) });
    const entityManager = createEntityManagerStub({ players: [player, other] });
    const phase = new PlayerCollisionPhase(entityManager);

    const died = phase.run(player, player.position.clone(), strategy);

    assert.equal(died, false);
    assert.equal(player.hp, 60);
    assert.equal(other.hp, 60);
    assert.ok(player.crashDamageCooldown > 0);
    assert.ok(other.crashDamageCooldown > 0);

    // The mirrored check on the other vehicle must not resolve the same crash again.
    assert.equal(phase.run(other, other.position.clone(), strategy), false);
    assert.equal(player.hp, 60);
    assert.equal(other.hp, 60);
    assert.equal(entityManager.events.length, 2);
});

test('a lethal vehicle crash credits the other vehicle as the killer', () => {
    const strategy = new ArcadeModeStrategy();
    const player = createPlayerStub({ index: 0 });
    const other = createPlayerStub({ index: 1 });
    player.hp = 10;
    const entityManager = createEntityManagerStub({ players: [player, other] });

    const died = strategy.handlePlayerCrash(
        player,
        other,
        new THREE.Vector3(1, 0, 0),
        entityManager
    );

    assert.equal(died, true);
    assert.equal(entityManager.kills.length, 1);
    assert.equal(entityManager.kills[0].cause, 'PLAYER_CRASH');
    assert.equal(entityManager.kills[0].killer, other);
});

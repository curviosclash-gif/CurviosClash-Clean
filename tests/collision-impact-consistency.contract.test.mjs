import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';
import { ParticleSystem } from '../src/entities/Particles.js';
import { PlayerCollisionPhase } from '../src/entities/systems/lifecycle/PlayerCollisionPhase.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { applyHit } from '../src/entities/combat/CombatPipeline.js';
import { HuntScoring } from '../src/hunt/HuntScoring.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { ClassicModeStrategy } from '../src/modes/ClassicModeStrategy.js';
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
        _applyModeDamage(player, amount, cause, options = {}) {
            return applyHit(this, { ...options, target: player, amount, cause });
        },
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
    entityManager.gameModeStrategy = strategy;
    const prevPos = new THREE.Vector3(0, 0, 6);

    const died = phase.run(player, prevPos, strategy);

    assert.equal(died, false);
    assert.equal(player.hp, 80, 'wall damage has to be applied once');
    assert.ok(player.position.z > 0.5, 'player is pulled back to the last free sample');
    assert.equal(entityManager.events[0].cause, 'WALL');
});

test('an extended vehicle probe reports its offset for minimal wall resolution', () => {
    const wall = new THREE.Box3(
        new THREE.Vector3(-50, -50, -0.5),
        new THREE.Vector3(50, 50, 0.5)
    );
    const player = createPlayerStub({ position: new THREE.Vector3(0, 0, 4) });
    const entityManager = createEntityManagerStub({ players: [player], solidBox: wall });
    const phase = new PlayerCollisionPhase(entityManager);
    let seenCollision = null;
    const strategy = {
        handleWallCollision(_player, collision) {
            seenCollision = collision;
            return false;
        },
        handlePlayerCrash() { return false; },
    };

    assert.equal(phase.run(player, player.position.clone(), strategy), false);
    assert.equal(seenCollision?.responseHasProbe, true);
    assert.equal(seenCollision?.responseAlreadySeparated, false);
    assert.equal(seenCollision?.responseProbeOffsetZ, -4);
});

test('wall damage is not billed again while the wall cooldown is still running', () => {
    const strategy = new HuntModeStrategy({
        entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE),
    });
    const player = createPlayerStub();
    const entityManager = createEntityManagerStub({ players: [player] });
    entityManager.gameModeStrategy = strategy;
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
    entityManager.gameModeStrategy = strategy;
    const collision = { normal: new THREE.Vector3(0, 0, 1) };

    assert.equal(strategy.handleWallCollision(player, collision, entityManager), true);
    assert.equal(player.hp, 0, 'a crash at speed has to stay lethal');
    assert.equal(entityManager.kills.length, 1);
    assert.equal(entityManager.kills[0].cause, 'WALL');
});

test('Classic wall and trail deaths use the shared hit boundary while shields still absorb contact', () => {
    const strategy = new ClassicModeStrategy();
    const player = createPlayerStub();
    const shielded = createPlayerStub({ index: 1 });
    shielded.hasShield = true;
    shielded.shieldHP = 1;
    const entityManager = createEntityManagerStub({ players: [player, shielded] });
    entityManager.gameModeStrategy = strategy;
    const kill = entityManager._killPlayer;
    entityManager._killPlayer = (target, cause, options) => {
        target.alive = false;
        target.hp = 0;
        kill(target, cause, options);
    };
    const collision = { normal: new THREE.Vector3(0, 0, 1) };

    assert.equal(strategy.handleWallCollision(player, collision, entityManager), true);
    assert.equal(player.hp, 0);
    assert.equal(player.alive, false);
    assert.equal(entityManager.events.length, 1);
    assert.equal(entityManager.events[0].cause, 'WALL');
    assert.equal(entityManager.kills.length, 1);
    assert.equal(entityManager.kills[0].cause, 'WALL');
    assert.equal(entityManager.kills[0].killer, null);

    assert.equal(strategy.handleWallCollision(shielded, collision, entityManager), false);
    assert.equal(shielded.alive, true);
    assert.equal(shielded.hasShield, false);
    assert.equal(shielded.shieldHP, 1, 'Classic keeps its existing single-contact shield representation');
    assert.equal(entityManager.events.length, 1, 'shield contact creates no damage event');
    assert.equal(entityManager.kills.length, 1, 'shield contact creates no death');

    const trailVictim = createPlayerStub({ index: 2 });
    const trailSource = createPlayerStub({ index: 3 });
    entityManager.players.push(trailVictim, trailSource);
    assert.equal(strategy.handleTrailCollision(
        trailVictim, collision, 'TRAIL_OTHER', trailSource, entityManager
    ), true);
    assert.equal(trailVictim.alive, false);
    assert.equal(entityManager.events.length, 2);
    assert.equal(entityManager.events[1].cause, 'TRAIL_OTHER');
    assert.equal(entityManager.events[1].sourcePlayer, null, 'Classic trail kills retain no kill-credit source');
    assert.equal(entityManager.kills.length, 2);
    assert.equal(entityManager.kills[1].killer, null);
});

test('Classic crash hits both vehicles before finalizing deaths and keeps team credit policy', () => {
    const strategy = new ClassicModeStrategy();
    const player = createPlayerStub({ index: 0 });
    const other = createPlayerStub({ index: 1 });
    player.teamId = 'ALPHA';
    other.teamId = 'BRAVO';
    const entityManager = createEntityManagerStub({ players: [player, other] });
    entityManager.gameModeStrategy = strategy;
    const hpAtDeath = [];
    const kill = entityManager._killPlayer;
    entityManager._killPlayer = (target, cause, options) => {
        hpAtDeath.push([player.hp, other.hp]);
        target.alive = false;
        kill(target, cause, options);
    };

    assert.equal(strategy.handlePlayerCrash(player, other, new THREE.Vector3(1, 0, 0), entityManager), true);
    assert.equal(player.alive, false);
    assert.equal(other.alive, false);
    assert.equal(entityManager.events.length, 2, 'one pipeline event for each side');
    assert.deepEqual(hpAtDeath, [[0, 0], [0, 0]], 'both mode hits land before either death callback');
    assert.deepEqual(entityManager.kills.map(({ player: victim, cause, killer }) => ({
        victim: victim.index,
        cause,
        killer: killer?.index ?? null,
    })), [
        { victim: 1, cause: 'PLAYER_CRASH', killer: 0 },
        { victim: 0, cause: 'PLAYER_CRASH', killer: 1 },
    ]);

    const protectedPlayer = createPlayerStub({ index: 4 });
    const exposedPlayer = createPlayerStub({ index: 5 });
    protectedPlayer.hasShield = true;
    protectedPlayer.shieldHP = 1;
    const shieldManager = createEntityManagerStub({ players: [protectedPlayer, exposedPlayer] });
    shieldManager.gameModeStrategy = strategy;
    const shieldKill = shieldManager._killPlayer;
    shieldManager._killPlayer = (target, cause, options) => {
        target.alive = false;
        target.hp = 0;
        shieldKill(target, cause, options);
    };
    assert.equal(strategy.handlePlayerCrash(
        protectedPlayer, exposedPlayer, new THREE.Vector3(1, 0, 0), shieldManager
    ), false, 'the shielded initiating player survives the collision');
    assert.equal(protectedPlayer.alive, true);
    assert.equal(protectedPlayer.hasShield, false);
    assert.equal(exposedPlayer.alive, false);
    assert.ok(protectedPlayer.crashDamageCooldown > 0 && exposedPlayer.crashDamageCooldown > 0);
    assert.equal(shieldManager.events.length, 1, 'only the unshielded contact publishes damage');
    assert.equal(shieldManager.kills.length, 1);
    assert.equal(shieldManager.kills[0].killer, protectedPlayer, 'Classic preserves the survivor as the killer');

    const teammate = createPlayerStub({ index: 2 });
    const otherTeammate = createPlayerStub({ index: 3 });
    teammate.teamId = 'ALPHA';
    otherTeammate.teamId = 'ALPHA';
    const teamManager = createEntityManagerStub({ players: [teammate, otherTeammate] });
    teamManager.gameModeStrategy = strategy;
    assert.equal(strategy.handlePlayerCrash(
        teammate, otherTeammate, new THREE.Vector3(1, 0, 0), teamManager
    ), true);
    assert.equal(teamManager.events.length, 2);
    assert.deepEqual(teamManager.kills.map(({ killer }) => killer), [null, null]);
});

test('grinding along a wall keeps the slow tick instead of the crash damage', () => {
    const strategy = new HuntModeStrategy({
        entityRuntimeConfig: createEntityRuntimeConfig(null, CONFIG_BASE),
    });
    const player = createPlayerStub();
    // Full speed, but almost entirely parallel to the surface.
    player.velocity.set(45, 0, -1);
    const entityManager = createEntityManagerStub({ players: [player] });
    entityManager.gameModeStrategy = strategy;
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
    entityManager.gameModeStrategy = strategy;

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
    entityManager.gameModeStrategy = strategy;
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
    entityManager.gameModeStrategy = strategy;

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

test('a lethal enemy crash credits both opposing pilots after both hits land', () => {
    const strategy = new HuntModeStrategy();
    const player = createPlayerStub({ index: 0 });
    const other = createPlayerStub({ index: 1 });
    player.teamId = 'ALPHA';
    other.teamId = 'BRAVO';
    player.hp = 10;
    other.hp = 10;
    const entityManager = createEntityManagerStub({ players: [player, other] });
    entityManager.gameModeStrategy = strategy;
    entityManager._applyModeDamage = EntityManager.prototype._applyModeDamage;
    const scoring = new HuntScoring(() => 12);
    entityManager._huntScoring = scoring;
    const killPlayer = entityManager._killPlayer;
    entityManager._killPlayer = (target, cause, options) => {
        killPlayer(target, cause, options);
        scoring.registerElimination(target, { killer: options?.killer || null, spawnAgeSeconds: 100 });
    };

    assert.equal(strategy.handlePlayerCrash(player, other, new THREE.Vector3(1, 0, 0), entityManager), true);

    assert.equal(player.hp, 0);
    assert.equal(other.hp, 0);
    assert.deepEqual(entityManager.kills.map(({ player: victim, killer }) => [victim.index, killer?.index]), [
        [1, 0],
        [0, 1],
    ]);
    const scoreRows = scoring.getScoreboard([player, other]);
    assert.deepEqual(scoreRows.map(({ playerIndex, kills }) => [playerIndex, kills]), [[0, 1], [1, 1]]);
});

test('a lethal team crash damages both vehicles but gives neither teammate kill credit', () => {
    const strategy = new HuntModeStrategy();
    const player = createPlayerStub({ index: 0 });
    const other = createPlayerStub({ index: 1 });
    player.teamId = 'ALPHA';
    other.teamId = 'ALPHA';
    player.hp = 10;
    other.hp = 10;
    const entityManager = createEntityManagerStub({ players: [player, other] });
    entityManager.gameModeStrategy = strategy;
    entityManager._applyModeDamage = EntityManager.prototype._applyModeDamage;
    const scoring = new HuntScoring(() => 12);
    entityManager._huntScoring = scoring;
    const hpWhenEachDeathWasFinalized = [];
    const killPlayer = entityManager._killPlayer;
    entityManager._killPlayer = (target, cause, options) => {
        hpWhenEachDeathWasFinalized.push([player.hp, other.hp]);
        killPlayer(target, cause, options);
        scoring.registerElimination(target, { killer: options?.killer || null, spawnAgeSeconds: 100 });
    };

    assert.equal(strategy.handlePlayerCrash(player, other, new THREE.Vector3(1, 0, 0), entityManager), true);

    assert.equal(player.hp, 0);
    assert.equal(other.hp, 0);
    assert.equal(entityManager.events.length, 2, 'both collision hits are reported once');
    assert.equal(entityManager.kills.length, 2);
    assert.deepEqual(hpWhenEachDeathWasFinalized, [[0, 0], [0, 0]], 'both crash hits land before the first death is finalized');
    assert.deepEqual(entityManager.kills.map(({ player: victim, cause, killer }) => ({
        victim: victim.index,
        cause,
        killer: killer?.index ?? null,
    })), [
        { victim: 1, cause: 'PLAYER_CRASH', killer: null },
        { victim: 0, cause: 'PLAYER_CRASH', killer: null },
    ]);
    const scoreRows = scoring.getScoreboard([player, other]);
    assert.deepEqual(scoreRows.map(({ playerIndex, kills }) => [playerIndex, kills]), [[0, 0], [1, 0]]);
    assert.deepEqual(scoreRows.map(({ playerIndex, deaths }) => [playerIndex, deaths]), [[0, 1], [1, 1]]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
    normalizeExclusionZoneOpenFaces,
    resolveMapExclusionZone,
} from '../src/shared/contracts/ExclusionZoneContract.js';
import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';
import {
    EXCLUSION_ZONE_PHASES,
    ExclusionZoneSystem,
} from '../src/entities/systems/ExclusionZoneSystem.js';
import { ProjectileHitResolver } from '../src/entities/systems/projectile/ProjectileHitResolver.js';
import { createGameStateSnapshot } from '../src/core/GameStateSnapshot.js';
import { updateReplayProjection } from '../src/core/recording/CinematicReplayProjection.js';
import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { createMatchRuntimePlayerProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';
import { applyEnvironmentProjectileDamage } from '../src/entities/runtime/EntityRuntimeSupportAssembly.js';
import { ClassicModeStrategy } from '../src/modes/ClassicModeStrategy.js';
import { EntityManager } from '../src/entities/EntityManager.js';
import { StateReconciler } from '../src/network/StateReconciler.js';
import { ProjectileSimulationOps } from '../src/entities/systems/projectile/ProjectileSimulationOps.js';

function createArena(openFaces = []) {
    const arena = {
        bounds: { minX: -10, maxX: 10, minY: 0, maxY: 20, minZ: -10, maxZ: 10 },
        openFaces,
        obstacles: [],
        staticCollisionRevision: 0,
    };
    arena.collision = new ArenaCollision(arena);
    return arena;
}

function createPlayer(index = 0, options = {}) {
    return {
        index,
        alive: options.alive !== false,
        isBot: options.isBot === true,
        isGhost: options.isGhost === true,
        spawnProtectionTimer: Number(options.spawnProtectionTimer) || 0,
        hitboxRadius: 1,
        position: new THREE.Vector3(0, 5, 0),
        velocity: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        hp: 100,
        speed: 20,
        score: 0,
        inventory: [],
        activeEffects: [],
        hasShield: false,
        shieldHP: 0,
    };
}

function createZoneHarness(playerCount = 1) {
    const arena = createArena(['maxX']);
    arena.checkWorldGeometryCollision = (position, radius) => arena.collision.checkWorldGeometryCollision(position, radius);
    const players = Array.from({ length: playerCount }, (_, index) => createPlayer(index));
    const projectiles = [];
    const projectileSystem = {
        spawnExternalProjectile(options) {
            const projectile = {
                ...options,
                position: options.position.clone(),
                direction: options.direction.clone(),
                active: true,
            };
            projectiles.push(projectile);
            return projectile;
        },
        trimZoneProjectiles(targetPlayerIndex, targetLimit, globalLimit) {
            const removeOldest = (entries, limit) => {
                while (entries.length > limit) {
                    const oldest = entries.shift();
                    projectiles.splice(projectiles.indexOf(oldest), 1);
                }
            };
            removeOldest(projectiles.filter((entry) => entry.targetPlayerIndex === targetPlayerIndex), targetLimit);
            removeOldest([...projectiles], globalLimit);
        },
    };
    const manager = { arena, players, audio: { play() {} } };
    return { manager, players, projectiles, system: new ExclusionZoneSystem(manager, { projectileSystem }) };
}

test('open-face contract normalizes order, duplicates and invalid values while default stays closed', () => {
    assert.deepEqual(normalizeExclusionZoneOpenFaces(), []);
    assert.deepEqual(normalizeExclusionZoneOpenFaces(['maxY', 'maxX', 'maxX', 'minY', '', 4]), ['maxX', 'maxY']);
    assert.deepEqual(resolveMapExclusionZone({}).openFaces, []);
});

test('physical boundary opens only authored faces while floor, closed faces and authored geometry remain solid', () => {
    const arena = createArena(['maxX', 'maxY']);
    arena.obstacles.push({
        box: new THREE.Box3(new THREE.Vector3(13, 3, -2), new THREE.Vector3(16, 8, 2)),
        kind: 'hard',
        isWall: false,
    });

    assert.equal(arena.collision.checkCollisionFast(new THREE.Vector3(11.5, 5, 0), 1), false);
    assert.equal(arena.collision.checkCollisionFast(new THREE.Vector3(-11.5, 5, 0), 1), true);
    assert.equal(arena.collision.checkCollisionFast(new THREE.Vector3(0, -1.5, 0), 1), true);
    assert.equal(arena.collision.checkCollisionFast(new THREE.Vector3(0, 21.5, 0), 1), false);
    assert.equal(arena.collision.checkCollisionFast(new THREE.Vector3(14, 5, 0), 1), true);
    assert.equal(arena.collision.checkBotCollisionFast(new THREE.Vector3(11.5, 5, 0), 1), true);
});

test('zone enters after fully crossing, grants exactly ten seconds and escalates deterministic salvos', () => {
    const { players, projectiles, system } = createZoneHarness();
    const player = players[0];
    player.position.x = 12;

    system.update(9.999);
    assert.equal(player.exclusionZoneState.phase, EXCLUSION_ZONE_PHASES.GRACE);
    assert.equal(projectiles.length, 0);
    system.update(0.001);
    assert.equal(player.exclusionZoneState.phase, EXCLUSION_ZONE_PHASES.SALVO);
    assert.equal(player.exclusionZoneState.stage, 'WEAK');
    assert.equal(projectiles.length, 4);
    assert.ok(projectiles.every((projectile) => projectile.targetPlayerIndex === 0
        && projectile.targetReacquireDisabled
        && projectile.ignoresTrails
        && projectile.ignoresTurrets));

    system.update(10);
    assert.equal(player.exclusionZoneState.stage, 'MEDIUM');
    assert.equal(projectiles.length, 12);
    system.update(10);
    assert.equal(player.exclusionZoneState.stage, 'HEAVY');
    assert.equal(projectiles.length, 12);
});

test('hysteresis resets only after a clear return and re-entry starts a fresh countdown', () => {
    const { players, projectiles, system } = createZoneHarness();
    const player = players[0];
    player.position.x = 12;
    system.update(10);
    assert.equal(projectiles.length, 4);

    player.position.x = 10.8;
    system.update(0.1);
    assert.equal(player.exclusionZoneState.phase, EXCLUSION_ZONE_PHASES.SALVO);
    player.position.x = 10.5;
    system.update(0.1);
    assert.equal(player.exclusionZoneState.phase, EXCLUSION_ZONE_PHASES.SAFE);

    player.position.x = 12;
    system.update(1);
    assert.equal(player.exclusionZoneState.phase, EXCLUSION_ZONE_PHASES.GRACE);
    assert.equal(player.exclusionZoneState.countdownSeconds, 9);
});

test('bots, ghosts, dead and spawn-protected players never trigger salvos and reset cleanly', () => {
    for (const options of [
        { isBot: true },
        { isGhost: true },
        { alive: false },
        { spawnProtectionTimer: 1 },
    ]) {
        const { players, projectiles, system } = createZoneHarness();
        Object.assign(players[0], options);
        players[0].position.x = 12;
        system.update(40);
        assert.equal(players[0].exclusionZoneState.phase, EXCLUSION_ZONE_PHASES.SAFE);
        assert.equal(projectiles.length, 0);
        system.reset();
        assert.equal(system.states.size, 0);
    }
});

test('non-finite positions recover to the last finite position without becoming a gameplay death boundary', () => {
    const { players, system } = createZoneHarness();
    const player = players[0];
    player.position.set(4, 5, 6);
    system.update(0.1);
    player.position.x = Number.NaN;
    system.update(0.1);
    assert.deepEqual(player.position.toArray(), [4, 5, 6]);
    assert.equal(player.alive, true);
});

test('environment projectile hit filter damages only its fixed target and skips area systems', () => {
    const target = createPlayer(2);
    const bystander = createPlayer(3);
    target.position.set(0, 0, 0);
    bystander.position.set(0, 0, 0);
    const damaged = [];
    const system = {
        _tmpVec: new THREE.Vector3(),
        applyEnvironmentDamage(player) { damaged.push(player.index); },
        onProjectileHit() {},
        getTurrets() { throw new Error('turret query must be skipped'); },
    };
    const resolver = new ProjectileHitResolver(system);
    const projectile = {
        type: 'ROCKET_WEAK',
        owner: { environment: true },
        position: new THREE.Vector3(0, 0, 0),
        previousPosition: new THREE.Vector3(0, 0, 0),
        radius: 1,
        environmentProjectile: true,
        targetPlayerIndex: 2,
        ignoresTrails: true,
        ignoresTurrets: true,
        detonated: false,
        mesh: { position: new THREE.Vector3() },
    };
    const removed = resolver.resolveProjectileOutcome(projectile, [bystander, target], {
        querySphere() { throw new Error('trail query must be skipped'); },
    }, { projectileExpired: false, projectileHitArena: false, bouncedOnFoam: false });
    assert.equal(removed, true);
    assert.deepEqual(damaged, [2]);
});

test('fixed environment target never reacquires a closer bystander', () => {
    const fixedTarget = createPlayer(0);
    const bystander = createPlayer(1);
    fixedTarget.alive = false;
    fixedTarget.position.set(30, 5, 0);
    bystander.position.set(2, 5, 0);
    const ops = new ProjectileSimulationOps({});
    ops.acquireHomingTarget = () => { throw new Error('fixed target must not reacquire'); };
    const projectile = {
        position: new THREE.Vector3(0, 5, 0),
        previousPosition: new THREE.Vector3(0, 5, 0),
        velocity: new THREE.Vector3(20, 0, 0),
        radius: 0.5,
        ttl: 2,
        traveled: 0,
        huntRocket: true,
        homingEnabled: true,
        homingReacquireTimer: 0,
        target: fixedTarget,
        targetReacquireDisabled: true,
        foamBounceCooldown: 0,
        mesh: { position: new THREE.Vector3(), lookAt() {} },
    };
    ops.stepProjectile(projectile, 0, 0.01, null, [fixedTarget, bystander], null, 0);
    assert.equal(projectile.target, fixedTarget);
});

test('environment damage consumes one shield hit and then delegates lethal Classic damage', () => {
    const target = createPlayer(0);
    target.hasShield = true;
    target.shieldHP = 1;
    const strategy = new ClassicModeStrategy();
    const owner = {
        gameModeStrategy: strategy,
        _simulationClockMs: 2500,
        _emitHuntDamageEvent() {},
        _killPlayer(player, cause) { player.alive = false; player.deathCause = cause; },
    };
    owner._applyModeDamage = EntityManager.prototype._applyModeDamage;
    const projectile = { type: 'ROCKET_HEAVY', position: new THREE.Vector3(1, 2, 3) };

    const shielded = applyEnvironmentProjectileDamage(owner, target, projectile);
    assert.equal(shielded.absorbedByShield, 1);
    assert.equal(target.alive, true);
    assert.equal(target.hasShield, false);

    strategy.resetPlayerHealth(target);
    const unshielded = applyEnvironmentProjectileDamage(owner, target, projectile);
    assert.equal(unshielded.isDead, true);
    assert.equal(target.alive, false);
    assert.equal(target.deathCause, 'EXCLUSION_ZONE');
});

test('snapshots add zone state and target binding without changing the established player schema', () => {
    const player = createPlayer(0);
    player.exclusionZoneState = { phase: 'GRACE', elapsedSeconds: 3.25, countdownSeconds: 7, stage: '' };
    const projectile = {
        active: true,
        id: 'zone-1',
        position: new THREE.Vector3(1, 2, 3),
        velocity: new THREE.Vector3(4, 5, 6),
        ttl: 2,
        radius: 1,
        type: 'ROCKET_WEAK',
        environmentProjectile: true,
        targetPlayerIndex: 0,
        zoneProjectile: true,
    };
    const snapshot = createGameStateSnapshot({ players: [player], projectiles: [projectile] }, null);
    assert.deepEqual(snapshot.players[0].exclusionZone, {
        phase: 'GRACE', elapsedSeconds: 3.25, countdownSeconds: 7, stage: '',
    });
    assert.equal(snapshot.projectiles[0].targetPlayerIndex, 0);
    assert.equal(snapshot.projectiles[0].environmentProjectile, true);
    const ordinarySnapshot = createGameStateSnapshot({
        players: [player],
        projectiles: [{ ...projectile, environmentProjectile: false, zoneProjectile: false }],
    }, null);
    assert.equal('environmentProjectile' in ordinarySnapshot.projectiles[0], false);
    assert.ok(JSON.stringify(snapshot).length < 2048);
});

test('parallel intruders keep independent deterministic salvos and disconnected state is pruned', () => {
    const first = createZoneHarness(2);
    const second = createZoneHarness(2);
    for (const harness of [first, second]) {
        harness.players[0].position.x = 12;
        harness.players[1].position.x = 13;
        harness.system.update(10);
        assert.equal(harness.projectiles.filter((entry) => entry.targetPlayerIndex === 0).length, 4);
        assert.equal(harness.projectiles.filter((entry) => entry.targetPlayerIndex === 1).length, 4);
    }
    assert.deepEqual(
        first.projectiles.map((entry) => entry.position.toArray()),
        second.projectiles.map((entry) => entry.position.toArray()),
    );
    first.manager.players.splice(1, 1);
    first.system.update(0.1);
    assert.equal(first.system.states.has(1), false);
});

test('zone projectile caps hold per intruder and globally under sustained parallel salvos', () => {
    const { players, projectiles, system } = createZoneHarness(6);
    for (const player of players) player.position.x = 12 + player.index;
    system.update(40);
    assert.equal(projectiles.length, 64);
    for (const player of players) {
        assert.ok(projectiles.filter((entry) => entry.targetPlayerIndex === player.index).length <= 12);
    }
});

test('replay projection preserves the discrete exclusion-zone phase for HUD playback', () => {
    const projection = { players: [], localPlayerIndex: 0 };
    const left = createGameStateSnapshot({ players: [createPlayer(0)], projectiles: [] }, null);
    const rightPlayer = createPlayer(0);
    rightPlayer.exclusionZoneState = { phase: 'SALVO', elapsedSeconds: 22, countdownSeconds: 0, stage: 'MEDIUM' };
    const right = createGameStateSnapshot({ players: [rightPlayer], projectiles: [] }, null);
    updateReplayProjection(projection, left, right, 0.75, {});
    assert.deepEqual(projection.players[0].exclusionZoneState, {
        phase: 'SALVO', elapsedSeconds: 22, countdownSeconds: 0, stage: 'MEDIUM',
    });
});

test('local HUD projection preserves authoritative countdown state', () => {
    const projected = createMatchRuntimePlayerProjection({
        playerIndex: 0,
        exclusionZoneState: { phase: 'GRACE', elapsedSeconds: 4.1, countdownSeconds: 6, stage: '' },
    });
    assert.deepEqual(projected.exclusionZoneState, {
        phase: 'GRACE', elapsedSeconds: 4.1, countdownSeconds: 6, stage: '',
    });
});

test('client reconciliation restores zone status after reconnect without client simulation', () => {
    const player = createPlayer(0);
    const manager = { players: [player], applyNetworkSnapshot() {} };
    manager._exclusionZoneSystem = new ExclusionZoneSystem(manager);
    manager._exclusionZoneSystem.setNetworkReplica(true);
    const reconciler = new StateReconciler({
        positionSnapThreshold: 0,
        rotationSnapThreshold: 0,
        velocitySnapThreshold: 0,
    });
    reconciler.receiveServerState({ state: { players: [{
        index: 0,
        alive: true,
        pos: [0, 5, 0],
        rot: [0, 0, 0, 1],
        vel: [0, 0, 0],
        exclusionZone: { phase: 'SALVO', elapsedSeconds: 31, countdownSeconds: 0, stage: 'HEAVY' },
    }] } });
    reconciler.reconcile([player], manager);
    assert.deepEqual(player.exclusionZoneState, {
        phase: 'SALVO', elapsedSeconds: 31, countdownSeconds: 0, stage: 'HEAVY',
    });
    assert.equal(manager._exclusionZoneSystem.networkReplica, true);
});

test('curated outdoor variants share identical open-face lists and unmarked maps stay closed', () => {
    const allFaces = ['minX', 'maxX', 'minZ', 'maxZ', 'maxY'];
    for (const key of [
        'sky_islands',
        'aetherion_orrery',
        'eiffel_tower',
        'eiffel_tower_arena',
        'burg_falkenwacht',
        'burg_falkenwacht_arena',
        'notre_dame',
        'notre_dame_arena',
        'notre_dame_fire',
        'notre_dame_fire_arena',
        'verdant_aperture',
    ]) {
        assert.deepEqual(resolveMapExclusionZone(MAP_PRESET_CATALOG[key]).openFaces, allFaces, key);
    }
    assert.deepEqual(resolveMapExclusionZone(MAP_PRESET_CATALOG.standard).openFaces, []);
    assert.deepEqual(resolveMapExclusionZone(MAP_PRESET_CATALOG.custom).openFaces, []);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { ProjectileSystem } from '../src/entities/systems/ProjectileSystem.js';
import { ProjectileSimulationOps } from '../src/entities/systems/projectile/ProjectileSimulationOps.js';
import {
    createPlayerTargetDescriptor,
    isPlayerTargetDescriptor,
    isTrailTargetDescriptor,
    resolveHuntTargetPosition,
} from '../src/hunt/HuntTargetingOps.js';
import { HUNT_TARGET_KIND } from '../src/shared/contracts/HuntTargetingContract.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

function createRuntimeConfig(overrides = {}) {
    return {
        POWERUP: { TYPES: {} },
        PLAYER: { HITBOX_RADIUS: 0.8 },
        HOMING: {
            TURN_RATE: 3,
            LOCK_ON_ANGLE: 30,
            MAX_LOCK_RANGE: 100,
            LEAD_TIME_MAX: 0.5,
            TURN_DOT_BLEND: 0.35,
        },
        PROJECTILE: {
            SPEED: 60,
            RADIUS: 0.5,
            LIFE_TIME: 2,
            MAX_DISTANCE: 200,
        },
        HUNT: {
            MG: {
                RANGE: 95,
                TRAIL_SAMPLE_STEP: 0.45,
                TRAIL_HIT_RADIUS: 0.78,
                TRAIL_SELF_SKIP_RECENT: 8,
            },
            ROCKET: {
                HOMING_MIN_RANGE: 10,
                HOMING_MIN_LOCK_ON_ANGLE: 5,
                HOMING_MIN_TURN_RATE: 0.1,
                HOMING_MIN_REACQUIRE_INTERVAL: 0.04,
                HOMING_REACQUIRE_INTERVAL: 0.08,
                HOMING_SPEED_EPSILON: 0.0001,
                HOMING_LEAD_TIME_MAX: 0.5,
                HOMING_FALLBACK_ANGLE_SCALE: 1.75,
                HOMING_FALLBACK_ANGLE_MAX: 90,
                HOMING_TRAIL_PRIORITY_RATIO: 0.85,
                HOMING_TURN_DOT_BLEND: 0.35,
                ...(overrides.ROCKET || {}),
            },
            TARGETING: {},
        },
        ...overrides,
    };
}

function createOps(config = createRuntimeConfig()) {
    return new ProjectileSimulationOps({ entityRuntimeConfig: config });
}

function createPlayer({ index, position, velocity = [0, 0, 0], alive = true } = {}) {
    return {
        index,
        alive,
        position: new THREE.Vector3(...position),
        velocity: new THREE.Vector3(...velocity),
        hitboxRadius: 0.8,
    };
}

function createProjectile({
    owner,
    position,
    velocity,
    huntRocket = true,
    homingRange = 100,
    homingLockOnAngle = 30,
    homingTurnRate = 8,
    radius = 0.5,
} = {}) {
    return {
        owner,
        position: new THREE.Vector3(...position),
        velocity: new THREE.Vector3(...velocity),
        huntRocket,
        homingRange,
        homingLockOnAngle,
        homingTurnRate,
        radius,
        target: null,
        mesh: {
            position: new THREE.Vector3(...position),
            lookAt() {},
        },
        flame: null,
        ttl: 2,
        traveled: 0,
        foamBounceCooldown: 0,
        previousPosition: new THREE.Vector3(...position),
    };
}

test('hunt homing does not lock a player behind the rocket outside the fallback cone', () => {
    const ops = createOps();
    const owner = createPlayer({ index: 0, position: [0, 0, 0] });
    const behind = createPlayer({ index: 1, position: [-20, 0, 0] });
    const projectile = createProjectile({
        owner,
        position: [0, 0, 0],
        velocity: [60, 0, 0],
        homingLockOnAngle: 30,
    });

    const target = ops.acquireHomingTarget(projectile, [owner, behind], null);
    assert.equal(target, null);
});

test('hunt homing locks a player inside the primary cone', () => {
    const ops = createOps();
    const owner = createPlayer({ index: 0, position: [0, 0, 0] });
    const ahead = createPlayer({ index: 1, position: [25, 2, 0] });
    const projectile = createProjectile({
        owner,
        position: [0, 0, 0],
        velocity: [60, 0, 0],
        homingLockOnAngle: 30,
    });

    const target = ops.acquireHomingTarget(projectile, [owner, ahead], null);
    assert.ok(target);
    assert.equal(isPlayerTargetDescriptor(target), true);
    assert.equal(target.playerIndex, 1);
});

function createTrailIndexAt(distanceX) {
    const entry = {
        playerIndex: 1,
        segmentIdx: 0,
        destroyed: false,
        fromX: distanceX - 0.4,
        fromY: 0,
        fromZ: 0,
        toX: distanceX + 0.4,
        toY: 0,
        toZ: 0,
        radius: 0.5,
    };
    return {
        resolveTrailEntry(playerIndex, segmentIdx) {
            if (playerIndex === 1 && segmentIdx === 0) return entry;
            return null;
        },
        checkProjectileTrailCollision(probe) {
            const dx = Number(probe?.x) - distanceX;
            if (Math.abs(dx) > 0.55 || Math.abs(probe?.y || 0) > 0.55 || Math.abs(probe?.z || 0) > 0.55) {
                return null;
            }
            return {
                entry,
                closestPoint: {
                    closestX: distanceX,
                    closestY: 0,
                    closestZ: 0,
                },
            };
        },
    };
}

test('hunt homing prefers cone player over a barely-closer trail line hit', () => {
    const ops = createOps();
    const owner = createPlayer({ index: 0, position: [0, 0, 0] });
    const enemy = createPlayer({ index: 1, position: [30, 0, 0] });
    const projectile = createProjectile({
        owner,
        position: [0, 0, 0],
        velocity: [60, 0, 0],
        homingLockOnAngle: 40,
    });

    const target = ops.acquireHomingTarget(
        projectile,
        [owner, enemy],
        createTrailIndexAt(28)
    );
    assert.ok(target);
    assert.equal(isPlayerTargetDescriptor(target), true);
    assert.equal(target.playerIndex, 1);
});

test('hunt homing keeps clearly closer trail line hits', () => {
    const ops = createOps();
    const owner = createPlayer({ index: 0, position: [0, 0, 0] });
    const enemy = createPlayer({ index: 1, position: [30, 0, 0] });
    const projectile = createProjectile({
        owner,
        position: [0, 0, 0],
        velocity: [60, 0, 0],
        homingLockOnAngle: 40,
    });

    const target = ops.acquireHomingTarget(
        projectile,
        [owner, enemy],
        createTrailIndexAt(12)
    );
    assert.ok(target);
    assert.equal(isTrailTargetDescriptor(target), true);
    assert.equal(target.playerIndex, 1);
});

test('homing steering applies lead toward moving player targets', () => {
    const ops = createOps();
    const owner = createPlayer({ index: 0, position: [0, 0, 0] });
    const enemy = createPlayer({
        index: 1,
        position: [40, 0, 0],
        velocity: [0, 0, 20],
    });
    const projectile = createProjectile({
        owner,
        position: [0, 0, 0],
        velocity: [60, 0, 0],
        huntRocket: true,
        homingTurnRate: 20,
    });
    projectile.target = createPlayerTargetDescriptor(enemy, 40);
    projectile.homingReacquireTimer = 1;

    const beforeVz = projectile.velocity.z;
    ops.stepProjectile(projectile, 0, 0.05, null, [owner, enemy], null, 0);

    assert.ok(
        projectile.velocity.z > beforeVz,
        `expected positive lead steer on Z, got vz=${projectile.velocity.z}`
    );
});

test('all fired hunt items acquire and pursue targets without becoming rockets', () => {
    const entityRuntimeConfig = createEntityRuntimeConfig(null, CONFIG_BASE);
    const owner = {
        index: 0,
        alive: true,
        position: new THREE.Vector3(0, 0, 0),
        shootCooldown: 0,
        getAimDirection(out) {
            return out.set(1, 0, 0);
        },
    };
    const target = createPlayer({ index: 1, position: [30, 0, 6] });
    const players = [owner, target];
    const projectiles = new ProjectileSystem({
        entityRuntimeConfig,
        players,
        arena: {
            getCollisionInfo() {
                return null;
            },
        },
        peekInventoryItem: () => ({ ok: true, type: 'SLOW_DOWN' }),
        takeInventoryItem: () => ({ ok: true, type: 'SLOW_DOWN' }),
        resolveLockOn: () => null,
        getStrategy: () => new HuntModeStrategy({ entityRuntimeConfig }),
    });

    const shot = projectiles.shootItemProjectile(owner, 0);
    assert.equal(shot.ok, true);
    assert.equal(projectiles.projectiles.length, 1);

    const projectile = projectiles.projectiles[0];
    assert.equal(projectile.homingEnabled, true);
    assert.equal(projectile.huntRocket, false);
    assert.equal(isPlayerTargetDescriptor(projectile.target), true);
    assert.equal(projectile.target.playerIndex, target.index);

    const beforeVz = projectile.velocity.z;
    projectiles.update(1 / 60);
    assert.ok(
        projectile.velocity.z > beforeVz,
        `expected fired hunt item to steer toward target, got vz=${projectile.velocity.z}`
    );
    assert.equal(projectile.rocketTrailHandle, null);

    projectiles.dispose();
});

test('resolveHuntTargetPosition uses live trail midpoint', () => {
    const descriptor = {
        kind: HUNT_TARGET_KIND.TRAIL,
        playerIndex: 1,
        segmentIdx: 3,
        distance: 12,
        point: { x: 1, y: 0, z: 1 },
        position: { x: 1, y: 0, z: 1 },
        alive: true,
    };
    const entry = {
        playerIndex: 1,
        segmentIdx: 3,
        destroyed: false,
        fromX: 10,
        fromY: 2,
        fromZ: 4,
        toX: 14,
        toY: 2,
        toZ: 8,
        radius: 0.5,
    };
    const trailSpatialIndex = {
        resolveTrailEntry(playerIndex, segmentIdx) {
            if (playerIndex === 1 && segmentIdx === 3) return entry;
            return null;
        },
    };

    const out = new THREE.Vector3();
    // Frozen point is far from segment → drift reject
    const rejected = resolveHuntTargetPosition(descriptor, [], trailSpatialIndex, out, {
        maxPointDrift: 1.25,
    });
    assert.equal(rejected, null);

    // Point near segment → live midpoint of current entry
    descriptor.point = { x: 12, y: 2, z: 6 };
    const resolved = resolveHuntTargetPosition(descriptor, [], trailSpatialIndex, out, {
        maxPointDrift: 1.25,
    });
    assert.ok(resolved);
    assert.ok(Math.abs(resolved.x - 12) < 1e-6);
    assert.ok(Math.abs(resolved.y - 2) < 1e-6);
    assert.ok(Math.abs(resolved.z - 6) < 1e-6);
});

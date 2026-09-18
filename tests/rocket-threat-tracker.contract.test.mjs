import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

import { ProjectileStatePool } from '../src/entities/systems/projectile/ProjectileStatePool.js';
import { ProjectileSimulationOps } from '../src/entities/systems/projectile/ProjectileSimulationOps.js';
import { RocketThreatTracker } from '../src/entities/systems/projectile/RocketThreatTracker.js';
import { createPlayerTargetDescriptor, createTrailTargetDescriptor } from '../src/hunt/HuntTargetingOps.js';

/**
 * Minimal runtime config: the tracker only needs the warning range, the simulation
 * ops need the homing block they already read today.
 */
function createRuntimeConfig({ warningRange = 140 } = {}) {
    const rocket = {
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
    };
    if (Number.isFinite(warningRange)) rocket.WARNING_RANGE = warningRange;
    return {
        POWERUP: { TYPES: {} },
        PLAYER: { HITBOX_RADIUS: 0.8 },
        HOMING: { TURN_RATE: 3, LOCK_ON_ANGLE: 30, MAX_LOCK_RANGE: 100, LEAD_TIME_MAX: 0.5 },
        PROJECTILE: { SPEED: 60, RADIUS: 0.5, LIFE_TIME: 2, MAX_DISTANCE: 200 },
        HUNT: {
            MG: { RANGE: 95, TRAIL_SAMPLE_STEP: 0.45, TRAIL_HIT_RADIUS: 0.78, TRAIL_SELF_SKIP_RECENT: 8 },
            ROCKET: rocket,
            TARGETING: {},
        },
    };
}

function createTracker(config = createRuntimeConfig()) {
    return new RocketThreatTracker({ entityRuntimeConfig: config });
}

function createPlayer({ index, position = [0, 0, 0], alive = true } = {}) {
    return {
        index,
        alive,
        position: new THREE.Vector3(...position),
        velocity: new THREE.Vector3(),
        hitboxRadius: 0.8,
    };
}

/** Stands for a pooled projectile state: only the fields the tracker reads. */
function createRocket({
    owner = null,
    position = [0, 0, 0],
    velocity = [0, 0, 0],
    lockedPlayerIndex = -1,
    type = 'ROCKET_WEAK',
    traversalId = 'projectile:1',
    environmentProjectile = false,
    zoneProjectile = false,
} = {}) {
    return {
        owner,
        type,
        traversalId,
        lockedPlayerIndex,
        environmentProjectile,
        zoneProjectile,
        position: new THREE.Vector3(...position),
        velocity: new THREE.Vector3(...velocity),
    };
}

/** Stands for a projectile inside stepProjectile: mesh and previousPosition are required there. */
function createSteppedProjectile({ owner, position = [0, 0, 0], velocity = [60, 0, 0], target = null } = {}) {
    return {
        owner,
        type: 'ROCKET_WEAK',
        target,
        position: new THREE.Vector3(...position),
        previousPosition: new THREE.Vector3(...position),
        velocity: new THREE.Vector3(...velocity),
        radius: 0.5,
        ttl: 2,
        traveled: 0,
        maxDistance: 200,
        huntRocket: true,
        homingEnabled: true,
        homingRange: 100,
        homingLockOnAngle: 30,
        homingTurnRate: 8,
        homingReacquireInterval: 0.08,
        homingReacquireTimer: 1,
        targetReacquireDisabled: true,
        foamBounceCooldown: 0,
        lockedPlayerIndex: -1,
        flame: null,
        mesh: { position: new THREE.Vector3(...position), lookAt() {} },
    };
}

test('a rocket locked on a player raises that player\'s threat', () => {
    const tracker = createTracker();
    const hunter = createPlayer({ index: 0, position: [100, 0, 0] });
    const prey = createPlayer({ index: 1, position: [0, 0, 0] });
    const rocket = createRocket({ owner: hunter, position: [30, 0, 0], velocity: [-45, 0, 0], lockedPlayerIndex: 1 });

    tracker.update([rocket], [hunter, prey]);

    const threat = tracker.getThreat(1);
    assert.equal(threat.active, true, 'the hunted player is warned');
    assert.equal(threat.count, 1);
    assert.ok(Math.abs(threat.nearestDistance - 30) < 0.001, 'the distance is the real gap');
    assert.ok(Math.abs(threat.direction.x - 1) < 0.001, 'the direction points from the player to the rocket');
    assert.ok(Math.abs(threat.timeToImpactSeconds - (30 / 45)) < 0.01);
    assert.equal(threat.nearestProjectileId, 'projectile:1');
    assert.equal(threat.nearestSource, 'player');
    assert.equal(tracker.getThreat(0).active, false, 'the shooter is not warned');
});

test('a rocket chasing a trail never warns a player', () => {
    const tracker = createTracker();
    const hunter = createPlayer({ index: 0, position: [100, 0, 0] });
    const prey = createPlayer({ index: 1, position: [0, 0, 0] });
    // A trail-seeking rocket keeps lockedPlayerIndex at -1 (see stepProjectile).
    const rocket = createRocket({ owner: hunter, position: [10, 0, 0], velocity: [-45, 0, 0], lockedPlayerIndex: -1 });

    tracker.update([rocket], [hunter, prey]);

    assert.equal(tracker.getThreat(1).active, false);
    assert.equal(tracker.getThreat(1).count, 0);
});

test('a player is never warned about a rocket they fired themselves', () => {
    const tracker = createTracker();
    const shooter = createPlayer({ index: 0, position: [0, 0, 0] });
    const rocket = createRocket({ owner: shooter, position: [10, 0, 0], velocity: [-45, 0, 0], lockedPlayerIndex: 0 });

    tracker.update([rocket], [shooter]);

    assert.equal(tracker.getThreat(0).active, false, 'own rockets are no threat');
});

test('a rocket beyond the warning range stays silent', () => {
    const tracker = createTracker();
    const hunter = createPlayer({ index: 0, position: [500, 0, 0] });
    const prey = createPlayer({ index: 1, position: [0, 0, 0] });
    const rocket = createRocket({ owner: hunter, position: [141, 0, 0], velocity: [-45, 0, 0], lockedPlayerIndex: 1 });

    tracker.update([rocket], [hunter, prey]);
    assert.equal(tracker.getThreat(1).active, false, '141 is outside the 140 range');

    rocket.position.set(139, 0, 0);
    tracker.update([rocket], [hunter, prey]);
    assert.equal(tracker.getThreat(1).active, true, '139 is inside the 140 range');
});

test('the warning range falls back to 140 when the config omits it', () => {
    const tracker = createTracker(createRuntimeConfig({ warningRange: null }));
    const hunter = createPlayer({ index: 0, position: [500, 0, 0] });
    const prey = createPlayer({ index: 1, position: [0, 0, 0] });
    const rocket = createRocket({ owner: hunter, position: [139, 0, 0], velocity: [-45, 0, 0], lockedPlayerIndex: 1 });

    tracker.update([rocket], [hunter, prey]);
    assert.equal(tracker.getThreat(1).active, true);

    rocket.position.set(141, 0, 0);
    tracker.update([rocket], [hunter, prey]);
    assert.equal(tracker.getThreat(1).active, false);
});

test('two rockets are counted and the nearer one drives the warning', () => {
    const tracker = createTracker();
    const hunter = createPlayer({ index: 0, position: [100, 0, 0] });
    const prey = createPlayer({ index: 1, position: [0, 0, 0] });
    const far = createRocket({
        owner: hunter, position: [30, 0, 0], velocity: [-45, 0, 0], lockedPlayerIndex: 1, traversalId: 'projectile:1',
    });
    const near = createRocket({
        owner: hunter, position: [0, 0, 10], velocity: [0, 0, -45], lockedPlayerIndex: 1, traversalId: 'projectile:2',
    });

    tracker.update([far, near], [hunter, prey]);

    const threat = tracker.getThreat(1);
    assert.equal(threat.count, 2);
    assert.ok(Math.abs(threat.nearestDistance - 10) < 0.001);
    assert.equal(threat.nearestProjectileId, 'projectile:2');
    assert.ok(Math.abs(threat.direction.z - 1) < 0.001, 'the arrow points at the nearer rocket');
});

test('a released projectile state forgets its lock', () => {
    const pool = new ProjectileStatePool();
    const projectile = pool.acquire();
    assert.equal(projectile.lockedPlayerIndex, -1, 'a fresh state starts without a lock');

    projectile.lockedPlayerIndex = 3;
    pool.release(projectile);
    assert.equal(projectile.lockedPlayerIndex, -1, 'a recycled state never carries a stale lock');

    assert.equal(pool.acquire().lockedPlayerIndex, -1);
});

test('stepProjectile records the locked player and clears it for trail targets', () => {
    const ops = new ProjectileSimulationOps({ entityRuntimeConfig: createRuntimeConfig() });
    const owner = createPlayer({ index: 0, position: [0, 0, 0] });
    const prey = createPlayer({ index: 1, position: [40, 0, 0] });
    const players = [owner, prey];

    const withPlayerObject = createSteppedProjectile({ owner, position: [0, 0, 0], target: prey });
    ops.stepProjectile(withPlayerObject, 0, 0.016, null, players, null, 0);
    assert.equal(withPlayerObject.lockedPlayerIndex, 1, 'a plain player target counts as a lock');

    const withDescriptor = createSteppedProjectile({
        owner,
        position: [0, 0, 0],
        target: createPlayerTargetDescriptor(prey, 40),
    });
    ops.stepProjectile(withDescriptor, 0, 0.016, null, players, null, 0);
    assert.equal(withDescriptor.lockedPlayerIndex, 1, 'a player target descriptor counts as a lock');

    const trailTarget = createTrailTargetDescriptor({ playerIndex: 1, segmentIdx: 0, destroyed: false });
    const withTrail = createSteppedProjectile({ owner, position: [0, 0, 0], target: trailTarget });
    withTrail.lockedPlayerIndex = 1;
    ops.stepProjectile(withTrail, 0, 0.016, null, players, null, 0);
    assert.equal(withTrail.lockedPlayerIndex, -1, 'a trail target is no player lock');

    const withoutTarget = createSteppedProjectile({ owner, position: [0, 0, 0], target: null });
    withoutTarget.lockedPlayerIndex = 1;
    ops.stepProjectile(withoutTarget, 0, 0.016, null, players, null, 0);
    assert.equal(withoutTarget.lockedPlayerIndex, -1, 'no target means no lock');

    const deadPrey = createPlayer({ index: 1, position: [40, 0, 0], alive: false });
    const withDeadTarget = createSteppedProjectile({
        owner,
        position: [0, 0, 0],
        target: createPlayerTargetDescriptor(prey, 40),
    });
    withDeadTarget.lockedPlayerIndex = 1;
    ops.stepProjectile(withDeadTarget, 0, 0.016, null, [owner, deadPrey], null, 0);
    assert.equal(withDeadTarget.lockedPlayerIndex, -1, 'a dead target is no threat');
});

test('repeated updates reuse the same threat object', () => {
    const tracker = createTracker();
    const hunter = createPlayer({ index: 0, position: [100, 0, 0] });
    const prey = createPlayer({ index: 1, position: [0, 0, 0] });
    const rocket = createRocket({ owner: hunter, position: [30, 0, 0], velocity: [-45, 0, 0], lockedPlayerIndex: 1 });

    tracker.update([rocket], [hunter, prey]);
    const first = tracker.getThreat(1);
    const firstDirection = first.direction;
    for (let i = 0; i < 500; i += 1) {
        tracker.update([rocket], [hunter, prey]);
    }

    assert.equal(tracker.getThreat(1), first, 'the same threat object is handed out every frame');
    assert.equal(tracker.getThreat(1).direction, firstDirection, 'the direction vector is reused too');

    tracker.clear();
    assert.equal(tracker.getThreat(1).active, false, 'clear() drops every warning');
});

test('the threat names where the rocket came from', () => {
    const tracker = createTracker();
    const hunter = createPlayer({ index: 0, position: [100, 0, 0] });
    const prey = createPlayer({ index: 1, position: [0, 0, 0] });
    const players = [hunter, prey];

    tracker.update(
        [createRocket({ owner: hunter, position: [20, 0, 0], velocity: [-45, 0, 0], lockedPlayerIndex: 1 })],
        players
    );
    assert.equal(tracker.getThreat(1).nearestSource, 'player');

    const turretOwner = { staticTurret: true, position: new THREE.Vector3(60, 0, 0) };
    tracker.update(
        [createRocket({
            owner: turretOwner,
            position: [20, 0, 0],
            velocity: [-45, 0, 0],
            lockedPlayerIndex: 1,
            environmentProjectile: true,
        })],
        players
    );
    assert.equal(tracker.getThreat(1).nearestSource, 'turret');

    tracker.update(
        [createRocket({
            owner: null,
            position: [20, 0, 0],
            velocity: [-45, 0, 0],
            lockedPlayerIndex: 1,
            environmentProjectile: true,
            zoneProjectile: true,
        })],
        players
    );
    assert.equal(tracker.getThreat(1).nearestSource, 'zone', 'the exclusion zone is its own source');
});

test('item projectiles never raise a rocket warning', () => {
    const tracker = createTracker();
    const hunter = createPlayer({ index: 0, position: [100, 0, 0] });
    const prey = createPlayer({ index: 1, position: [0, 0, 0] });
    const swap = createRocket({
        owner: hunter,
        position: [10, 0, 0],
        velocity: [-45, 0, 0],
        lockedPlayerIndex: 1,
        type: 'SWAP',
    });

    tracker.update([swap], [hunter, prey]);

    assert.equal(tracker.getThreat(1).active, false, 'only rocket tiers warn');
});

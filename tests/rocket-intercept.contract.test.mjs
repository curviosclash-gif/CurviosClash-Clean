import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

import { ProjectileStatePool } from '../src/entities/systems/projectile/ProjectileStatePool.js';
import { ProjectileSimulationOps } from '../src/entities/systems/projectile/ProjectileSimulationOps.js';
import { RocketThreatTracker } from '../src/entities/systems/projectile/RocketThreatTracker.js';
import { shootPlayerItemProjectile } from '../src/entities/systems/projectile/PlayerProjectileFireOps.js';
import {
    findProjectileByTraversalId,
    pickWeakestRocketIndex,
    resolveInterceptTargetId,
} from '../src/entities/systems/projectile/RocketInterceptOps.js';

/** The runtime blocks the fire path and the simulation actually read. */
function createRuntimeConfig() {
    return {
        POWERUP: {
            MAX_INVENTORY: 5,
            TYPES: {
                ROCKET_WEAK: { color: 0xff0000, damage: 10 },
                ROCKET_MEDIUM: { color: 0xff5500, damage: 20 },
                ROCKET_HEAVY: { color: 0xffaa00, damage: 30 },
                ROCKET_MEGA: { color: 0xffff00, damage: 45 },
                SWAP: { color: 0x00ffff, damage: 0 },
            },
        },
        PLAYER: { HITBOX_RADIUS: 0.8 },
        HOMING: { TURN_RATE: 3, LOCK_ON_ANGLE: 30, MAX_LOCK_RANGE: 100, LEAD_TIME_MAX: 0.5 },
        PROJECTILE: { SPEED: 60, RADIUS: 0.5, LIFE_TIME: 2, MAX_DISTANCE: 400, COOLDOWN: 0.5 },
        HUNT: {
            MG: { RANGE: 95, TRAIL_SAMPLE_STEP: 0.45, TRAIL_HIT_RADIUS: 0.78, TRAIL_SELF_SKIP_RECENT: 8 },
            ROCKET: {
                WARNING_RANGE: 140,
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
            },
            TARGETING: { PROJECTILE_SPAWN_OFFSET: 2.2 },
        },
    };
}

function createPlayer({ index, position = [0, 0, 0], alive = true, rocketInventory = [], inventory = [] } = {}) {
    const player = {
        index,
        alive,
        position: new THREE.Vector3(...position),
        velocity: new THREE.Vector3(),
        hitboxRadius: 0.8,
        quaternion: new THREE.Quaternion(),
        shootCooldown: 0,
        selectedItemIndex: 0,
        activeEffects: {},
        inventory: inventory.slice(),
        rocketInventory: rocketInventory.slice(),
        getAimDirection(out) {
            return out.set(1, 0, 0);
        },
    };
    return player;
}

function createFakeMesh() {
    return {
        scale: { setScalar() {} },
        position: new THREE.Vector3(),
        lookAt() {},
        userData: {},
    };
}

const EMPTY_THREAT = Object.freeze({
    active: false,
    count: 0,
    nearestDistance: 0,
    timeToImpactSeconds: 0,
    direction: { x: 0, y: 0, z: 0 },
    nearestProjectileId: '',
    nearestSource: '',
    nearestInterceptableId: '',
    nearestInterceptableDistance: 0,
});

/** A stand-in for ProjectileSystem with exactly the members the fire path uses. */
function createFireSystem({
    config = createRuntimeConfig(),
    players = [],
    threat = EMPTY_THREAT,
    lockOnTarget = null,
    fallbackTarget = null,
    inventoryItem = null,
} = {}) {
    const pool = new ProjectileStatePool();
    let nextTraversalId = 1;
    return {
        entityRuntimeConfig: config,
        projectiles: [],
        meshTypes: [],
        shotTypes: [],
        _tmpDir: new THREE.Vector3(),
        _tmpVec: new THREE.Vector3(),
        _tmpVec2: new THREE.Vector3(),
        _tmpFanRight: new THREE.Vector3(),
        _tmpFanAxis: new THREE.Vector3(),
        _tmpFanDirection: new THREE.Vector3(),
        _rocketTrailSystem: { initializeProjectile() {} },
        getStrategy: () => ({
            getPickupModeType: () => 'HUNT',
            resolveRocketProjectileParams: (type) => (String(type).startsWith('ROCKET_')
                ? {
                    visualScale: 1,
                    collisionRadiusMultiplier: 1,
                    homingTurnRate: 8,
                    homingLockOnAngle: 30,
                    homingRange: 120,
                    homingReacquireInterval: 0.08,
                }
                : null),
        }),
        getPlayers: () => players,
        getTrailSpatialIndex: () => null,
        getRocketThreat: () => threat,
        resolveLockOn: () => lockOnTarget,
        peekInventoryItem: () => (inventoryItem
            ? { ok: true, code: 'ITEM_SHOOT_SUCCESS', type: inventoryItem }
            : { ok: false, code: 'ITEM_SHOOT_EMPTY' }),
        takeInventoryItem: () => (inventoryItem
            ? { ok: true, code: 'ITEM_SHOOT_SUCCESS', type: inventoryItem }
            : { ok: false, code: 'ITEM_SHOOT_EMPTY' }),
        _acquireProjectileMesh(type) {
            this.meshTypes.push(type);
            return createFakeMesh();
        },
        _acquireProjectileState() {
            const projectile = pool.acquire();
            projectile.traversalId = `projectile:${nextTraversalId += 1}`;
            return projectile;
        },
        _acquireHomingTarget: () => fallbackTarget,
        onShoot(player, type) {
            this.shotTypes.push(type);
        },
    };
}

function threatWith({ nearestProjectileId, nearestSource = 'player', nearestInterceptableId = nearestProjectileId }) {
    return {
        ...EMPTY_THREAT,
        active: true,
        count: 1,
        nearestDistance: 30,
        nearestProjectileId,
        nearestSource,
        nearestInterceptableId,
        nearestInterceptableDistance: 30,
    };
}

/** A pooled rocket state as stepProjectile sees it. */
function createSteppedRocket({
    owner = null,
    position = [0, 0, 0],
    velocity = [60, 0, 0],
    target = null,
    traversalId = 'projectile:9',
} = {}) {
    return {
        owner,
        type: 'ROCKET_WEAK',
        target,
        traversalId,
        position: new THREE.Vector3(...position),
        previousPosition: new THREE.Vector3(...position),
        velocity: new THREE.Vector3(...velocity),
        radius: 0.5,
        ttl: 5,
        traveled: 0,
        maxDistance: 400,
        huntRocket: true,
        homingEnabled: true,
        homingRange: 120,
        homingLockOnAngle: 30,
        homingTurnRate: 8,
        homingReacquireInterval: 0.08,
        homingReacquireTimer: 0,
        targetReacquireDisabled: false,
        foamBounceCooldown: 0,
        lockedPlayerIndex: -1,
        isInterceptor: false,
        interceptTargetId: '',
        flame: null,
        mesh: { position: new THREE.Vector3(...position), lookAt() {} },
    };
}

test('a threatened player turns the fired rocket into an interceptor', () => {
    const shooter = createPlayer({ index: 0, rocketInventory: ['ROCKET_WEAK'] });
    const hunter = createPlayer({ index: 1, position: [60, 0, 0] });
    const system = createFireSystem({
        players: [shooter, hunter],
        threat: threatWith({ nearestProjectileId: 'projectile:42' }),
        lockOnTarget: hunter,
    });

    const result = shootPlayerItemProjectile(system, shooter, -1, true);

    assert.equal(result.ok, true);
    assert.equal(system.projectiles.length, 1);
    const fired = system.projectiles[0];
    assert.equal(fired.isInterceptor, true, 'the rocket defends instead of attacking');
    assert.equal(fired.interceptTargetId, 'projectile:42', 'it carries the id of the chasing rocket');
    assert.equal(fired.target, null, 'an interceptor never holds a player target');
    assert.equal(fired.lockedPlayerIndex, -1, 'an interceptor threatens nobody');
});

test('an interceptor leaves towards the chasing rocket and passes through trails', () => {
    // The shooter looks along +X; the rocket hunting it comes from behind, along -X.
    const shooter = createPlayer({ index: 0, rocketInventory: ['ROCKET_WEAK'] });
    const system = createFireSystem({
        players: [shooter],
        threat: { ...threatWith({ nearestProjectileId: 'projectile:42' }), direction: { x: -1, y: 0, z: 0 } },
    });

    const result = shootPlayerItemProjectile(system, shooter, -1, true);

    assert.equal(result.ok, true);
    const fired = system.projectiles[0];
    assert.equal(fired.isInterceptor, true);
    assert.ok(fired.velocity.x < 0, `the defence rocket must leave backwards, got vx=${fired.velocity.x}`);
    assert.ok(fired.position.x < shooter.position.x, 'and it spawns behind the vehicle, on its way');
    // Its way back leads straight through the own trail, so trails must not stop it.
    assert.equal(fired.ignoresTrails, true, 'an interceptor flies through trails');
});

test('an unthreatened player fires a normal homing rocket', () => {
    const shooter = createPlayer({ index: 0, rocketInventory: ['ROCKET_MEGA', 'ROCKET_WEAK'] });
    const hunter = createPlayer({ index: 1, position: [60, 0, 0] });
    const system = createFireSystem({ players: [shooter, hunter], lockOnTarget: hunter });

    const result = shootPlayerItemProjectile(system, shooter, -1, true);

    assert.equal(result.ok, true);
    const fired = system.projectiles[0];
    assert.equal(fired.isInterceptor, false);
    assert.equal(fired.interceptTargetId, '');
    assert.equal(fired.target, hunter, 'the normal lock-on still wins');
    assert.equal(fired.type, 'ROCKET_MEGA', 'without a threat the front rocket flies');
    assert.deepEqual(shooter.rocketInventory, ['ROCKET_WEAK']);
});

test('a zone rocket alone never bends the shot, a player rocket next to it does', () => {
    const shooter = createPlayer({ index: 0, rocketInventory: ['ROCKET_WEAK'] });
    const hunter = createPlayer({ index: 1, position: [60, 0, 0] });

    const zoneOnly = createFireSystem({
        players: [shooter, hunter],
        threat: threatWith({
            nearestProjectileId: 'projectile:7',
            nearestSource: 'zone',
            nearestInterceptableId: '',
        }),
        lockOnTarget: hunter,
    });
    shootPlayerItemProjectile(zoneOnly, shooter, -1, true);
    assert.equal(zoneOnly.projectiles[0].isInterceptor, false, 'exclusion zone rockets cannot be shot down');
    assert.equal(zoneOnly.projectiles[0].target, hunter);

    const mixedShooter = createPlayer({ index: 0, rocketInventory: ['ROCKET_WEAK'] });
    const mixed = createFireSystem({
        players: [mixedShooter, hunter],
        threat: threatWith({
            nearestProjectileId: 'projectile:7',
            nearestSource: 'zone',
            nearestInterceptableId: 'projectile:8',
        }),
        lockOnTarget: hunter,
    });
    shootPlayerItemProjectile(mixed, mixedShooter, -1, true);
    assert.equal(mixed.projectiles[0].isInterceptor, true);
    assert.equal(mixed.projectiles[0].interceptTargetId, 'projectile:8', 'the reachable rocket is the target');
});

test('the defence burns the weakest rocket and keeps the rest in order', () => {
    const shooter = createPlayer({
        index: 0,
        rocketInventory: ['ROCKET_MEGA', 'ROCKET_WEAK', 'ROCKET_MEDIUM'],
    });
    const hunter = createPlayer({ index: 1, position: [60, 0, 0] });
    const system = createFireSystem({
        players: [shooter, hunter],
        threat: threatWith({ nearestProjectileId: 'projectile:42' }),
        lockOnTarget: hunter,
    });

    const result = shootPlayerItemProjectile(system, shooter, -1, true);

    assert.equal(result.ok, true);
    assert.equal(result.type, 'ROCKET_WEAK', 'the cheapest rocket is spent');
    assert.deepEqual(shooter.rocketInventory, ['ROCKET_MEGA', 'ROCKET_MEDIUM'], 'the other rockets keep their order');
    assert.equal(system.projectiles[0].type, 'ROCKET_WEAK');
    assert.equal(system.projectiles[0].poolKey, 'ROCKET_WEAK');
    assert.deepEqual(system.meshTypes, ['ROCKET_WEAK'], 'the mesh matches the spent rocket');
});

test('pickWeakestRocketIndex follows the rocket tiers', () => {
    assert.equal(pickWeakestRocketIndex(['ROCKET_MEGA', 'ROCKET_WEAK', 'ROCKET_MEDIUM']), 1);
    assert.equal(pickWeakestRocketIndex(['ROCKET_MEDIUM', 'ROCKET_HEAVY']), 0);
    assert.equal(pickWeakestRocketIndex(['ROCKET_HEAVY', 'ROCKET_HEAVY']), 0, 'a tie keeps the front rocket');
    assert.equal(pickWeakestRocketIndex([]), 0);
    assert.equal(pickWeakestRocketIndex(null), 0);
});

test('an item projectile never becomes an interceptor', () => {
    const shooter = createPlayer({ index: 0, inventory: ['SWAP'] });
    const hunter = createPlayer({ index: 1, position: [60, 0, 0] });
    const system = createFireSystem({
        players: [shooter, hunter],
        threat: threatWith({ nearestProjectileId: 'projectile:42' }),
        lockOnTarget: hunter,
        inventoryItem: 'SWAP',
    });

    const result = shootPlayerItemProjectile(system, shooter, -1, false);

    assert.equal(result.ok, true);
    assert.equal(system.projectiles[0].isInterceptor, false, 'only real rockets defend');
    assert.equal(system.projectiles[0].interceptTargetId, '');
});

test('an interceptor turns towards the moving rocket it chases', () => {
    const owner = createPlayer({ index: 0 });
    const hunter = createPlayer({ index: 1, position: [200, 0, 0] });
    const players = [owner, hunter];

    const chaser = createSteppedRocket({
        owner: hunter,
        position: [0, 0, 60],
        velocity: [0, 0, -60],
        traversalId: 'projectile:42',
    });
    const interceptor = createSteppedRocket({
        owner,
        position: [0, 0, 0],
        velocity: [60, 0, 0],
        traversalId: 'projectile:43',
    });
    interceptor.isInterceptor = true;
    interceptor.interceptTargetId = 'projectile:42';

    const ops = new ProjectileSimulationOps({
        entityRuntimeConfig: createRuntimeConfig(),
        projectiles: [chaser, interceptor],
    });

    const startZ = interceptor.velocity.z;
    for (let i = 0; i < 30; i += 1) {
        ops.stepProjectile(interceptor, 1, 0.016, null, players, null, i * 0.016);
        chaser.position.addScaledVector(chaser.velocity, 0.016);
    }

    assert.ok(interceptor.velocity.z > startZ + 10, 'the interceptor swings towards the chasing rocket');
    assert.equal(interceptor.isInterceptor, true, 'it stays an interceptor while the target lives');
    assert.equal(interceptor.target, null, 'it never picks up a player target on the way');
    assert.equal(interceptor.lockedPlayerIndex, -1);
});

test('a vanished target turns the interceptor back into a normal rocket', () => {
    const owner = createPlayer({ index: 0 });
    const prey = createPlayer({ index: 1, position: [40, 0, 0] });
    const players = [owner, prey];

    const chaser = createSteppedRocket({ owner: prey, position: [0, 0, 60], traversalId: 'projectile:42' });
    const interceptor = createSteppedRocket({ owner, position: [0, 0, 0], velocity: [60, 0, 0], traversalId: 'projectile:43' });
    interceptor.isInterceptor = true;
    interceptor.interceptTargetId = 'projectile:42';

    const projectiles = [chaser, interceptor];
    const ops = new ProjectileSimulationOps({ entityRuntimeConfig: createRuntimeConfig(), projectiles });

    ops.stepProjectile(interceptor, 1, 0.016, null, players, null, 0);
    assert.equal(interceptor.isInterceptor, true);

    projectiles.splice(0, 1);
    ops.stepProjectile(interceptor, 0, 0.016, null, players, null, 0.016);

    assert.equal(interceptor.isInterceptor, false, 'no target left, so it flies on as a normal rocket');
    assert.equal(interceptor.interceptTargetId, '');
    assert.ok(interceptor.target, 'the normal target search finds an enemy again');
    assert.equal(interceptor.lockedPlayerIndex, 1);
});

test('a recycled pool state never inherits the chase', () => {
    const owner = createPlayer({ index: 0 });
    const prey = createPlayer({ index: 1, position: [40, 0, 0] });
    const players = [owner, prey];

    const chaser = createSteppedRocket({ owner: prey, position: [0, 0, 60], traversalId: 'projectile:42' });
    const interceptor = createSteppedRocket({ owner, position: [0, 0, 0], velocity: [60, 0, 0], traversalId: 'projectile:43' });
    interceptor.isInterceptor = true;
    interceptor.interceptTargetId = 'projectile:42';

    // The chased rocket is gone, its state object comes back as a brand new rocket.
    const recycled = chaser;
    recycled.traversalId = 'projectile:77';
    const projectiles = [recycled, interceptor];
    const ops = new ProjectileSimulationOps({ entityRuntimeConfig: createRuntimeConfig(), projectiles });

    ops.stepProjectile(interceptor, 1, 0.016, null, players, null, 0);

    assert.equal(interceptor.isInterceptor, false, 'the id is gone, so the chase ends');
    assert.equal(findProjectileByTraversalId(projectiles, 'projectile:42'), null);
});

test('the pool knows and clears the two intercept fields', () => {
    const pool = new ProjectileStatePool();
    const projectile = pool.acquire();
    assert.equal(projectile.isInterceptor, false);
    assert.equal(projectile.interceptTargetId, '');

    projectile.isInterceptor = true;
    projectile.interceptTargetId = 'projectile:42';
    pool.release(projectile);

    assert.equal(projectile.isInterceptor, false, 'a recycled state never defends by accident');
    assert.equal(projectile.interceptTargetId, '');
});

test('the tracker names the nearest rocket that can actually be shot down', () => {
    const tracker = new RocketThreatTracker({ entityRuntimeConfig: createRuntimeConfig() });
    const hunter = createPlayer({ index: 0, position: [200, 0, 0] });
    const prey = createPlayer({ index: 1, position: [0, 0, 0] });
    const players = [hunter, prey];

    const zoneRocket = {
        owner: null,
        type: 'ROCKET_WEAK',
        traversalId: 'projectile:7',
        lockedPlayerIndex: 1,
        zoneProjectile: true,
        environmentProjectile: true,
        position: new THREE.Vector3(5, 0, 0),
        velocity: new THREE.Vector3(-45, 0, 0),
    };
    const playerRocket = {
        owner: hunter,
        type: 'ROCKET_WEAK',
        traversalId: 'projectile:8',
        lockedPlayerIndex: 1,
        position: new THREE.Vector3(40, 0, 0),
        velocity: new THREE.Vector3(-45, 0, 0),
    };

    tracker.update([zoneRocket, playerRocket], players);
    const threat = tracker.getThreat(1);
    assert.equal(threat.nearestProjectileId, 'projectile:7', 'the warning still names the nearest rocket');
    assert.equal(threat.nearestSource, 'zone');
    assert.equal(threat.nearestInterceptableId, 'projectile:8', 'only the player rocket can be intercepted');

    tracker.update([zoneRocket], players);
    assert.equal(tracker.getThreat(1).nearestInterceptableId, '', 'a lone zone rocket leaves nothing to shoot at');
});

test('an interceptor never shows up as a threat itself', () => {
    const tracker = new RocketThreatTracker({ entityRuntimeConfig: createRuntimeConfig() });
    const hunter = createPlayer({ index: 0, position: [200, 0, 0] });
    const prey = createPlayer({ index: 1, position: [0, 0, 0] });
    const defending = {
        owner: hunter,
        type: 'ROCKET_WEAK',
        traversalId: 'projectile:9',
        lockedPlayerIndex: 1,
        isInterceptor: true,
        position: new THREE.Vector3(10, 0, 0),
        velocity: new THREE.Vector3(-45, 0, 0),
    };

    tracker.update([defending], [hunter, prey]);

    assert.equal(tracker.getThreat(1).active, false, 'interceptors chase rockets, not players');
    assert.equal(tracker.getThreat(1).count, 0);
});

test('resolveInterceptTargetId stays empty without a live threat', () => {
    const player = createPlayer({ index: 1 });
    assert.equal(resolveInterceptTargetId({ getRocketThreat: () => EMPTY_THREAT }, player), '');
    assert.equal(resolveInterceptTargetId({}, player), '');
    assert.equal(
        resolveInterceptTargetId({ getRocketThreat: () => threatWith({ nearestProjectileId: 'projectile:3' }) }, player),
        'projectile:3'
    );
});

test('cooldown and an empty magazine behave exactly as before', () => {
    const hunter = createPlayer({ index: 1, position: [60, 0, 0] });
    const threat = threatWith({ nearestProjectileId: 'projectile:42' });

    const cooling = createPlayer({ index: 0, rocketInventory: ['ROCKET_WEAK'] });
    cooling.shootCooldown = 0.4;
    const coolingSystem = createFireSystem({ players: [cooling, hunter], threat, lockOnTarget: hunter });
    const cooldownResult = shootPlayerItemProjectile(coolingSystem, cooling, -1, true);
    assert.equal(cooldownResult.ok, false);
    assert.equal(coolingSystem.projectiles.length, 0);
    assert.deepEqual(cooling.rocketInventory, ['ROCKET_WEAK'], 'a blocked shot spends nothing');

    const empty = createPlayer({ index: 0 });
    const emptySystem = createFireSystem({ players: [empty, hunter], threat, lockOnTarget: hunter });
    const emptyResult = shootPlayerItemProjectile(emptySystem, empty, -1, true);
    assert.equal(emptyResult.ok, false);
    assert.equal(emptySystem.projectiles.length, 0);

    const ready = createPlayer({ index: 0, rocketInventory: ['ROCKET_WEAK'] });
    const readySystem = createFireSystem({ players: [ready, hunter], threat, lockOnTarget: hunter });
    shootPlayerItemProjectile(readySystem, ready, -1, true);
    assert.equal(ready.shootCooldown, 0.5, 'a fired defence rocket still starts the cooldown');
});

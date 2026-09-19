import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';
import { applyDamage } from '../src/hunt/HealthSystem.js';
import { FlamethrowerSystem } from '../src/hunt/FlamethrowerSystem.js';
import { applyPlayerPowerup } from '../src/entities/player/PlayerEffectOps.js';
import { TrailSpatialIndex } from '../src/entities/systems/TrailSpatialIndex.js';
import {
    FLAMETHROWER_TARGET_SPAWN_WEIGHTS,
    FLAMETHROWER_PICKUP_DEFINITIONS,
} from '../src/shared/contracts/FlamethrowerPickupDefinitionsContract.js';
import { getPickupSpawnWeight, getPickupTypes, pickWeightedPickupType } from '../src/shared/contracts/PickupRegistryContract.js';

const HUNT_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: true, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' },
};

const CLASSIC_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: false, ACTIVE_MODE: 'CLASSIC', DEFAULT_MODE: 'CLASSIC' },
};

const BURN_SECONDS = 0.3;

function createPlayer(index, position, config) {
    return {
        index,
        alive: true,
        isBot: false,
        position: new THREE.Vector3(position[0], position[1], position[2]),
        entityRuntimeConfig: config,
        activeEffects: [],
        inventory: [],
        rocketInventory: [],
        selectedItemIndex: 0,
        baseSpeed: CONFIG_BASE.PLAYER.SPEED,
        speed: CONFIG_BASE.PLAYER.SPEED,
        trail: null,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 40,
        hasShield: false,
        shieldHitFeedback: 0,
        spawnProtectionTimer: 0,
        lastDamageTimestamp: -Infinity,
        aimDirection: new THREE.Vector3(0, 0, -1),
        getAimDirection(out = null) {
            const target = out || new THREE.Vector3();
            return target.copy(this.aimDirection);
        },
        takeDamage(amount, options = {}) {
            return applyDamage(this, amount, { nowSeconds: 0, ...options }, this.entityRuntimeConfig);
        },
    };
}

function createWorld({ mode = 'HUNT', arena = null, isFightOutcomeAuthority = true } = {}) {
    const config = mode === 'HUNT' ? HUNT_MODE_CONFIG : CLASSIC_MODE_CONFIG;
    const shooter = createPlayer(0, [0, 0, 0], config);
    const trailSpatialIndex = new TrailSpatialIndex({ getPlayers: () => entityManager.players });
    let burnedTrailMeters = 0;
    const entityManager = {
        players: [shooter],
        arena,
        isFightOutcomeAuthority,
        entityRuntimeConfig: config,
        getTrailSpatialIndex: () => trailSpatialIndex,
        _emitHuntDamageEvent() {},
        _killPlayer(player) { player.alive = false; },
        _huntScoring: { registerBurnedTrailMeters(_playerIndex, meters) { burnedTrailMeters += meters; } },
    };
    shooter.entityManager = entityManager;
    const system = new FlamethrowerSystem(entityManager);
    entityManager._flamethrowerSystem = system;
    applyPlayerPowerup(shooter, 'FLAMETHROWER');
    assert.equal(shooter.hasFlamethrower, true, 'the item arms the flamethrower');
    return { config, entityManager, shooter, system, trailSpatialIndex, get burnedTrailMeters() { return burnedTrailMeters; } };
}

function makeTrail(maxSegments = 100, writeIndex = 0) {
    return {
        maxSegments,
        writeIndex,
        destroyedEntries: [],
        destroySegmentByEntry(entry) {
            this.destroyedEntries.push(entry);
            return true;
        },
    };
}

/** Registers one straight trail segment centred on (midX, midZ), laid out along X. */
function addSegment(world, { playerIndex = 1, segmentIdx = 0, midX = 0, midZ = -6, halfLength = 0.5, radius = 0.6, ownerTrail = null, reusableRef = null } = {}) {
    return world.trailSpatialIndex.registerTrailSegment(playerIndex, segmentIdx, {
        midX,
        midZ,
        fromX: midX - halfLength,
        fromY: 0,
        fromZ: midZ,
        toX: midX + halfLength,
        toY: 0,
        toZ: midZ,
        radius,
        hp: HUNT_CONFIG.TRAIL_SEGMENT_HP,
        maxHp: HUNT_CONFIG.TRAIL_SEGMENT_HP,
        ownerTrail,
    }, reusableRef);
}

function blockingArena(sourceName = 'Wall_Block') {
    return {
        raycast(origin, direction, maxDistance) {
            return {
                hit: true,
                distance: Math.min(1, maxDistance),
                sourceName,
                point: { x: origin.x, y: origin.y, z: origin.z },
            };
        },
    };
}

test('the trail burn time lives in the hunt config', () => {
    assert.equal(HUNT_CONFIG.FLAMETHROWER.TRAIL_BURN_SECONDS, BURN_SECONDS);
});

test('a trail segment in the cone needs 0.3 seconds of fire, 0.2 leaves it standing', () => {
    const world = createWorld();
    const ref = addSegment(world);

    for (let tick = 0; tick < 4; tick += 1) world.system.fire(world.shooter, 0.05);
    assert.equal(ref.entry.destroyed, false, '0.2 seconds of contact is not enough');
    assert.ok(ref.entry.burnSeconds > 0, 'the contact time is collected on the segment entry');

    for (let tick = 0; tick < 2; tick += 1) world.system.fire(world.shooter, 0.05);
    assert.equal(ref.entry.destroyed, true, '0.3 seconds of contact burns the gap');
    assert.equal(world.burnedTrailMeters, 1, 'the counter uses the actual removed segment length');
});

test('the burn time is the same at 30, 60 and 144 frames per second', () => {
    for (const fps of [30, 60, 144]) {
        const world = createWorld();
        const ref = addSegment(world);
        const dt = 1 / fps;
        let elapsed = 0;
        for (let frame = 0; frame < fps && !ref.entry.destroyed; frame += 1) {
            world.system.fire(world.shooter, dt);
            elapsed += dt;
        }
        assert.equal(ref.entry.destroyed, true, `the segment burns within one second at ${fps} fps`);
        assert.ok(
            Math.abs(elapsed - BURN_SECONDS) <= dt + 1e-9,
            `at ${fps} fps the gap opens after ${elapsed.toFixed(3)}s, expected ${BURN_SECONDS}s`,
        );
    }
});

test('segments out of range, off the cone axis or behind the shooter stay intact', () => {
    const world = createWorld();
    const tooFar = addSegment(world, { segmentIdx: 0, midZ: -25 });
    const offAxis = addSegment(world, { segmentIdx: 1, midX: 8, midZ: -6 });
    const behind = addSegment(world, { segmentIdx: 2, midZ: 6 });
    const inside = addSegment(world, { segmentIdx: 3, midZ: -6 });

    for (let tick = 0; tick < 20; tick += 1) world.system.fire(world.shooter, 0.05);

    assert.equal(tooFar.entry.destroyed, false, 'beyond the range');
    assert.equal(offAxis.entry.destroyed, false, 'outside the opening angle');
    assert.equal(behind.entry.destroyed, false, 'behind the shooter');
    assert.equal(inside.entry.destroyed, true, 'the segment in the cone burns');
});

test('a wall protects a trail, another trail in front of it does not', () => {
    const blocked = createWorld({ arena: blockingArena() });
    const hidden = addSegment(blocked);
    for (let tick = 0; tick < 20; tick += 1) blocked.system.fire(blocked.shooter, 0.05);
    assert.equal(hidden.entry.destroyed, false, 'map geometry between shooter and trail stops the flame');

    const open = createWorld();
    const near = addSegment(open, { segmentIdx: 0, midZ: -4 });
    const far = addSegment(open, { segmentIdx: 1, midZ: -8 });
    for (let tick = 0; tick < 20; tick += 1) open.system.fire(open.shooter, 0.05);
    assert.equal(near.entry.destroyed, true, 'the near segment burns');
    assert.equal(far.entry.destroyed, true, 'fire eats through a trail, so the segment behind it burns too');
});

test('the shooter burns his own trail but never the fresh piece at his tail', () => {
    const world = createWorld();
    const ownTrail = makeTrail(100, 10);
    world.shooter.trail = ownTrail;
    const fresh = addSegment(world, { playerIndex: 0, segmentIdx: 9, midZ: -6, ownerTrail: ownTrail });
    const older = addSegment(world, { playerIndex: 0, segmentIdx: 0, midZ: -8, ownerTrail: ownTrail });

    for (let tick = 0; tick < 20; tick += 1) world.system.fire(world.shooter, 0.05);

    assert.equal(fresh.entry.destroyed, false, 'the newest own segments keep the same skip rule the machine gun uses');
    assert.equal(older.entry.destroyed, true, 'an older own segment burns, so a trapped player can free himself');
    assert.deepEqual(ownTrail.destroyedEntries, [older.entry], 'the owning trail clears the instance');
});

test('classic burns trails without touching player health, a replica computes nothing', () => {
    const classic = createWorld({ mode: 'CLASSIC' });
    const target = createPlayer(1, [0, 0, -6], classic.config);
    classic.entityManager.players.push(target);
    const segment = addSegment(classic);
    for (let tick = 0; tick < 20; tick += 1) classic.system.fire(classic.shooter, 0.05);
    assert.equal(segment.entry.destroyed, true, 'classic burns gaps into trails');
    assert.equal(target.hp, 100, 'classic never takes player damage from the flame');

    const replica = createWorld({ isFightOutcomeAuthority: false });
    const replicaSegment = addSegment(replica);
    for (let tick = 0; tick < 20; tick += 1) {
        assert.equal(replica.system.fire(replica.shooter, 0.05), true, 'the replica still swallows the key');
    }
    assert.equal(replicaSegment.entry.destroyed, false, 'the host owns the trail damage');
});

test('a reused segment entry starts its contact time at zero', () => {
    const world = createWorld();
    const ref = addSegment(world, { segmentIdx: 0 });
    world.system.fire(world.shooter, 0.2);
    assert.ok(ref.entry.burnSeconds > 0, 'the entry collected contact time');

    const reused = addSegment(world, { segmentIdx: 1, reusableRef: ref });
    assert.equal(reused.entry, ref.entry, 'the trail recycles the entry object');
    assert.equal(reused.entry.burnSeconds, 0, 'the recycled entry does not inherit the old contact time');

    for (let tick = 0; tick < 4; tick += 1) world.system.fire(world.shooter, 0.05);
    assert.equal(reused.entry.destroyed, false, '0.2 seconds on the recycled entry is still not enough');
});

test('the flamethrower is unlocked at its target spawn weight in every mode', () => {
    assert.deepEqual(
        FLAMETHROWER_PICKUP_DEFINITIONS.FLAMETHROWER.spawnWeights,
        { ...FLAMETHROWER_TARGET_SPAWN_WEIGHTS },
        'the definition carries the target weights',
    );
    for (const mode of ['CLASSIC', 'ARCADE', 'HUNT']) {
        assert.equal(getPickupSpawnWeight('FLAMETHROWER', mode), FLAMETHROWER_TARGET_SPAWN_WEIGHTS[mode], mode);
    }
    assert.equal(
        HUNT_CONFIG.PICKUP_WEIGHTS.FLAMETHROWER,
        FLAMETHROWER_TARGET_SPAWN_WEIGHTS.HUNT,
        'hunt spawns read their own table and have to match',
    );

    const everyType = getPickupTypes();
    let picked = false;
    for (let roll = 0; roll < 2000 && !picked; roll += 1) {
        picked = pickWeightedPickupType(everyType, 'HUNT', () => roll / 2000) === 'FLAMETHROWER';
    }
    assert.equal(picked, true, 'a weighted spawn can now return the flamethrower');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { PowerupManager } from '../src/entities/Powerup.js';
import { PortalLayoutBuilder } from '../src/entities/arena/portal/PortalLayoutBuilder.js';
import { SecretRoomSystem } from '../src/entities/systems/SecretRoomSystem.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import {
    isPickupTypeAllowedForMode,
    pickWeightedPickupType,
} from '../src/shared/contracts/PickupRegistryContract.js';

const MAP_SCALE = 3;

// Authored in map units, exactly as a preset writes them; the runtime multiplies by the map scale.
// The room hangs below the arena floor, the way the authoring rule of S3 demands.
const ROOM = Object.freeze({
    id: 'vault',
    modes: ['HUNT'],
    entryPortal: { pos: [12, 3, 0], color: 0x44ddff },
    roomPortal: { pos: [0, -8, 0] },
    bounds: { min: [-10, -14, -10], max: [10, -3, 10] },
    ejectPoint: { pos: [0, 4, 0], yawDeg: 0 },
    stayLimitSeconds: 20,
    refillSeconds: 30,
    items: [
        { pos: [-4, -8, -4] },
        { pos: [4, -8, 4], type: 'HEALTH' },
    ],
});

function createArena() {
    const scene = new THREE.Scene();
    let positionIndex = 0;
    return {
        renderer: {
            addToScene(object) { scene.add(object); },
            removeFromScene(object) { scene.remove(object); },
        },
        scene,
        portals: [],
        exitPortals: [],
        specialGates: [],
        checkpointRings: [],
        checkpointRingSpinEnabled: true,
        portalsEnabled: true,
        portalLayoutWarnings: [],
        runtimeConfig: null,
        currentMapKey: 'secret_room_refill_test',
        currentMapDefinition: null,
        bounds: { minX: -40, maxX: 40, minY: 0, maxY: 30, minZ: -40, maxZ: 40 },
        glbAnimationElapsedSeconds: 0,
        checkCollision(position) { return position.y < 0; },
        checkCollisionFast(position) { return position.y < 0; },
        // A fixed grid, so two arenas that are fed the same ticks spawn in the same places.
        getRandomPosition() {
            const index = positionIndex++;
            return new THREE.Vector3((index % 8) * 10 - 35, 12, Math.floor(index / 8) * 10 - 35);
        },
    };
}

/**
 * Stands for a real mode strategy: the weighted draw of ClassicModeStrategy, but on a seeded
 * generator, so the same seed has to produce the same item types.
 */
function createStrategy(seed = 1, mode = 'HUNT') {
    let state = seed >>> 0;
    const random = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
    return {
        modeType: mode,
        getPickupModeType: () => mode,
        runtimeRng: { next: random },
        getSpawnRateMultiplier: () => 1,
        filterSpawnableTypes: (typeKeys, powerupTypes) => typeKeys.filter(
            (typeKey) => powerupTypes[typeKey] && isPickupTypeAllowedForMode(typeKey, mode)
        ),
        resolveSpawnType: (spawnableTypes, config) => pickWeightedPickupType(
            spawnableTypes, mode, random, config?.POWERUP?.TYPES
        ),
    };
}

function createHarness(t, { room = ROOM, mode = 'HUNT', seed = 1, maxOnField = 8 } = {}) {
    const config = createEntityRuntimeConfig(null, CONFIG_BASE);
    config.POWERUP.MAX_ON_FIELD = maxOnField;
    config.POWERUP.TYPES = {
        SHIELD: config.POWERUP.TYPES.SHIELD,
        HEALTH: config.POWERUP.TYPES.HEALTH,
        PURGE: config.POWERUP.TYPES.PURGE,
    };
    config.GAMEPLAY.PLANAR_MODE = false;

    const arena = createArena();
    const map = { size: [27, 10, 27], secretRooms: room ? [{ ...room }] : [] };
    arena.currentMapDefinition = map;
    new PortalLayoutBuilder(arena).build(map, MAP_SCALE);

    let added = 0;
    let removed = 0;
    const renderer = {
        addToScene(object) { added += 1; arena.renderer.addToScene(object); },
        removeFromScene(object) { removed += 1; arena.renderer.removeFromScene(object); },
    };
    const manager = new PowerupManager(renderer, arena, config);
    const strategy = createStrategy(seed, mode);
    manager.getStrategy = () => strategy;
    t.after(() => manager.dispose());

    const entityManager = {
        arena,
        players: [],
        powerupManager: manager,
        gameModeStrategy: strategy,
        _mapDestructibleSystem: null,
    };
    const system = new SecretRoomSystem(entityManager);
    return {
        arena,
        manager,
        system,
        strategy,
        meshCounts: () => ({ added, removed }),
        roomItems: () => manager.items.filter((item) => item.roomId === 'vault'),
        arenaItems: () => manager.items.filter((item) => !item.roomId),
        tick: (dt, steps = 1) => {
            for (let step = 0; step < steps; step += 1) {
                system.update(dt);
                manager.update(dt);
            }
        },
    };
}

// The render tick bobs every item around its base height, so the base height is the spawn place.
function positionsOf(items) {
    return items
        .map((item) => [item.mesh.position.x, item.baseY, item.mesh.position.z])
        .sort((a, b) => a[0] - b[0]);
}

test('a round starts with every item point of the room filled, in world units', (t) => {
    const harness = createHarness(t);
    harness.system.startRound();

    const items = harness.roomItems();
    assert.equal(items.length, 2, 'both authored points carry an item');
    assert.deepEqual(
        positionsOf(items),
        [[-12, -24, -12], [12, -24, 12]],
        'item points are map units times the map scale'
    );
});

test('a collected point fills up again on its own clock', (t) => {
    const harness = createHarness(t);
    harness.system.startRound();
    const [first] = harness.roomItems();

    assert.equal(harness.manager.checkPickup(first.mesh.position, 0)?.ok, true, 'the point can be collected');
    assert.equal(harness.roomItems().length, 1);

    harness.tick(0.4, 20);
    harness.tick(7, 3);
    assert.equal(harness.roomItems().length, 1, '29 seconds later the point is still empty');

    harness.tick(1);
    assert.equal(harness.roomItems().length, 2, '30 seconds later the point carries an item again');
    assert.deepEqual(
        positionsOf(harness.roomItems()),
        [[-12, -24, -12], [12, -24, 12]],
        'the new item stands on the authored point'
    );
});

test('every point runs its own clock', (t) => {
    const harness = createHarness(t);
    harness.system.startRound();

    const [first] = harness.roomItems();
    assert.equal(harness.manager.checkPickup(first.mesh.position, 0)?.ok, true);
    harness.tick(1, 10);
    const [second] = harness.roomItems();
    assert.equal(harness.manager.checkPickup(second.mesh.position, 0)?.ok, true);
    assert.equal(harness.roomItems().length, 0, 'both points are empty now');

    harness.tick(1, 20);
    assert.equal(harness.roomItems().length, 1, 'the point taken first comes back first');
    harness.tick(1, 10);
    assert.equal(harness.roomItems().length, 2);
});

test('an authored type is kept, one the mode forbids draws from the allowed types', (t) => {
    const fixed = createHarness(t, {
        room: { ...ROOM, items: [{ pos: [0, -8, 0], type: 'HEALTH' }] },
    });
    fixed.system.startRound();
    assert.equal(fixed.roomItems()[0].type, 'HEALTH', 'the map author decides');

    const forbidden = createHarness(t, {
        room: { ...ROOM, items: [{ pos: [0, -8, 0], type: 'PURGE' }] },
    });
    forbidden.system.startRound();
    const drawn = forbidden.roomItems()[0].type;
    assert.ok(['SHIELD', 'HEALTH'].includes(drawn), `a type the mode forbids is replaced: ${drawn}`);
});

test('the item types come from the seeded generator alone', (t) => {
    const room = { ...ROOM, items: [{ pos: [0, -8, 0] }, { pos: [4, -8, 4] }] };
    const drawWith = (seed) => {
        const harness = createHarness(t, { room, seed });
        harness.system.startRound();
        return harness.roomItems().map((item) => item.type);
    };
    assert.deepEqual(drawWith(7), drawWith(7), 'the same seed draws the same types');
});

test('room items stay out of the arena limit and out of the arena spawn rhythm', (t) => {
    const withRoom = createHarness(t, { maxOnField: 4 });
    const withoutRoom = createHarness(t, { room: null, maxOnField: 4 });
    withRoom.system.startRound();
    withoutRoom.system.startRound();

    const interval = withRoom.manager.entityRuntimeConfig.POWERUP.SPAWN_INTERVAL;
    withRoom.tick(interval, 12);
    withoutRoom.tick(interval, 12);

    assert.equal(withoutRoom.roomItems().length, 0, 'a map without a room grows no room items');
    assert.equal(withRoom.roomItems().length, 2);
    assert.equal(
        withRoom.arenaItems().length,
        withoutRoom.arenaItems().length,
        'the arena keeps its own density'
    );
    assert.deepEqual(
        positionsOf(withRoom.arenaItems()),
        positionsOf(withoutRoom.arenaItems()),
        'and spawns in the very same places'
    );
});

test('the portal safety distance never blocks an authored room point', (t) => {
    // The way back stands in the room itself, so an item point next to it is inside the ten unit
    // ring that keeps random arena spawns away from portals.
    const harness = createHarness(t, {
        room: { ...ROOM, items: [{ pos: [0, -8, 0] }] },
    });
    harness.system.startRound();
    assert.equal(harness.roomItems().length, 1, 'the map author wins over the safety distance');
    assert.deepEqual(harness.roomItems()[0].mesh.position.toArray(), [0, -24, 0]);
});

test('a replica spawns nothing and a room the mode leaves out stays empty', (t) => {
    const replica = createHarness(t);
    replica.manager.setNetworkReplica(true);
    replica.system.setNetworkReplica(true);
    replica.system.startRound();
    replica.tick(5, 20);
    assert.equal(replica.manager.items.length, 0, 'only the host spawns');

    const otherMode = createHarness(t, { mode: 'CLASSIC' });
    otherMode.system.startRound();
    otherMode.tick(5, 20);
    assert.equal(otherMode.roomItems().length, 0, 'a room outside the mode hands out nothing');
});

test('a round restart leaves exactly one item per point and no orphaned meshes', (t) => {
    const harness = createHarness(t);
    harness.system.startRound();
    harness.tick(1, 5);
    const beforeRestart = harness.meshCounts();
    const onField = harness.manager.items.length;

    harness.manager.clear();
    assert.equal(harness.meshCounts().removed, beforeRestart.removed + onField, 'every mesh leaves the scene');
    const cleared = harness.meshCounts();
    assert.equal(cleared.added - cleared.removed, 0, 'no item mesh is left behind');
    harness.system.startRound();
    assert.equal(harness.roomItems().length, 2, 'the restart fills every point once');

    // A restart that keeps the field: the points recognise their own items and stay at one each.
    harness.system.startRound();
    assert.equal(harness.roomItems().length, 2, 'no second item on the same point');
});

test('a long match neither grows the item list nor the room bookkeeping', (t) => {
    const harness = createHarness(t, { maxOnField: 2 });
    harness.system.startRound();
    const [entry] = harness.system.getRooms();
    harness.tick(0.016, 600);

    assert.equal(harness.roomItems().length, 2, 'the room stays full while nobody collects');
    assert.equal(harness.system.getRooms().length, 1);
    assert.equal(harness.system.getRooms()[0], entry, 'the round keeps its room objects');
});

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { WaterZoneSystem } from '../src/entities/systems/WaterZoneSystem.js';
import { toArenaMapDefinition } from '../src/entities/mapSchema/MapSchemaRuntimeOps.js';
import { normalizeMapSchemaDocument } from '../src/entities/mapSchema/MapSchemaSanitizeOps.js';
import { applyHuntNetworkState, createHuntNetworkState } from '../src/hunt/HuntNetworkState.js';
import { normalizeMapDestructibles } from '../src/shared/contracts/MapDestructibleContract.js';
import { normalizeSecretRooms } from '../src/shared/contracts/SecretRoomContract.js';
import { WATER_PHASES, normalizeWaterZone } from '../src/shared/contracts/WaterZoneContract.js';

const MAP_KEY = 'storm_dam_siege';

test('wave 6 dam is a destructible landmark whose breach unlocks a room and floods half the map', () => {
    const map = MAP_PRESET_CATALOG[MAP_KEY];
    assert.ok(map, `${MAP_KEY} must be registered`);
    assert.equal(map.singlePlayerScenario?.gameMode, 'HUNT');

    const destructibles = normalizeMapDestructibles(map.destructibles);
    assert.ok(destructibles);
    assert.deepEqual(destructibles.segments.map((segment) => segment.id), ['dam_wall']);
    assert.equal(destructibles.segments[0].kind, 'landmark');
    assert.deepEqual(destructibles.breakScenes[0].hideModelIds, ['storm-dam-intact', 'storm-dam-gate']);

    const rooms = normalizeSecretRooms(map.secretRooms);
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].unlock.when, 'anyBreak');

    const water = normalizeWaterZone(map.waterZone);
    assert.ok(water);
    assert.equal(water.triggerSegmentId, 'dam_wall');
    assert.equal(water.waveSeconds, 2);
    assert.equal(water.riseSeconds, 20);
    assert.equal(water.targetLevel, map.size[1] / 2);

    for (const model of map.glbModels) assert.ok(existsSync(model.url), `missing runtime asset ${model.url}`);
    assert.ok(existsSync('assets/maps/storm_dam_siege/blender/01_dam.blend'));
    assert.ok(existsSync('assets/maps/storm_dam_siege/blender/20_dam_collapse.blend'));
});

test('dam break drives the authoritative wave, rise and persistent flooded state', () => {
    const map = MAP_PRESET_CATALOG[MAP_KEY];
    const breakState = { events: [] };
    const added = [];
    const removed = [];
    const owner = {
        arena: { currentMapDefinition: map },
        renderer: {
            addToScene: (value) => added.push(value),
            removeFromScene: (value) => removed.push(value),
        },
        _mapDestructibleSystem: {
            isActive: () => true,
            getState: () => breakState,
        },
    };
    const system = new WaterZoneSystem(owner);
    assert.equal(system.startRound(), true);
    assert.equal(system.getState().phase, WATER_PHASES.DRY);
    assert.equal(added.length, 1);

    breakState.events.push({ segmentId: 'dam_wall', atSeconds: 1 });
    system.update(2);
    assert.equal(system.getState().phase, WATER_PHASES.RISING);
    system.update(20);
    assert.equal(system.getState().phase, WATER_PHASES.FLOODED);
    assert.equal(system.getState().level, map.waterZone.targetLevel * system.scale);

    const replica = new WaterZoneSystem(owner);
    replica.startRound();
    replica.setNetworkReplica(true);
    const networkState = JSON.parse(JSON.stringify(createHuntNetworkState({
        huntEnabled: true,
        players: [],
        runtimeConfig: { hunt: {} },
        entityRuntimeConfig: { HUNT: {} },
        getHuntScoreboard: () => [],
        _roundOutcomeSystem: { getDeathmatchState: () => ({}) },
        _waterZoneSystem: system,
    })));
    applyHuntNetworkState({
        players: [],
        _huntScoring: { applyScoreboard() {} },
        _waterZoneSystem: replica,
    }, networkState);
    assert.deepEqual(replica.getState(), system.getState());

    system.clear();
    replica.clear();
    assert.equal(removed.length, 2);
});

test('custom map schema preserves and scales water zones into runtime space', () => {
    const document = normalizeMapSchemaDocument({
        schemaVersion: 4,
        arenaSize: { width: 540, height: 270, depth: 540 },
        waterZone: {
            id: 'custom_basin',
            triggerSegmentId: 'custom_dam',
            bounds: { min: [-270, 0, -270], max: [270, 270, 270] },
            startLevel: 0,
            targetLevel: 135,
            waveSeconds: 2,
            riseSeconds: 20,
        },
    });
    const runtime = toArenaMapDefinition(document, { mapScale: 3 }).map.waterZone;
    assert.equal(runtime.triggerSegmentId, 'custom_dam');
    assert.equal(runtime.targetLevel, 45);
    assert.deepEqual(runtime.bounds.max, [90, 90, 90]);
});

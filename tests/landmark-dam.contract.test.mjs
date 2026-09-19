import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { WaterZoneSystem } from '../src/entities/systems/WaterZoneSystem.js';
import { toArenaMapDefinition } from '../src/entities/mapSchema/MapSchemaRuntimeOps.js';
import { normalizeMapSchemaDocument } from '../src/entities/mapSchema/MapSchemaSanitizeOps.js';
import { applyHuntNetworkState, createHuntNetworkState } from '../src/hunt/HuntNetworkState.js';
import { normalizeMapDestructibles } from '../src/shared/contracts/MapDestructibleContract.js';
import { normalizeSecretRooms } from '../src/shared/contracts/SecretRoomContract.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';
import {
    WATER_PHASES,
    WATER_WAVE_ORIGINS,
    normalizeWaterZone,
} from '../src/shared/contracts/WaterZoneContract.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

const MAP_KEY = 'storm_dam_siege';

test('wave 6 dam is a destructible landmark whose breach unlocks a room and floods half the map', () => {
    const map = MAP_PRESET_CATALOG[MAP_KEY];
    assert.ok(map, `${MAP_KEY} must be registered`);
    assert.equal(map.singlePlayerScenario?.gameMode, 'HUNT');
    assert.deepEqual(map.size, [180, 150, 180]);
    assert.equal(map.exclusionZone.openFaces.includes('maxZ'), false);

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
    assert.equal(water.waveSeconds, 4);
    assert.equal(water.riseSeconds, 24);
    assert.equal(water.waveOrigin, WATER_WAVE_ORIGINS.MAX_Z);
    assert.equal(water.targetLevel, map.size[1] / 2);

    const intact = map.glbModels.find((model) => model.id === 'storm-dam-intact');
    assert.ok(intact.position[2] >= 80, 'the dam sits against the maxZ map edge');
    assert.ok(map.destructibles.segments[0].anchor[1] >= map.size[1] * 0.6, 'the target spans most of the map height');

    for (const model of map.glbModels) assert.ok(existsSync(model.url), `missing runtime asset ${model.url}`);
    assert.ok(existsSync('assets/maps/storm_dam_siege/blender/01_dam.blend'));
    assert.ok(existsSync('assets/maps/storm_dam_siege/blender/20_dam_collapse.blend'));
});

test('the engine-loaded dam spans the rear map edge and nearly reaches the ceiling', async () => {
    const map = MAP_PRESET_CATALOG[MAP_KEY];
    const scale = 3;
    const result = await loadGLBMapCollection(map.glbModels, {
        loader: geometryOnlyGlbLoader,
        placementScale: scale,
        colliderMode: map.glbColliderMode,
        requireComplete: true,
    });
    try {
        const intact = result.scene.getObjectByName('glb-slot-storm-dam-intact');
        assert.ok(intact);
        const wallBounds = new THREE.Box3();
        intact.traverse((child) => {
            if (/^dam_wall_arch_\d+$/.test(String(child.name))) wallBounds.expandByObject(child);
        });
        const size = wallBounds.getSize(new THREE.Vector3());
        const centerSegment = intact.getObjectByName('dam_wall_arch_08');
        const center = new THREE.Box3().setFromObject(centerSegment).getCenter(new THREE.Vector3());
        assert.ok(size.x >= map.size[0] * scale * 0.98, 'the concrete wall fills the map width');
        assert.ok(size.y >= map.size[1] * scale * 0.9, 'the concrete wall is almost map-height');
        assert.ok(Math.abs(center.z - (map.size[2] * scale / 2)) <= 2, 'the dam crest is centered on maxZ');
    } finally {
        disposeObject3DResources(result.scene);
    }
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
    assert.equal(system._visual.waveGroup.children.length, 5);
    assert.ok(system._visual.surface.geometry.attributes.position.count > 4);

    breakState.events.push({ segmentId: 'dam_wall', atSeconds: 1 });
    system.update(2);
    assert.equal(system.getState().phase, WATER_PHASES.WAVE);
    assert.ok(system._visual.waveGroup.position.z < system.getZone().bounds.max[2]);
    system.update(2);
    assert.equal(system.getState().phase, WATER_PHASES.RISING);
    system.update(24);
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
            waveOrigin: 'maxZ',
        },
    });
    const runtime = toArenaMapDefinition(document, { mapScale: 3 }).map.waterZone;
    assert.equal(runtime.triggerSegmentId, 'custom_dam');
    assert.equal(runtime.waveOrigin, WATER_WAVE_ORIGINS.MAX_Z);
    assert.equal(runtime.targetLevel, 45);
    assert.deepEqual(runtime.bounds.max, [90, 90, 90]);
});

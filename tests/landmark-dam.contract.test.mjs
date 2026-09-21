import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { createMapBreakSceneController } from '../src/entities/arena/MapBreakSceneController.js';
import { createArenaRayResult, raycastArenaObstacles } from '../src/entities/arena/ArenaRayQuery.js';
import { refreshDynamicMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { GlbAnimationDriver } from '../src/entities/arena/GlbAnimationDriver.js';
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

function glbJson(path) {
    const bytes = readFileSync(path);
    return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
}

function authoredMaterial(json, nodeName) {
    const node = json.nodes.find((entry) => entry.name === nodeName);
    assert.ok(node && Number.isInteger(node.mesh), `GLB mesh ${nodeName}`);
    return json.materials[json.meshes[node.mesh].primitives[0].material];
}

test('wave 6 dam is a destructible landmark whose breach unlocks a room and floods half the map', () => {
    const map = MAP_PRESET_CATALOG[MAP_KEY];
    assert.ok(map, `${MAP_KEY} must be registered`);
    assert.equal(map.singlePlayerScenario?.gameMode, 'HUNT');
    assert.deepEqual(map.size, [180, 150, 190]);
    assert.equal(map.exclusionZone.openFaces.includes('maxZ'), false);

    const destructibles = normalizeMapDestructibles(map.destructibles);
    assert.ok(destructibles);
    assert.deepEqual(destructibles.segments.map((segment) => segment.id), ['dam_wall']);
    assert.equal(destructibles.segments[0].kind, 'landmark');
    assert.deepEqual(destructibles.breakScenes[0].hideModelIds, ['storm-dam-intact']);
    assert.deepEqual(destructibles.breakScenes[0].attachedModels, [{
        modelId: 'storm-dam-gate', parentNodeName: 'dam_wall_arch_08_tier_2',
    }]);
    const malformed = normalizeMapDestructibles({ ...map.destructibles, breakScenes: [{
        ...map.destructibles.breakScenes[0],
        attachedModels: [
            { modelId: 'storm-dam-collapse', parentNodeName: 'dam_wall_arch_08_tier_2' },
            ...map.destructibles.breakScenes[0].attachedModels,
            { modelId: 'storm-dam-gate', parentNodeName: 'dam_wall_arch_07_tier_2' },
        ],
    }] });
    assert.equal(malformed.breakScenes[0].attachedModels.length, 1,
        'a scene cannot attach itself or attach the same model twice');

    const rooms = normalizeSecretRooms(map.secretRooms);
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].unlock.when, 'anyBreak');

    const water = normalizeWaterZone(map.waterZone);
    assert.ok(water);
    assert.equal(water.triggerSegmentId, 'dam_wall');
    assert.equal(water.waveSeconds, 4);
    assert.equal(water.riseSeconds, 24);
    assert.equal(water.waveOrigin, WATER_WAVE_ORIGINS.MAX_Z);
    assert.equal(water.waveOpeningWidth, 52);
    assert.equal(water.waveSourceInset, 33);
    assert.equal(water.waveFloorOffset, 4);
    assert.equal(water.targetLevel, map.size[1] / 2);
    assert.deepEqual(water.reservoirBounds, {
        min: [-90, 0, 90],
        max: [90, 75, 95],
    });
    assert.equal((water.reservoirBounds.max[2] - water.reservoirBounds.min[2]) * 3, 15);

    const intact = map.glbModels.find((model) => model.id === 'storm-dam-intact');
    assert.ok(intact.position[2] >= 80, 'the dam sits against the maxZ map edge');
    assert.equal(map.obstacles.filter((obstacle) => obstacle.pos[2] === 84).length, 2,
        'rear wall keeps side barriers while leaving the central breach open');
    assert.ok(map.destructibles.segments[0].anchor[1] >= map.size[1] * 0.6, 'the target spans most of the map height');

    for (const model of map.glbModels) assert.ok(existsSync(model.url), `missing runtime asset ${model.url}`);
    assert.ok(existsSync('assets/maps/storm_dam_siege/blender/01_dam.blend'));
    assert.ok(existsSync('assets/maps/storm_dam_siege/blender/20_dam_collapse.blend'));
});

test('the animated gate keeps its loop phase and follows a broken chunk on live and late-join maps', async () => {
    const map = MAP_PRESET_CATALOG[MAP_KEY];
    const event = { segmentId: 'dam_wall', kind: 'landmark', atSeconds: 1, yaw: 0 };
    async function loaded() {
        const result = await loadGLBMapCollection(map.glbModels, {
            loader: geometryOnlyGlbLoader, placementScale: 3,
            colliderMode: map.glbColliderMode, requireComplete: true,
        });
        const driver = new GlbAnimationDriver();
        driver.setTracks(result.animationTracks);
        const arena = {
            _glbScene: result.scene,
            currentMapDefinition: map,
            obstacles: [...result.colliders],
            _glbDynamicObstacles: result.colliders.filter((collider) => collider.dynamic),
            staticCollisionRevision: 0,
        };
        const controller = createMapBreakSceneController(arena, result.colliders, driver, []);
        const gate = result.scene.getObjectByName('glb-slot-storm-dam-gate');
        const slab = gate.getObjectByName('dam_gate_slab');
        const chunk = result.scene.getObjectByName('glb-slot-storm-dam-collapse')
            .getObjectByName('dam_wall_arch_08_tier_2');
        return { result, driver, controller, gate, slab, chunk };
    }
    const live = await loaded();
    const replica = await loaded();
    try {
        const openingOrigin = new THREE.Vector3(0, 200, 170);
        const openingDirection = new THREE.Vector3(0, 0, 1);
        const apertureHit = () => raycastArenaObstacles(
            live.result.colliders.filter((entry) => live.controller.arena.obstacles.includes(entry)),
            openingOrigin, openingDirection, 160, createArenaRayResult(),
        );
        assert.match(apertureHit()?.sourceName || '', /^dam_wall_arch_08/,
            'the intact dam blocks a ray through the future opening');
        live.driver.setElapsedSeconds(2.3);
        live.driver.advance(0);
        const phaseBefore = live.driver._tracks.find((track) => track.modelId === 'storm-dam-gate').action.time;
        const localBefore = live.slab.position.clone();
        live.controller.applyEvents([event]);
        live.driver.advance(0);
        assert.ok(live.gate.parent === live.chunk, `gate parent ${live.gate.parent?.name}`);
        assert.equal(live.gate.visible, true);
        assert.equal(live.driver._tracks.find((track) => track.modelId === 'storm-dam-gate').action.time,
            phaseBefore, 'the break does not restart the existing gate loop');
        assert.ok(live.slab.position.distanceTo(localBefore) < 0.001);

        replica.controller.applyEvents([event]);
        replica.driver.setElapsedSeconds(2.3);
        replica.driver.advance(0);
        live.result.scene.updateMatrixWorld(true);
        replica.result.scene.updateMatrixWorld(true);
        assert.ok(live.slab.getWorldPosition(new THREE.Vector3())
            .distanceTo(replica.slab.getWorldPosition(new THREE.Vector3())) < 0.001,
        'late join derives the same gate pose from event time and authored rest offset');

        live.driver.setElapsedSeconds(6.8);
        live.driver.advance(0);
        live.result.scene.updateMatrixWorld(true);
        for (const collider of live.controller.arena._glbDynamicObstacles) {
            refreshDynamicMeshCollider(collider.meshCollider, collider.box);
        }
        assert.equal(apertureHit()?.sourceName || '', '',
            'the opened center has no invisible wall collider');
        const fallenCollider = live.result.colliders.find((entry) =>
            entry.modelId === 'storm-dam-collapse' && entry.sourceName === 'dam_wall_arch_08_tier_1');
        const fallenCenter = fallenCollider.box.getCenter(new THREE.Vector3());
        const movedHit = raycastArenaObstacles(
            [fallenCollider], fallenCenter.clone().add(new THREE.Vector3(0, 0, -100)),
            new THREE.Vector3(0, 0, 1), 200, createArenaRayResult(),
        );
        assert.equal(movedHit?.sourceName, fallenCollider.sourceName,
            'the moved solid still collides at its exported pose');

        const fallenGate = live.slab.getWorldPosition(new THREE.Vector3());
        live.controller.reset();
        live.driver.advance(0);
        assert.ok(live.gate.parent === live.result.scene, `reset parent ${live.gate.parent?.name}`);
        assert.ok(live.slab.getWorldPosition(new THREE.Vector3()).distanceTo(fallenGate) > 1,
            'round reset restores the gate to its original slot');
    } finally {
        for (const item of [live, replica]) {
            item.driver.clear();
            disposeObject3DResources(item.result.scene);
        }
    }
});

test('the engine-loaded dam spans the reservoir edge and nearly reaches the ceiling', async () => {
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
        const collapse = result.scene.getObjectByName('glb-slot-storm-dam-collapse');
        assert.ok(intact);
        assert.ok(collapse);
        const wallBounds = new THREE.Box3();
        intact.traverse((child) => {
            if (/^dam_wall_arch_\d{2}(?:_tier_[0-2])?$/.test(String(child.name))) {
                wallBounds.expandByObject(child);
            }
        });
        const size = wallBounds.getSize(new THREE.Vector3());
        const centerSegment = intact.getObjectByName('dam_wall_arch_08_tier_1');
        const center = new THREE.Box3().setFromObject(centerSegment).getCenter(new THREE.Vector3());
        assert.ok(size.x >= map.size[0] * scale * 0.98, 'the concrete wall fills the map width');
        assert.ok(size.y >= map.size[1] * scale * 0.9, 'the concrete wall is almost map-height');
        assert.ok(
            Math.abs(center.z - (map.waterZone.reservoirBounds.min[2] * scale)) <= 2,
            'the dam crest is centered on the reservoir edge',
        );
        assert.ok(intact.getObjectByName('dam_reservoir_surface_nocol'));
        assert.ok(collapse.getObjectByName('dam_reservoir_surface_nocol'));
        assert.ok(collapse.getObjectByName('dam_breach_cascade_nocol'));

        const track = result.animationTracks.find((entry) => entry.modelId === 'storm-dam-collapse');
        assert.equal(track?.clipName, 'DamCollapseOnce');
        const intactJson = glbJson('assets/maps/storm_dam_siege/glb/01_dam.glb');
        const collapseJson = glbJson('assets/maps/storm_dam_siege/glb/20_dam_collapse.glb');
        const driver = new GlbAnimationDriver();
        driver.setTracks(result.animationTracks);
        const pieceNames = Array.from({ length: 5 }, (_, index) => index + 6)
            .flatMap((index) => [0, 1, 2].map((tier) => `dam_wall_arch_${String(index).padStart(2, '0')}_tier_${tier}`));
        const initial = new Map();
        for (const name of pieceNames) {
            const intactPart = intact.getObjectByName(name);
            const collapsePart = collapse.getObjectByName(name);
            assert.ok(intactPart && collapsePart, `matching chunk ${name}`);
            const intactCenter = intactPart.getWorldPosition(new THREE.Vector3());
            const collapseCenter = collapsePart.getWorldPosition(new THREE.Vector3());
            assert.ok(intactCenter.distanceTo(collapseCenter) < 0.02, `standing pose ${name}`);
            assert.ok(intactPart.getWorldQuaternion(new THREE.Quaternion())
                .angleTo(collapsePart.getWorldQuaternion(new THREE.Quaternion())) < 0.001,
            `standing rotation ${name}`);
            assert.ok(intactPart.getWorldScale(new THREE.Vector3())
                .distanceTo(collapsePart.getWorldScale(new THREE.Vector3())) < 0.001,
            `standing scale ${name}`);
            assert.deepEqual(Array.from(intactPart.geometry.attributes.position.array),
                Array.from(collapsePart.geometry.attributes.position.array), `surface shape ${name}`);
            for (const surface of [name, `${name}_fracture_nocol`]) {
                assert.deepEqual(authoredMaterial(intactJson, surface),
                    authoredMaterial(collapseJson, surface), `authored material ${surface}`);
            }
            initial.set(name, collapseCenter);
        }
        const relative = [];
        for (const seconds of [0.2, 0.6, 1.2, 2.5, 5.8, 5.96]) {
            driver.setElapsedSeconds(seconds);
            driver.advance(0);
            const positions = pieceNames.map((name) => collapse.getObjectByName(name)
                .getWorldPosition(new THREE.Vector3()));
            relative.push(positions);
        }
        const relativeChange = relative[0].flatMap((start, left) => relative[3]
            .slice(left + 1).map((end, offset) => Math.abs(
                start.distanceTo(relative[0][left + offset + 1])
                - relative[3][left].distanceTo(end),
            )));
        assert.ok(relativeChange.filter((change) => change > 12).length >= 8,
            'chunks separate from each other instead of translating as one shared rig');
        assert.ok(relative[4].some((pose, index) => pose.distanceTo(relative[0][index]) > 20),
            'the one-shot fall reaches a changed pose');
        assert.ok(Math.max(...relative[4].map((pose, index) => pose.distanceTo(relative[5][index]))) < 1,
            'the exported final hold is settled');
        driver.setElapsedSeconds(5.8);
        driver.advance(0);
        const moved = pieceNames.filter((name) => collapse.getObjectByName(name)
            .getWorldPosition(new THREE.Vector3())
            .distanceTo(initial.get(name)) > 10).length;
        assert.ok(moved >= 12, `${moved} chunks must fall independently in the exported clip`);
        const movingColliders = result.colliders.filter((entry) => entry.modelId === 'storm-dam-collapse'
            && entry.dynamic && /^dam_wall_arch_\d{2}_tier_[0-2]$/.test(entry.sourceName));
        assert.equal(movingColliders.length, 15);
        assert.equal(result.colliders.filter((entry) => entry.modelId === 'storm-dam-collapse'
            && entry.dynamic).length, 64, 'budget includes every solid mesh in the triggered model');
        assert.equal(result.colliders.some((entry) => entry.sourceName.includes('dam_reservoir')), false);
        const chips = Array.from({ length: 6 }, (_, index) =>
            collapse.getObjectByName(`dam_spall_${index}_nocol`));
        assert.ok(chips.every(Boolean), 'early decorative spalls survive export');
        const vertices = [...pieceNames.map((name) => collapse.getObjectByName(name)), ...chips];
        const vertex = new THREE.Vector3();
        let lowest = { y: Infinity, name: '', seconds: 0 };
        for (let frame = 0; frame <= 180; frame += 1) {
            driver.setElapsedSeconds(frame / 30);
            driver.advance(0);
            collapse.updateWorldMatrix(true, true);
            for (const node of vertices) {
                const position = node.geometry.attributes.position;
                for (let index = 0; index < position.count; index += 1) {
                    vertex.fromBufferAttribute(position, index).applyMatrix4(node.matrixWorld);
                    if (vertex.y < lowest.y) lowest = { y: vertex.y, name: node.name, seconds: frame / 30 };
                }
            }
        }
        assert.ok(lowest.y >= map.waterZone.waveFloorOffset * scale - 0.05,
            `fallen geometry ${lowest.name} cuts floor at ${lowest.seconds}s: ${lowest.y}`);
        driver.clear();
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
    assert.equal(system._visual.surface.visible, false);
    assert.equal(system._visual.reservoirSurface.visible, true);
    assert.equal(system._visual.reservoirSurface.name, 'water-zone-dam_basin-reservoir-surface');
    assert.equal(system._visual.waveGroup.getObjectByName('water-zone-dam_basin-wave-front') !== undefined, true);
    assert.equal(system.getZone().reservoirBounds.max[2] - system.getZone().reservoirBounds.min[2], 15);
    assert.equal(system.isPositionUnderwater({ x: 0, y: 210, z: 276 }), true);
    assert.equal(system.isPositionUnderwater({ x: 0, y: 3, z: 267 }), false);

    breakState.events.push({ segmentId: 'dam_wall', atSeconds: 1 });
    system.update(0);
    assert.equal(system.getState().phase, WATER_PHASES.WAVE);
    assert.equal(system._visual.waveGroup.position.z,
        system.getZone().bounds.max[2] - system.getZone().waveSourceInset);
    assert.equal(system._visual.fall.visible, true);
    assert.equal(system._visual.jet.visible, false);
    const openingScale = system._visual.waveGroup.scale.x;
    system.update(2);
    assert.ok(system._visual.waveGroup.position.z < system.getZone().reservoirBounds.min[2]);
    assert.ok(system._visual.waveGroup.scale.x > openingScale);
    assert.equal(system._visual.jet.visible, true);

    const replica = new WaterZoneSystem(owner);
    replica.startRound();
    replica.setNetworkReplica(true);
    replica.applyNetworkState(system.serializeNetworkState());
    assert.equal(replica._visual.waveGroup.position.z, system._visual.waveGroup.position.z);
    assert.deepEqual(Array.from(replica._visual.spray.geometry.attributes.position.array),
        Array.from(system._visual.spray.geometry.attributes.position.array),
        'late-joining clients derive the same spray pose from phase time');
    assert.deepEqual(replica._visual.waveGroup.scale.toArray(), system._visual.waveGroup.scale.toArray());
    assert.deepEqual(Array.from(replica._visual.jet.geometry.attributes.position.array),
        Array.from(system._visual.jet.geometry.attributes.position.array),
        'the same event phase reconstructs the whole jet envelope');
    assert.equal(replica._visual.waveMaterials[0].material.opacity,
        system._visual.waveMaterials[0].material.opacity);
    assert.equal(replica._visual.foamMaterial.opacity, system._visual.foamMaterial.opacity);

    system.update(1.999);
    const endFoamOpacity = system._visual.foamMaterial.opacity;
    assert.ok(system._visual.waveMaterials[0].material.opacity < 0.005,
        'crest fades before the rise begins');
    system.update(0.001);
    assert.equal(system.getState().phase, WATER_PHASES.RISING);
    assert.ok(Math.abs(system._visual.foamMaterial.opacity - endFoamOpacity) < 0.01);
    assert.equal(system._visual.surface.visible, false,
        'water remains under the authored floor until the actual level reaches it');
    system.update(1.5);
    assert.equal(system._visual.surface.visible, true);
    assert.ok(system._visual.foamMaterial.opacity > 0,
        'foam overlaps the emerging physical water surface');
    replica.applyNetworkState(system.serializeNetworkState());
    assert.equal(replica._visual.foamMaterial.opacity, system._visual.foamMaterial.opacity);
    assert.equal(replica._visual.surface.visible, system._visual.surface.visible);
    assert.deepEqual(Array.from(replica._visual.surface.geometry.attributes.position.array),
        Array.from(system._visual.surface.geometry.attributes.position.array),
        'the rising surface is phase-derived for late joiners');
    system.update(22.5);
    assert.equal(system.getState().phase, WATER_PHASES.FLOODED);
    assert.equal(system.getState().level, map.waterZone.targetLevel * system.scale);

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

    const resources = new Set();
    const disposed = new Set();
    system._visual.group.traverse((node) => {
        if (node.geometry) resources.add(node.geometry);
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            if (material) resources.add(material);
        }
    });
    for (const resource of resources) resource.addEventListener('dispose', () => disposed.add(resource));
    system.clear();
    replica.clear();
    assert.equal(removed.length, 2);
    assert.equal(disposed.size, resources.size, 'round reset releases every water visual resource');
});

test('custom map schema preserves and scales water zones into runtime space', () => {
    const document = normalizeMapSchemaDocument({
        schemaVersion: 4,
        arenaSize: { width: 540, height: 270, depth: 540 },
        waterZone: {
            id: 'custom_basin',
            triggerSegmentId: 'custom_dam',
            bounds: { min: [-270, 0, -270], max: [270, 270, 270] },
            reservoirBounds: { min: [-270, 0, 270], max: [270, 225, 285] },
            startLevel: 0,
            targetLevel: 135,
            waveSeconds: 2,
            riseSeconds: 20,
            waveOrigin: 'maxZ',
            waveOpeningWidth: 150,
            waveSourceInset: 66,
            waveFloorOffset: 12,
        },
    });
    const runtime = toArenaMapDefinition(document, { mapScale: 3 }).map.waterZone;
    assert.equal(runtime.triggerSegmentId, 'custom_dam');
    assert.equal(runtime.waveOrigin, WATER_WAVE_ORIGINS.MAX_Z);
    assert.equal(runtime.targetLevel, 45);
    assert.equal(runtime.waveOpeningWidth, 50);
    assert.equal(runtime.waveSourceInset, 22);
    assert.equal(runtime.waveFloorOffset, 4);
    assert.deepEqual(runtime.bounds.max, [90, 90, 90]);
    assert.deepEqual(runtime.reservoirBounds, {
        min: [-90, 0, 90],
        max: [90, 75, 95],
    });
});

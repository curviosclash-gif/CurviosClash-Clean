import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';

import { MAP_PRESET_CATALOG } from '../src/core/config/maps/MapPresetCatalog.js';
import { loadGLBMapCollection } from '../src/entities/GLBMapLoader.js';
import { createMapBreakSceneController } from '../src/entities/arena/MapBreakSceneController.js';
import { refreshDynamicMeshCollider } from '../src/entities/arena/StaticMeshCollider.js';
import { GlbAnimationDriver } from '../src/entities/arena/GlbAnimationDriver.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';
import { normalizeMapDestructibles } from '../src/shared/contracts/MapDestructibleContract.js';
import { normalizeSecretRooms } from '../src/shared/contracts/SecretRoomContract.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';
import { placeMapGlbModel, worldMeshBounds } from './helpers/placed-glb-model.mjs';

const MAP_KEY = 'storm_bridge_siege';
const MAP_SCALE = 3;
const PART = /^bridge_span_/;

function glbJson(path) {
    const bytes = readFileSync(path);
    return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
}

function authoredMaterial(json, nodeName) {
    const node = json.nodes.find((entry) => entry.name === nodeName);
    assert.ok(node && Number.isInteger(node.mesh), `GLB mesh ${nodeName}`);
    return json.materials[json.meshes[node.mesh].primitives[0].material];
}

async function loadBridge() {
    const map = MAP_PRESET_CATALOG[MAP_KEY];
    const result = await loadGLBMapCollection(map.glbModels, {
        loader: geometryOnlyGlbLoader,
        placementScale: MAP_SCALE,
        colliderMode: map.glbColliderMode,
        requireComplete: true,
    });
    const driver = new GlbAnimationDriver();
    driver.setTracks(result.animationTracks);
    return { map, result, driver };
}

function disposeBridge({ result, driver }) {
    driver.clear();
    disposeObject3DResources(result.scene);
}

test('wave 6 bridge is a playable destructible landmark with a secret portal', () => {
    const map = MAP_PRESET_CATALOG[MAP_KEY];
    assert.ok(map, `${MAP_KEY} must be registered`);
    assert.equal(map.singlePlayerScenario?.gameMode, 'HUNT');

    const destructibles = normalizeMapDestructibles(map.destructibles);
    assert.ok(destructibles, 'the bridge must expose destructible geometry');
    assert.deepEqual(destructibles.gameModes, ['HUNT']);
    assert.deepEqual(destructibles.segments.map((segment) => segment.id), ['bridge_span']);
    assert.equal(destructibles.segments[0].kind, 'landmark');
    assert.equal(destructibles.breakScenes.length, 1);
    assert.deepEqual(destructibles.breakScenes[0].hideModelIds, ['storm-bridge-intact', 'storm-bridge-train']);

    const rooms = normalizeSecretRooms(map.secretRooms);
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].unlock.when, 'anyBreak');
    assert.equal(rooms[0].unlock.delaySeconds, 4);
    assert.ok(rooms[0].items.length >= 8);

    for (const model of map.glbModels) {
        assert.ok(existsSync(model.url), `missing runtime asset ${model.url}`);
    }
    assert.ok(existsSync('assets/maps/storm_bridge_siege/blender/01_bridge.blend'));
    assert.ok(existsSync('assets/maps/storm_bridge_siege/blender/20_bridge_collapse.blend'));
});

// The loader stands every model on its bind-pose bottom and centres it there, so a train placed at
// the origin lands on the street and runs off the east end. The preset has to put it back on the
// deck: wheels on the deck top, inside the deck's width, and a run centred on the span.
test('the bridge train runs on the deck for its whole loop', async () => {
    const map = MAP_PRESET_CATALOG[MAP_KEY];
    const bridge = await placeMapGlbModel(map, 'storm-bridge-intact');
    const deck = worldMeshBounds(bridge.scene, (mesh) => mesh.name === 'bridge_span_deck');
    assert.ok(!deck.isEmpty(), 'the intact bridge has a deck mesh');
    const train = await placeMapGlbModel(map, 'storm-bridge-train');
    const steps = 24;
    let runMinX = Infinity;
    let runMaxX = -Infinity;
    for (let step = 0; step <= steps; step += 1) {
        const time = Math.min(train.clip.duration * (step / steps), train.clip.duration - 1e-4);
        train.pose(time);
        const body = worldMeshBounds(train.scene);
        const at = `t=${time.toFixed(2)}`;
        assert.ok(Math.abs(body.min.y - deck.max.y) <= 0.05, `${at}: train bottom ${body.min.y.toFixed(2)} not on deck top ${deck.max.y.toFixed(2)}`);
        assert.ok(body.min.z >= deck.min.z && body.max.z <= deck.max.z, `${at}: train leaves the deck width`);
        runMinX = Math.min(runMinX, body.min.x);
        runMaxX = Math.max(runMaxX, body.max.x);
    }
    const deckCentre = (deck.min.x + deck.max.x) / 2;
    assert.ok(Math.abs((runMinX + runMaxX) / 2 - deckCentre) <= 0.5,
        `train run ${runMinX.toFixed(1)}..${runMaxX.toFixed(1)} is not centred on the deck ${deck.min.x.toFixed(1)}..${deck.max.x.toFixed(1)}`);
});

// The dam's contract proves its collapse clip, its hide/restore cycle and its spawn clearance; the
// bridge only had registration and the train. These are the same checks for the bridge.
test('the collapse model starts in the intact pose and keeps the authored surfaces', async () => {
    const bridge = await loadBridge();
    try {
        const intact = bridge.result.scene.getObjectByName('glb-slot-storm-bridge-intact');
        const collapse = bridge.result.scene.getObjectByName('glb-slot-storm-bridge-collapse');
        assert.ok(intact && collapse);
        const track = bridge.result.animationTracks.find((entry) => entry.modelId === 'storm-bridge-collapse');
        assert.equal(track?.clipName, 'BridgeCollapseOnce');
        assert.ok(track.durationSeconds > 2 && track.durationSeconds < 8, `fall lasts ${track.durationSeconds}s`);
        const intactJson = glbJson('assets/maps/storm_bridge_siege/glb/01_bridge.glb');
        const collapseJson = glbJson('assets/maps/storm_bridge_siege/glb/20_bridge_collapse.glb');
        const names = [];
        intact.traverse((node) => { if (node.isMesh && PART.test(node.name)) names.push(node.name); });
        assert.equal(names.length, 15, 'deck, spine, rails, two towers, two crosses, seven hangers');
        for (const name of names) {
            const left = intact.getObjectByName(name);
            const right = collapse.getObjectByName(name);
            assert.ok(right, `matching part ${name}`);
            assert.ok(left.getWorldPosition(new THREE.Vector3()).distanceTo(right.getWorldPosition(new THREE.Vector3())) < 0.02, `standing pose ${name}`);
            assert.ok(left.getWorldQuaternion(new THREE.Quaternion()).angleTo(right.getWorldQuaternion(new THREE.Quaternion())) < 0.001, `standing rotation ${name}`);
            assert.deepEqual(Array.from(left.geometry.attributes.position.array), Array.from(right.geometry.attributes.position.array), `surface shape ${name}`);
            assert.deepEqual(authoredMaterial(intactJson, name), authoredMaterial(collapseJson, name), `authored material ${name}`);
        }
    } finally {
        disposeBridge(bridge);
    }
});

test('the one-shot fall moves every part, settles on its final hold and stays out of the vault', async () => {
    const bridge = await loadBridge();
    try {
        const { result, driver, map } = bridge;
        const collapse = result.scene.getObjectByName('glb-slot-storm-bridge-collapse');
        const parts = [];
        collapse.traverse((node) => { if (node.isMesh && PART.test(node.name)) parts.push(node); });
        const worldOf = (seconds) => {
            driver.setElapsedSeconds(seconds);
            driver.advance(0);
            collapse.updateWorldMatrix(true, true);
            return parts.map((part) => part.getWorldPosition(new THREE.Vector3()));
        };
        const start = worldOf(0);
        const end = worldOf(5.8);
        const hold = worldOf(5.96);
        const moved = end.filter((pose, index) => pose.distanceTo(start[index]) > 10).length;
        assert.equal(moved, parts.length, `${moved} of ${parts.length} parts fell more than 10 units`);
        assert.ok(Math.max(...end.map((pose, index) => pose.distanceTo(hold[index]))) < 1, 'the exported final hold is settled');
        const dynamic = result.colliders.filter((entry) => entry.modelId === 'storm-bridge-collapse');
        assert.equal(dynamic.length, parts.length, 'every solid part of the triggered model is a collider');
        assert.ok(dynamic.every((entry) => entry.dynamic), 'the falling colliders follow the clip');
        // The vault ceiling is the top of the room (map units, scaled); wreckage must not reach
        // into the room below it.
        const vaultCeiling = map.secretRooms[0].bounds.max[1] * MAP_SCALE;
        const vertex = new THREE.Vector3();
        let lowest = Infinity;
        for (let frame = 0; frame <= 150; frame += 1) {
            driver.setElapsedSeconds(frame / 30);
            driver.advance(0);
            collapse.updateWorldMatrix(true, true);
            for (const part of parts) {
                const position = part.geometry.attributes.position;
                for (let index = 0; index < position.count; index += 1) {
                    lowest = Math.min(lowest, vertex.fromBufferAttribute(position, index).applyMatrix4(part.matrixWorld).y);
                }
            }
        }
        assert.ok(lowest > vaultCeiling - 1, `wreckage reaches y ${lowest.toFixed(1)}, the vault ceiling is ${vaultCeiling}`);
    } finally {
        disposeBridge(bridge);
    }
});

test('the collapse hides the bridge and the train, and a round reset restores both', async () => {
    const bridge = await loadBridge();
    try {
        const { map, result, driver } = bridge;
        const arena = {
            _glbScene: result.scene,
            currentMapDefinition: map,
            obstacles: [...result.colliders],
            _glbDynamicObstacles: result.colliders.filter((collider) => collider.dynamic),
            staticCollisionRevision: 0,
        };
        const controller = createMapBreakSceneController(arena, result.colliders, driver, []);
        const slot = (id) => result.scene.getObjectByName(`glb-slot-${id}`);
        const live = ['storm-bridge-intact', 'storm-bridge-train'].map(slot);
        assert.ok(live.every((node) => node?.visible), 'intact bridge and train start visible');
        assert.equal(slot('storm-bridge-collapse').visible, false, 'the collapse model waits hidden');
        controller.applyEvents([{ segmentId: 'bridge_span', kind: 'landmark', atSeconds: 1, yaw: 0 }]);
        driver.advance(0);
        assert.ok(live.every((node) => node.visible === false), 'the train cannot keep running on a fallen deck');
        assert.equal(slot('storm-bridge-collapse').visible, true);
        controller.reset();
        driver.advance(0);
        assert.ok(live.every((node) => node.visible), 'round reset restores bridge and train');
        assert.equal(slot('storm-bridge-collapse').visible, false);
    } finally {
        disposeBridge(bridge);
    }
});

test('spawns and items clear the standing bridge and its settled wreck', async () => {
    const bridge = await loadBridge();
    try {
        const { map, result, driver } = bridge;
        const points = [map.playerSpawn, ...map.botSpawns, ...map.items.map((item) => ({ x: item.pos[0], y: item.pos[1], z: item.pos[2] }))]
            .map((point) => new THREE.Vector3(point.x * MAP_SCALE, point.y * MAP_SCALE, point.z * MAP_SCALE));
        const margin = 2;
        const clears = (modelId) => {
            const colliders = result.colliders.filter((entry) => entry.modelId === modelId);
            assert.ok(colliders.length > 0, `${modelId} has colliders`);
            for (const collider of colliders) {
                if (collider.dynamic) refreshDynamicMeshCollider(collider.meshCollider, collider.box);
                const box = collider.box.clone().expandByScalar(margin);
                for (const point of points) assert.equal(box.containsPoint(point), false, `${modelId} ${collider.sourceName} holds (${point.toArray().map(Math.round)})`);
            }
        };
        clears('storm-bridge-intact');
        driver.setElapsedSeconds(5.8);
        driver.advance(0);
        result.scene.updateMatrixWorld(true);
        clears('storm-bridge-collapse');
    } finally {
        disposeBridge(bridge);
    }
});

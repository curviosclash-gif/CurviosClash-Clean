import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
    EDITOR_AUTHORING_DOCUMENT_VERSION,
    EDITOR_LAYER_DEFINITIONS,
    createDefaultLayerState,
    createEditorAuthoringDocument,
    getDefaultEditorLayerId,
    normalizeLayerState,
    parseEditorAuthoringDocument,
} from '../editor/js/EditorAuthoringDocument.js';
import { EDITOR_PREFABS, EDITOR_PREFAB_CATALOG_VERSION } from '../editor/js/ui/EditorPrefabCatalog.js';
import {
    getEditorTemplateRegistryDescriptor,
    resolveEditorBuildEntryAssetId,
    resolveEditorTemplateImportCapability,
} from '../editor/js/ui/EditorBuildCatalog.js';
import { EditorObjectRegistry } from '../editor/js/EditorObjectRegistry.js';
import { EditorMapManager } from '../editor/js/EditorMapManager.js';
import { toArenaMapDefinition } from '../src/entities/MapSchema.js';
import { ArenaGeometryCompilePipeline } from '../src/entities/arena/ArenaGeometryCompilePipeline.js';
import { ArenaCollision } from '../src/entities/arena/ArenaCollision.js';

function createMapManager(callbacks = {}) {
    return new EditorMapManager({
        objectsContainer: new THREE.Group(),
        transformControl: { object: null, detach() {} },
    }, {
        getClone() { return null; },
        setCloneHydrationHandler() {},
    }, callbacks);
}

test('editor authoring document keeps metadata outside the runtime map', () => {
    const runtimeMap = { schemaVersion: 4, arenaSize: { width: 100, height: 50, depth: 100 } };
    const documentValue = createEditorAuthoringDocument({
        map: runtimeMap,
        workspaceMetadata: {
            portal_1: { type: 'portal', groupId: 'pair-a', portalPartnerId: 'portal_2', editorLayerId: 'portals' },
        },
        layerState: { activeLayerId: 'portals', layers: { portals: { visible: false, locked: true, solo: false } } },
    });

    assert.equal(documentValue.contractVersion, EDITOR_AUTHORING_DOCUMENT_VERSION);
    assert.deepEqual(documentValue.map, runtimeMap);
    assert.equal('authoring' in documentValue.map, false);
    assert.equal(documentValue.authoring.workspaceMetadata.portal_1.portalPartnerId, 'portal_2');
    assert.equal(documentValue.authoring.layerState.layers.portals.locked, true);
});

test('plain legacy map remains importable as an editor document', () => {
    const legacyMap = { schemaVersion: 4, hardBlocks: [] };
    const parsed = parseEditorAuthoringDocument(JSON.stringify(legacyMap));
    assert.equal(parsed.isAuthoringDocument, false);
    assert.deepEqual(parsed.map, legacyMap);
    assert.equal(parsed.layerState.activeLayerId, 'geometry');
});

test('layer state is normalized to the six stable authoring layers', () => {
    const state = normalizeLayerState({ activeLayerId: 'spawns', layers: { spawns: { solo: true } } });
    assert.equal(Object.keys(state.layers).length, EDITOR_LAYER_DEFINITIONS.length);
    assert.equal(state.activeLayerId, 'spawns');
    assert.equal(state.layers.spawns.solo, true);
    assert.deepEqual(normalizeLayerState(null), createDefaultLayerState());
    assert.equal(getDefaultEditorLayerId('item'), 'pickups');
    assert.equal(getDefaultEditorLayerId('aircraft'), 'decoration');
});

test('built-in prefab catalog exposes reusable grouped authoring templates', () => {
    assert.equal(EDITOR_PREFAB_CATALOG_VERSION, 'curvios-editor-prefabs.v1');
    assert.equal(EDITOR_PREFABS.length, 4);
    assert.ok(EDITOR_PREFABS.every((prefab) => prefab.parts.length >= 3));
    const descriptor = getEditorTemplateRegistryDescriptor();
    const capability = resolveEditorTemplateImportCapability(descriptor);
    assert.equal(descriptor.status, 'ready');
    assert.equal(capability.available, true);
    assert.equal(capability.entryCount, EDITOR_PREFABS.length);
});

test('build previews request assets only for externally modeled entries', () => {
    assert.equal(resolveEditorBuildEntryAssetId({ tool: 'spawn', subType: 'player' }), null);
    assert.equal(resolveEditorBuildEntryAssetId({ tool: 'checkpoint', subType: 'finish' }), null);
    assert.equal(resolveEditorBuildEntryAssetId({ tool: 'tunnel', subType: 'tunnel' }), null);
    assert.equal(resolveEditorBuildEntryAssetId({ tool: 'tunnel', subType: 'trail_arrow' }), 'trail_arrow');
    assert.equal(resolveEditorBuildEntryAssetId({ tool: 'portal', subType: 'portal_ring' }), 'portal_ring');
    assert.equal(resolveEditorBuildEntryAssetId({ tool: 'item', subType: 'item_crystal' }), 'item_crystal');
});

test('object registry spatial index tracks movement and removal', () => {
    const core = { objectsContainer: { add() {} } };
    const registry = new EditorObjectRegistry(core);
    const createObject = (type, x, z) => ({
        position: { x, y: 0, z },
        userData: { type },
        traverse(visitor) { visitor(this); },
    });
    const near = registry.registerObject(createObject('hard', 20, 20));
    const far = registry.registerObject(createObject('foam', 2200, 2200));
    assert.deepEqual(registry.queryNear({ x: 0, z: 0 }, 500), [near]);
    far.position.x = 100;
    far.position.z = 100;
    registry.updateObjectSpatial(far);
    assert.equal(registry.queryNear({ x: 0, z: 0 }, 500).length, 2);
    registry.unregisterObjectById(near.userData.id);
    assert.deepEqual(registry.queryNear({ x: 0, z: 0 }, 500), [far]);
});

test('imported numeric object ids advance the generator past reusable ids', () => {
    const core = { objectsContainer: { add() {} } };
    const registry = new EditorObjectRegistry(core);
    const createObject = (type) => ({
        position: { x: 0, y: 0, z: 0 },
        userData: { type },
        traverse(visitor) { visitor(this); },
    });

    const imported = registry.registerObject(createObject('portal'), { requestedId: 'portal_12' });
    registry.unregisterObjectById(imported.userData.id);
    const created = registry.registerObject(createObject('portal'));

    assert.equal(created.userData.id, 'portal_13');
});

test('editor rejects duplicate player spawns and finish checkpoints before export', () => {
    const rejected = [];
    const manager = createMapManager({ onObjectCreationRejected: (event) => rejected.push(event) });
    const playerSpawn = manager.createMesh('spawn', 'player', -100, 100, 0, 0, { id: 'player_a' });
    const finish = manager.createMesh('checkpoint', 'finish', 100, 100, 0, 0, { id: 'finish_a' });

    assert.equal(manager.createMesh('spawn', 'player', 100, 100, 0, 0, { id: 'player_b' }), null);
    assert.equal(manager.createMesh('checkpoint', 'finish', 200, 100, 0, 0, { id: 'finish_b' }), null);
    assert.equal(manager.getObjectCount(), 2);
    assert.deepEqual(rejected.map(({ type, subType }) => [type, subType]), [
        ['spawn', 'player'],
        ['checkpoint', 'finish'],
    ]);

    const exported = JSON.parse(manager.generateJSONExport({ width: 2000, height: 1000, depth: 2000 }));
    assert.equal(exported.playerSpawn.id, playerSpawn.userData.id);
    assert.equal(exported.parcours.finish.id, finish.userData.id);
});

test('removing a portal clears its reciprocal partner reference', () => {
    const manager = createMapManager();
    const first = manager.createMesh('portal', null, 0, 100, 0, 50, { id: 'portal_1' });
    const second = manager.createMesh('portal', null, 200, 100, 0, 50, { id: 'portal_2' });
    first.userData.portalPartnerId = second.userData.id;
    second.userData.portalPartnerId = first.userData.id;

    manager.removeObject(first);

    assert.equal(second.userData.portalPartnerId, '');
    assert.equal(manager.getObjectById(first.userData.id), null);
});

test('tunnel spatial index follows transformed endpoints immediately', () => {
    const manager = createMapManager();
    const tunnel = manager.createMesh('tunnel', null, 0, 0, 0, 50, {
        id: 'tunnel_a',
        pointA: new THREE.Vector3(-100, 0, 0),
        pointB: new THREE.Vector3(100, 0, 0),
        radius: 50,
    });

    tunnel.position.set(5000, 0, 0);
    manager.notifyObjectMutated(tunnel);

    assert.deepEqual(manager.queryObjectsNear({ x: 5000, z: 0 }, 100), [tunnel]);
    assert.deepEqual(manager.queryObjectsNear({ x: 0, z: 0 }, 100), []);
});

test('editor map roundtrip preserves advanced block, portal, GLB and parcours fields', () => {
    const manager = createMapManager();
    manager.importFromJSON(JSON.stringify({
        arenaSize: { width: 2800, height: 950, depth: 2400 },
        hardBlocks: [{
            id: 'rotated_tunnel_block', x: 0, y: 100, z: 0,
            width: 300, height: 200, depth: 100, rotateY: Math.PI / 3,
            tunnel: { radius: 30, axis: 'x' },
        }],
        portals: [{ id: 'portal_a', x: 20, y: 100, z: 30, radius: 60, forward: [0, 1, 0] }],
        glbModels: [{
            id: 'demo/model#glb_scale', url: 'assets/demo.glb', position: [1, 2, 3],
            rotation: [0, 0.5, 0], scale: 2.5,
        }],
        parcours: {
            enabled: true,
            routeId: 'advanced_route',
            checkpoints: [{
                id: 'checkpoint_a', type: 'gate', pos: [0, 100, 0], radius: 8,
                forward: [0, 0, -1], nextIds: ['finish_a'], params: { lane: 2 },
            }],
            finish: {
                id: 'finish_a', type: 'finish', pos: [500, 100, 0], radius: 10,
                forward: [1, 0, 0], params: { reward: 'gold' },
            },
        },
    }));

    const exported = JSON.parse(manager.generateJSONExport({ width: 2800, height: 950, depth: 2400 }));
    assert.deepEqual(exported.hardBlocks[0].tunnel, { radius: 30, axis: 'x' });
    assert.equal(exported.hardBlocks[0].rotateY, Math.PI / 3);
    assert.deepEqual(exported.portals[0].forward.map((value) => Math.round(value)), [0, 1, 0]);
    assert.equal(exported.glbModels[0].scale, 2.5);
    assert.equal(exported.glbModels[0].targetSize, 0);
    assert.deepEqual(exported.parcours.checkpoints[0].nextIds, ['finish_a']);
    assert.deepEqual(exported.parcours.checkpoints[0].params, { lane: 2 });
    assert.deepEqual(exported.parcours.finish.params, { reward: 'gold' });

    for (const checkpoint of [...manager.core.objectsContainer.children].filter((object) => object.userData.type === 'checkpoint')) {
        manager.removeObject(checkpoint);
    }
    const withoutParcoursObjects = JSON.parse(manager.generateJSONExport({ width: 2800, height: 950, depth: 2400 }));
    assert.notEqual(withoutParcoursObjects.parcours?.enabled, true);
    assert.equal(withoutParcoursObjects.parcours?.checkpoints?.length || 0, 0);
    assert.equal(withoutParcoursObjects.parcours?.finish, undefined);
});

test('checkpoint orientation metadata follows the rendered rotation', () => {
    const manager = createMapManager();
    const checkpoint = manager.createMesh('checkpoint', 'gate', 0, 100, 0, 0, {
        cpForward: [0, 1, 0],
    });
    const visualForward = new THREE.Vector3(0, 0, 1).applyQuaternion(checkpoint.quaternion);
    assert.ok(visualForward.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-9);

    checkpoint.rotation.set(0, Math.PI / 2, 0);
    manager.notifyObjectMutated(checkpoint);
    assert.ok(new THREE.Vector3(...checkpoint.userData.cpForward).distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-9);
});

test('rotated blocks occupy their rotated editor spatial cells', () => {
    const manager = createMapManager();
    const block = manager.createMesh('hard', null, 0, 100, 0, 0, {
        sizeX: 3000, sizeY: 100, sizeZ: 20, rotateY: Math.PI / 2,
    });
    assert.ok(manager.queryObjectsNear({ x: 0, z: 1400 }, 0).includes(block));
});

test('rotated authored blocks compile with exact runtime collision geometry', () => {
    const definition = toArenaMapDefinition({
        arenaSize: { width: 100, height: 50, depth: 100 },
        hardBlocks: [{ x: 0, y: 5, z: 0, width: 10, height: 10, depth: 2, rotateY: Math.PI / 2 }],
    }).map;
    assert.equal(definition.obstacles[0].rotateY, Math.PI / 2);

    const arena = {
        obstacles: [],
        bounds: { minX: -50, maxX: 50, minY: 0, maxY: 50, minZ: -50, maxZ: 50 },
        _pendingObstacleGeos: [], _pendingFoamGeos: [],
        _pendingObstacleEdgeGeos: [], _pendingFoamEdgeGeos: [],
    };
    const pipeline = new ArenaGeometryCompilePipeline(arena);
    pipeline.compileObstacleStage({ obstacleDefs: definition.obstacles, scale: 1 });
    assert.ok(arena.obstacles[0].meshCollider);
    const collision = new ArenaCollision(arena);
    assert.equal(collision.checkCollisionFast(new THREE.Vector3(0, 5, 4), 0.1), true);
    assert.equal(collision.checkCollisionFast(new THREE.Vector3(4, 5, 0), 0.1), false);
    [...arena._pendingObstacleGeos, ...arena._pendingObstacleEdgeGeos].forEach((geometry) => geometry.dispose());
});

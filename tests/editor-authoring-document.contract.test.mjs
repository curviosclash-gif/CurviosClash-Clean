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

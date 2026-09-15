import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { generateJSONExport, importFromJSON } from '../editor/js/EditorMapSerializer.js';

const ARENA_SIZE = { width: 2800, height: 950, depth: 2400 };

function createSceneObject(userData, position = [0, 0, 0]) {
    const object = new THREE.Group();
    object.position.set(position[0], position[1], position[2]);
    object.userData = { ...userData };
    return object;
}

function createExportManager(children, mapDocumentMeta = {}) {
    const byId = new Map(children.map((child) => [child.userData.id, child]));
    return {
        core: { objectsContainer: { children } },
        mapDocumentMeta,
        getObjectById(id) {
            return byId.get(id) || null;
        },
        syncTunnelEndpointsFromMesh() {},
    };
}

function createImportManager() {
    const calls = [];
    return {
        calls,
        core: { objectsContainer: { children: [] } },
        mapDocumentMeta: {},
        clearAllObjects() {},
        withSceneMutation(callback) { callback(); },
        queueSceneUiRefresh() {},
        createMesh(...args) { calls.push(args); },
    };
}

function portalObject(id, partnerId = '') {
    return createSceneObject({
        id,
        type: 'portal',
        sizeInfo: 80,
        ...(partnerId ? { portalPartnerId: partnerId } : {}),
    });
}

test('undo snapshot import keeps guessed authoring modes out of the map metadata', () => {
    // Fresh map with a single block: the schema normalizer guesses dynamic/fallback-random.
    const emptyManager = createExportManager([
        createSceneObject({ id: 'block_1', type: 'hard', sizeX: 70, sizeY: 70, sizeZ: 70, sizeInfo: 35 }),
    ]);
    const snapshot = generateJSONExport(emptyManager, ARENA_SIZE);
    const snapshotDocument = JSON.parse(snapshot);
    assert.equal(snapshotDocument.portalMode, 'dynamic');
    assert.equal(snapshotDocument.itemSpawnMode, 'fallback-random');

    // Ctrl+Z re-imports that snapshot.
    const importManager = createImportManager();
    importFromJSON(importManager, snapshot);
    assert.equal(importManager.mapDocumentMeta.portalMode, undefined);
    assert.equal(importManager.mapDocumentMeta.itemSpawnMode, undefined);

    // The author then places a portal pair and an item anchor and saves again.
    const authoredManager = createExportManager([
        createSceneObject({ id: 'block_1', type: 'hard', sizeX: 70, sizeY: 70, sizeZ: 70, sizeInfo: 35 }),
        portalObject('portal_a', 'portal_b'),
        portalObject('portal_b', 'portal_a'),
        createSceneObject({ id: 'item_1', type: 'item', subType: 'item_rocket' }),
    ], importManager.mapDocumentMeta);
    const authoredDocument = JSON.parse(generateJSONExport(authoredManager, ARENA_SIZE));

    assert.equal(authoredDocument.portalMode, 'hybrid');
    assert.equal(authoredDocument.itemSpawnMode, 'anchor-only');
});

test('author-set authoring modes that deviate from the content survive an import roundtrip', () => {
    const authoredManager = createExportManager([
        portalObject('portal_a', 'portal_b'),
        portalObject('portal_b', 'portal_a'),
        createSceneObject({ id: 'item_1', type: 'item', subType: 'item_rocket' }),
    ], { portalMode: 'authored', itemSpawnMode: 'hybrid' });
    const json = generateJSONExport(authoredManager, ARENA_SIZE);
    assert.equal(JSON.parse(json).portalMode, 'authored');

    const importManager = createImportManager();
    importFromJSON(importManager, json);
    assert.equal(importManager.mapDocumentMeta.portalMode, 'authored');
    assert.equal(importManager.mapDocumentMeta.itemSpawnMode, 'hybrid');
});

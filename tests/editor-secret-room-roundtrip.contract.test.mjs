import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { generateJSONExport, importFromJSON } from '../editor/js/EditorMapSerializer.js';

const ARENA_SIZE = { width: 2800, height: 950, depth: 2400 };

// Already in the shape the map schema normalizes to, so the block has to come back byte for byte.
const SECRET_ROOMS = [
    {
        id: 'vault',
        modes: ['HUNT'],
        entryPortal: { pos: [-140, 20, 0], color: 16766720 },
        roomPortal: { pos: [0, -10, 0] },
        bounds: { min: [-20, -16, -20], max: [20, -4, 20] },
        ejectPoint: { pos: [0, 34, -140], yawDeg: 180 },
        stayLimitSeconds: 20,
        refillSeconds: 30,
        items: [{ pos: [5, -10, 5], type: 'ROCKET' }],
        unlock: { destructible: 'eiffel_tower', when: 'anyBreak', delaySeconds: 4 },
    },
];

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
    return {
        core: { objectsContainer: { children: [] } },
        mapDocumentMeta: {},
        clearAllObjects() {},
        withSceneMutation(callback) { callback(); },
        queueSceneUiRefresh() {},
        createMesh() {},
    };
}

function authoredMapJSON(extra) {
    const blocks = [createSceneObject({ id: 'block_1', type: 'hard', sizeX: 70, sizeY: 70, sizeZ: 70, sizeInfo: 35 })];
    const document = JSON.parse(generateJSONExport(createExportManager(blocks), ARENA_SIZE));
    return JSON.stringify({ ...document, ...extra });
}

test('a secret room survives an editor import/export roundtrip untouched', () => {
    const importManager = createImportManager();
    importFromJSON(importManager, authoredMapJSON({ secretRooms: SECRET_ROOMS }));

    const exportManager = createExportManager(
        [createSceneObject({ id: 'block_1', type: 'hard', sizeX: 70, sizeY: 70, sizeZ: 70, sizeInfo: 35 })],
        importManager.mapDocumentMeta
    );
    const exported = JSON.parse(generateJSONExport(exportManager, ARENA_SIZE));

    assert.deepEqual(exported.secretRooms, SECRET_ROOMS);
});

test('a map without secret rooms exports no secret room field', () => {
    const importManager = createImportManager();
    importFromJSON(importManager, authoredMapJSON({}));

    const exportManager = createExportManager(
        [createSceneObject({ id: 'block_1', type: 'hard', sizeX: 70, sizeY: 70, sizeZ: 70, sizeInfo: 35 })],
        importManager.mapDocumentMeta
    );
    const exported = JSON.parse(generateJSONExport(exportManager, ARENA_SIZE));

    assert.equal('secretRooms' in exported, false);
});

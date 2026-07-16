import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { GLB_GALLERY_MODEL_COUNT } from '../src/core/config/maps/presets/glb_gallery.js';
import { createMapDocument, toArenaMapDefinition } from '../src/entities/MapSchema.js';
import { EDITOR_OBJECT_TYPES } from '../src/shared/contracts/EditorAuthoringContract.js';
import {
    getEditorBuildEntriesForCategory,
    resolveEditorBuildEntryAssetId,
} from '../editor/js/ui/EditorBuildCatalog.js';
import { generateJSONExport, importFromJSON } from '../editor/js/EditorMapSerializer.js';

test('editor catalog exposes every local GLB gallery model as a decoration asset', () => {
    const entries = getEditorBuildEntriesForCategory('glb');
    assert.equal(EDITOR_OBJECT_TYPES.GLB, 'glb');
    assert.equal(entries.length, GLB_GALLERY_MODEL_COUNT);
    assert.equal(new Set(entries.map(resolveEditorBuildEntryAssetId)).size, GLB_GALLERY_MODEL_COUNT);
    assert.ok(entries.every((entry) => entry.tool === 'glb' && entry.subType.includes('/')));
});

test('map schema preserves GLB collections and scales authored placement units for runtime', () => {
    const map = createMapDocument({
        arenaSize: { width: 2800, height: 950, depth: 2400 },
        glbModels: [{
            id: 'pm-abm/Altar01_Art#glb_1',
            url: 'assets/models/downloaded_cc0/pm-abm/Altar01_Art.glb',
            position: [100, 20, -30],
            rotation: [0, 1.25, 0],
            targetSize: 42,
        }],
    });

    assert.equal(map.glbModels.length, 1);
    assert.deepEqual(map.glbModels[0].position, [100, 20, -30]);
    const runtime = toArenaMapDefinition(map, { mapScale: 10 }).map;
    assert.deepEqual(runtime.glbModels[0].position, [10, 2, -3]);
    assert.equal(runtime.glbModels[0].targetSize, 4.2);
    assert.equal(runtime.glbModels[0].rotation[1], 1.25);
});

test('editor GLB placement survives JSON export and import', () => {
    const object = new THREE.Group();
    object.position.set(120, 8, -45);
    object.rotation.set(0.25, 0.75, -0.5);
    object.userData = {
        id: 'glb_1',
        type: 'glb',
        subType: 'pm-abm/Altar01_Art',
        glbUrl: 'assets/models/downloaded_cc0/pm-abm/Altar01_Art.glb',
        targetSize: 24,
    };
    const exportManager = {
        core: { objectsContainer: { children: [object] } },
        mapDocumentMeta: {},
    };
    const json = generateJSONExport(exportManager, { width: 2800, height: 950, depth: 2400 });
    const exported = JSON.parse(json);
    assert.deepEqual(exported.glbModels, [{
        id: 'pm-abm/Altar01_Art#glb_1',
        url: 'assets/models/downloaded_cc0/pm-abm/Altar01_Art.glb',
        position: [120, 8, -45],
        rotation: [0.25, 0.75, -0.5],
        scale: 1,
        targetSize: 24,
    }]);

    const calls = [];
    const importManager = {
        core: { objectsContainer: { children: [] } },
        clearAllObjects() {},
        withSceneMutation(callback) { callback(); },
        queueSceneUiRefresh() {},
        createMesh(...args) { calls.push(args); },
    };
    importFromJSON(importManager, json);
    const glbCall = calls.find(([type]) => type === 'glb');
    assert.equal(glbCall[1], 'pm-abm/Altar01_Art');
    assert.deepEqual(glbCall.slice(2, 5), [120, 8, -45]);
    assert.equal(glbCall[6].id, 'glb_1');
    assert.equal(glbCall[6].targetSize, 24);
    assert.deepEqual([glbCall[6].rotateX, glbCall[6].rotateY, glbCall[6].rotateZ], [0.25, 0.75, -0.5]);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { EditorAssetLoader } from '../editor/js/EditorAssetLoader.js';
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


test('the real editor loader decodes the compressed Kirschhain model without a placeholder', async () => {
    const bytes = await readFile(new URL('../assets/maps/cherry_grove/glb/akebono_01.glb', import.meta.url));
    const loader = new EditorAssetLoader();
    const loaded = await loader.glbLoader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const petals = loaded.scene.getObjectByName('Akebono_Petals_ConsolidatedMesh');
    assert.ok(petals?.geometry.index.count > 0);
    loaded.scene.traverse(object => { object.geometry?.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material?.dispose(); });
});


test('the editor rocket pickup has four closed fins and no out-of-range OBJ vertices', async () => {
    const source = await readFile(new URL('../assets/items/item_rocket.obj', import.meta.url), 'utf8');
    let vertices = 0; const fins = [];
    for (const line of source.split(/\r?\n/)) {
        if (line.startsWith('v ')) vertices++;
        if (!line.startsWith('f ')) continue;
        const face = line.slice(2).trim().split(/\s+/).map(Number);
        assert.ok(face.every(index => Number.isInteger(index) && index > 0 && index <= vertices));
        if (face.every(index => index >= 15)) fins.push(face);
    }
    assert.equal(vertices, 46); assert.equal(fins.length, 24);
    for (const start of [15, 23, 31, 39]) {
        const edges = new Map();
        for (const face of fins.filter(face => face.every(index => index >= start && index < start + 8))) {
            assert.equal(face.length, 4);
            for (let index = 0; index < face.length; index++) {
                const key = [face[index], face[(index + 1) % face.length]].sort((a,b) => a-b).join(':');
                edges.set(key, (edges.get(key) || 0) + 1);
            }
        }
        assert.equal(edges.size, 12); assert.ok([...edges.values()].every(count => count === 2));
    }
    const object = new OBJLoader().parse(source);
    object.traverse(node => { const positions = node.geometry?.attributes.position;
        if (positions) assert.ok(Array.from(positions.array).every(Number.isFinite));
        node.geometry?.dispose(); });
});

// A map's world model (glbModels) must stand in the editor exactly where and as large as the
// match builds it. The test loads one raw GLB scene into the editor, exports the map, rebuilds
// the match placement with the game's own placement math and compares both boxes in editor units.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { EditorAssetLoader } from '../editor/js/EditorAssetLoader.js';
import { EditorMapManager } from '../editor/js/EditorMapManager.js';
import { computeCollectionPlacement } from '../src/entities/GLBCollectionPlacement.js';
import { getCustomMapConversionScale } from '../src/entities/CustomMapLoader.js';
import { parseMapJSON, toArenaMapDefinition } from '../src/entities/MapSchema.js';
import { getRuntimeMapScale } from '../src/shared/contracts/RuntimeMapCatalogContract.js';

const ARENA = Object.freeze({ width: 2800, height: 950, depth: 2400 });
const WORLD_URL = 'assets/maps/test_world/glb/test_world.glb';

/** A world model in its own file units, off-centre like most Blender exports. */
function createRawWorldScene() {
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 1), new THREE.MeshBasicMaterial());
    mesh.position.set(10, 5, -3);
    scene.add(mesh);
    return scene;
}

function createEditor() {
    const core = {
        scene: new THREE.Scene(),
        objectsContainer: new THREE.Group(),
        transformControl: { object: null, detach() {} },
    };
    core.scene.add(core.objectsContainer);
    const loader = new EditorAssetLoader({ timeoutMs: 1000 });
    loader.glbLoader = { load(_url, onLoad) { onLoad({ scene: createRawWorldScene() }); } };
    const mapManager = new EditorMapManager(core, loader);
    mapManager.setArenaSizeProvider(() => ARENA);
    return { mapManager, loader, core };
}

function importWorld(mapManager, model) {
    mapManager.importFromJSON(JSON.stringify({
        arenaSize: ARENA,
        glbModels: [{ id: 'test-world#w1', url: WORLD_URL, rotation: [0, 0, 0], ...model }],
    }));
    return mapManager.core.objectsContainer.children.find((object) => object.userData.type === 'glb');
}

/** Box the match builds for the exported map, measured back in editor units. */
function matchBox(mapManager) {
    const parsed = parseMapJSON(mapManager.generateJSONExport(ARENA));
    const conversion = getCustomMapConversionScale(parsed.map).scale;
    const runtimeMap = toArenaMapDefinition(parsed.map, { mapScale: conversion }).map;
    const mapScale = getRuntimeMapScale();
    const raw = new THREE.Box3().setFromObject(createRawWorldScene());
    const placement = computeCollectionPlacement(raw, runtimeMap.glbModels[0], mapScale);
    const slot = new THREE.Vector3(...placement.slotPosition);
    const offset = new THREE.Vector3(...placement.offset);
    const toEditor = conversion / mapScale;
    return new THREE.Box3(
        raw.min.clone().add(offset).multiplyScalar(placement.fitScale).add(slot).multiplyScalar(toEditor),
        raw.max.clone().add(offset).multiplyScalar(placement.fitScale).add(slot).multiplyScalar(toEditor),
    );
}

function assertSameBox(editorBox, gameBox, label) {
    for (const corner of ['min', 'max']) {
        for (const axis of ['x', 'y', 'z']) {
            const actual = editorBox[corner][axis];
            const expected = gameBox[corner][axis];
            assert.ok(Math.abs(actual - expected) < 1e-6 * Math.max(1, Math.abs(expected)),
                `${label} ${corner}.${axis}: editor ${actual}, game ${expected}`);
        }
    }
}

async function loadedWorld(model) {
    const editor = createEditor();
    const object = importWorld(editor.mapManager, model);
    await editor.loader.loadAsset('test-world');
    object.updateMatrixWorld(true);
    return { ...editor, object };
}

test('an imported world model with a raw scale stands as large as in the match', async () => {
    const { mapManager, object } = await loadedWorld({ position: [350, 0, -175], scale: 70 });
    assertSameBox(new THREE.Box3().setFromObject(object), matchBox(mapManager), 'scale');
});

test('an imported world model with a target size stands as large as in the match', async () => {
    const { mapManager, object } = await loadedWorld({ position: [-700, 35, 140], targetSize: 1400 });
    assertSameBox(new THREE.Box3().setFromObject(object), matchBox(mapManager), 'targetSize');
});

test('scaling a raw-scale world with the gizmo stores the raw scale the match multiplies', async () => {
    const { mapManager, object } = await loadedWorld({ position: [0, 0, 0], scale: 70 });
    object.scale.multiplyScalar(2);
    mapManager.syncObjectScaleMetadata(object);
    assert.ok(Math.abs(object.userData.glbScale - 140) < 1e-9, `glbScale ${object.userData.glbScale}`);
    object.updateMatrixWorld(true);
    assertSameBox(new THREE.Box3().setFromObject(object), matchBox(mapManager), 'after the gizmo');
});

test('typing a raw scale into the property panel keeps that scale through the sync', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../editor/js/ui/EditorPropertyControls.js', import.meta.url), 'utf8');
    // The panel writes the shown size; the sync reads the stored scale back from it.
    assert.match(source, /glbSourceMaxDimension/);
    const { mapManager, object } = await loadedWorld({ position: [0, 0, 0], scale: 70 });
    object.userData.glbScale = 35;
    object.scale.setScalar(35 * object.userData.glbSourceMaxDimension);
    mapManager.notifyObjectMutated(object);
    assert.ok(Math.abs(object.userData.glbScale - 35) < 1e-9, `glbScale ${object.userData.glbScale}`);
});

test('an imported map registers only model paths the match would load', () => {
    const { mapManager, loader } = createEditor();
    mapManager.importFromJSON(JSON.stringify({
        arenaSize: ARENA,
        glbModels: [
            { id: 'world#w1', url: WORLD_URL, position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
            { id: 'remote#w2', url: 'https://example.com/world.glb', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
            { id: 'escape#w3', url: 'assets/../../secret.glb', position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
        ],
    }));
    assert.equal(loader.glbModelById.get('world')?.loadUrl, `../${WORLD_URL}`);
    assert.equal(loader.glbModelById.has('remote'), false);
    assert.equal(loader.glbModelById.has('escape'), false);
});

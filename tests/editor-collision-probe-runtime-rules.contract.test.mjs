// The editor's spawn and checkpoint check must collide with what the match collides with
// (Arena.finalizeBuild and GLBMapLoader.collectSceneColliders): no model surfaces in
// 'fallbackOnly' (the editor's own default for GLB maps), only moving parts in 'dynamic', never a
// model hidden until triggered, a decorative model or a batched shootable plant part, and the
// authored box obstacles only where the match keeps them.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { EditorMapManager } from '../editor/js/EditorMapManager.js';
import { createEditorCollisionProbe } from '../editor/js/ui/EditorCollisionValidation.js';

/** Stands for the editor around the probe: a scene, a map manager and the export arena. */
function setup(colliderMode = null) {
    const core = { scene: new THREE.Scene(), objectsContainer: new THREE.Group(), transformControl: { object: null, detach() {} } };
    core.scene.add(core.objectsContainer);
    const manager = new EditorMapManager(core, { getClone() { return null; }, setCloneHydrationHandler() {} });
    if (colliderMode) manager.mapDocumentMeta.glbColliderMode = colliderMode;
    const editor = { core, mapManager: manager, getArenaSizeForExport: () => ({ width: 2800, height: 950, depth: 2400 }) };
    const probe = () => createEditorCollisionProbe(editor, core.objectsContainer.children);
    return { manager, probe };
}

function placeModel(manager, x, props = {}) {
    return manager.createMesh('glb', 'test', x, 100, 0, 100, { glbUrl: 'assets/test.glb', ...props });
}

/** A part inside a placed model, the way a loaded GLB scene nests its meshes. */
function addPart(model, name, userData = {}) {
    const part = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    part.name = name;
    Object.assign(part.userData, userData);
    model.add(part);
    return part;
}

const at = (x, y = 100) => new THREE.Vector3(x, y, 0);

test('a GLB map without a stated collider mode collides with its box obstacles, not its models', () => {
    const { manager, probe } = setup();
    placeModel(manager, 0);
    manager.createMesh('hard', null, 600, 100, 0, 0, { sizeX: 100, sizeY: 100, sizeZ: 100 });
    const blocked = probe();
    assert.equal(blocked(at(0)), false, 'the match builds no model colliders in fallbackOnly');
    assert.equal(blocked(at(600)), true, 'the box obstacle stands in for the model');
});

test('scene collision skips hidden, decorative, optional and shootable model parts', () => {
    const { manager, probe } = setup('scene');
    placeModel(manager, 0);
    placeModel(manager, 400, { hiddenUntilTriggered: true });
    placeModel(manager, 800, { collision: false });
    placeModel(manager, 1200, { role: 'optionalProp' });
    const plant = placeModel(manager, -400, { glbUrl: 'assets/plant.glb' });
    const seeds = addPart(plant, 'seed_cluster', { role: 'shootable_seed' });
    seeds.scale.setScalar(0.01);
    addPart(seeds, 'seed_7');
    plant.material.visible = false;
    plant.geometry = new THREE.BufferGeometry();

    const blocked = probe();
    assert.equal(blocked(at(0)), true, 'a plain model collides');
    assert.equal(blocked(at(400)), false, 'a model hidden until triggered is intangible');
    assert.equal(blocked(at(800)), false, 'a decorative model does not collide');
    assert.equal(blocked(at(1200)), false, 'an optional prop never collides');
    assert.equal(blocked(at(-400)), false, 'a batched shootable part is hit by its plant, not by a collider');
});

test('scene collision drops the authored fallback boxes the match drops', () => {
    const { manager, probe } = setup('scene');
    placeModel(manager, 0);
    manager.createMesh('hard', null, 600, 100, 0, 0, { sizeX: 100, sizeY: 100, sizeZ: 100 });
    const kept = manager.createMesh('hard', null, 900, 100, 0, 0, { sizeX: 100, sizeY: 100, sizeZ: 100 });
    kept.userData.compileWithGlb = true;
    const blocked = probe();
    assert.equal(blocked(at(600)), false, 'a fallback box gives way to the loaded model');
    assert.equal(blocked(at(900)), true, 'a box marked compileWithGlb stays solid');
});

test('dynamic collision keeps the boxes and adds only moving model parts', () => {
    const { manager, probe } = setup('dynamic');
    placeModel(manager, 0);
    const lift = placeModel(manager, 400, { glbUrl: 'assets/lift.glb' });
    lift.name = 'lift_platform_dyn';
    manager.createMesh('hard', null, 800, 100, 0, 0, { sizeX: 100, sizeY: 100, sizeZ: 100 });
    const blocked = probe();
    assert.equal(blocked(at(0)), false, 'static set dressing is left to the boxes');
    assert.equal(blocked(at(400)), true, 'a part marked _dyn moves and collides');
    assert.equal(blocked(at(800)), true, 'the authored box stays solid');
});

test('the match keeps every box while a required model has not loaded or only optional props exist', () => {
    const { manager, probe } = setup('scene');
    const model = placeModel(manager, 0);
    model.userData.isEditorPlaceholder = true;
    manager.createMesh('hard', null, 600, 100, 0, 0, { sizeX: 100, sizeY: 100, sizeZ: 100 });
    assert.equal(probe()(at(600)), true, 'a model that may fail to load leaves the boxes standing');
    // The asset arrives; the map JSON stays the same, the answer must not.
    delete model.userData.isEditorPlaceholder;
    assert.equal(probe()(at(600)), false, 'the loaded model takes over from the box');

    const optional = setup('scene');
    placeModel(optional.manager, 0, { role: 'optionalProp' });
    optional.manager.createMesh('hard', null, 600, 100, 0, 0, { sizeX: 100, sizeY: 100, sizeZ: 100 });
    assert.equal(optional.probe()(at(600)), true, 'optional props alone are no complete world');
});

test('a collider mode spelled the way the map schema accepts it reads like the match reads it', () => {
    const { manager, probe } = setup('Fallback-Only');
    placeModel(manager, 0);
    assert.equal(probe()(at(0)), false, 'Fallback-Only is fallbackOnly in the match');
});
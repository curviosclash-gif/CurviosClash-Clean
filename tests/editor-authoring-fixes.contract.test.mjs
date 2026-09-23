import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { EditorMapManager } from '../editor/js/EditorMapManager.js';
import { createEditorCollisionProbe } from '../editor/js/ui/EditorCollisionValidation.js';
import { pickEditorObject } from '../editor/js/ui/EditorRaySelection.js';
import { bindEditorGroupTransform } from '../editor/js/ui/EditorGroupTransform.js';
import { captureEditorTransforms, createEditorTransformCommand } from '../editor/js/ui/EditorTransformHistory.js';
import { createEditorAuthoringDocument, parseEditorAuthoringDocument } from '../editor/js/EditorAuthoringDocument.js';
import { writePropertyFieldValue } from '../editor/js/ui/EditorFormState.js';

test('validation tolerates editor initialization before the map manager exists', () => {
    assert.equal(createEditorCollisionProbe({}, [])(new THREE.Vector3()), false);
});

test('unfinished project explicitly preserves the missing player spawn', () => {
    const document = createEditorAuthoringDocument({ map: {}, playerSpawnPlaced: false });
    assert.equal(parseEditorAuthoringDocument(JSON.stringify(document)).playerSpawnPlaced, false);
    assert.equal(parseEditorAuthoringDocument(createEditorAuthoringDocument({ map: {} })).playerSpawnPlaced, null);
});

test('property refreshes do not overwrite the numeric field currently being edited', () => {
    const input = { value: '12.' };
    const editor = { dom: { propX: input } };
    const previousDocument = globalThis.document;
    globalThis.document = { activeElement: input };
    try {
        writePropertyFieldValue(editor, 'x', 12);
        assert.equal(input.value, '12.');
        globalThis.document.activeElement = null;
        writePropertyFieldValue(editor, 'x', 13);
        assert.equal(input.value, '13');
    } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
    }
});

function setup() {
    const core = { scene: new THREE.Scene(), objectsContainer: new THREE.Group(), transformControl: {
        object: null, attach(object) { this.object = object; }, detach() { this.object = null; },
    } };
    core.scene.add(core.objectsContainer);
    const manager = new EditorMapManager(core, { getClone() { return null; }, setCloneHydrationHandler() {} });
    const editor = { core, mapManager: manager, getArenaSizeForExport: () => ({ width: 2800, height: 950, depth: 2400 }),
        isObjectLocked: (object) => object.userData.editorLocked === true,
        isManagedObjectAlive: (object) => manager.isRegisteredObject(object),
        resolveSelectableObject: (object) => manager.resolveManagedObject(object),
    };
    return { core, manager, editor };
}

test('camera ray selects elevated geometry and ignores invisible hierarchies', () => {
    const { core, manager, editor } = setup();
    const high = manager.createMesh('hard', null, 0, 900, 0, 0, { sizeX: 100, sizeY: 100, sizeZ: 100 });
    manager.createMesh('hard', null, 0, 0, -3000, 0, { sizeX: 100, sizeY: 100, sizeZ: 100 });
    core.scene.updateMatrixWorld(true);
    editor.raycaster = new THREE.Raycaster(new THREE.Vector3(0, 1200, 1000), new THREE.Vector3(0, -300, -1000).normalize());
    assert.equal(pickEditorObject(editor), high);
    high.visible = false;
    assert.notEqual(pickEditorObject(editor), high);
    manager.clearAllObjects();
});

test('validation uses rotated runtime blocks and vehicle clearance', () => {
    const { core, manager, editor } = setup();
    manager.createMesh('hard', null, 0, 100, 0, 0, { sizeX: 200, sizeY: 100, sizeZ: 20, rotateY: Math.PI / 4 });
    const blocked = createEditorCollisionProbe(editor, core.objectsContainer.children);
    assert.equal(blocked(new THREE.Vector3(0, 100, 0)), true);
    assert.equal(blocked(new THREE.Vector3(60, 100, 60)), false);
    assert.equal(blocked(new THREE.Vector3(0, 159, 0)), true);
    assert.equal(blocked(new THREE.Vector3(0, 165, 0)), false);
    manager.clearAllObjects();
});

test('GLB clearance follows transforms and excludes no-collision meshes', () => {
    const { core, manager, editor } = setup();
    const glb = manager.createMesh('glb', 'test', 0, 100, 0, 100, { glbUrl: 'assets/test.glb' });
    let blocked = createEditorCollisionProbe(editor, core.objectsContainer.children);
    assert.equal(blocked(new THREE.Vector3(0, 100, 0)), true);
    glb.position.x = 500;
    manager.notifyObjectMutated(glb);
    blocked = createEditorCollisionProbe(editor, core.objectsContainer.children);
    assert.equal(blocked(new THREE.Vector3(0, 100, 0)), false);
    assert.equal(blocked(new THREE.Vector3(500, 100, 0)), true);
    glb.name = 'decoration_nocol';
    blocked = createEditorCollisionProbe(editor, core.objectsContainer.children);
    assert.equal(blocked(new THREE.Vector3(500, 100, 0)), false);
    manager.clearAllObjects();
});

test('group gizmo moves mixed objects while preserving pickup scale and locks', () => {
    const { core, manager, editor } = setup();
    const block = manager.createMesh('hard', null, -100, 100, 0, 0, { sizeX: 100, sizeY: 100, sizeZ: 100 });
    const item = manager.createMesh('item', 'item_rocket', 100, 100, 0, 0);
    let gestures = 0;
    editor.beginHistoryGesture = () => { gestures++; };
    bindEditorGroupTransform(editor, () => [block, item]);
    assert.equal(editor.syncGroupTransform(), true);
    editor.beginGroupTransform();
    core.transformControl.axis = 'X';
    core.transformControl.object.scale.x = 2;
    core.transformControl.object.position.y = 150;
    editor.applyGroupTransform();
    assert.deepEqual(block.position.toArray(), [-200, 150, 0]);
    assert.deepEqual(item.position.toArray(), [200, 150, 0]);
    assert.deepEqual(item.scale.toArray(), [30, 80, 30]);
    assert.equal(gestures, 1);
    editor.endGroupTransform();
    block.userData.editorLocked = true;
    assert.equal(editor.syncGroupTransform(), false);
    editor.disposeGroupTransform();
    assert.equal(core.scene.children.length, 1);
    manager.clearAllObjects();
});

test('compact transform undo retains object identity and restores tunnel endpoints', () => {
    const { manager, editor } = setup();
    const tunnel = manager.createMesh('tunnel', null, 0, 100, 0, 20, {
        radius: 20, pointA: new THREE.Vector3(-100, 100, 0), pointB: new THREE.Vector3(100, 100, 0),
    });
    const before = captureEditorTransforms(editor);
    const original = manager.generateJSONExport(editor.getArenaSizeForExport());
    tunnel.position.x += 100;
    tunnel.scale.multiplyScalar(2);
    manager.notifyObjectMutated(tunnel);
    const after = captureEditorTransforms(editor);
    const updated = manager.generateJSONExport(editor.getArenaSizeForExport());
    const command = createEditorTransformCommand(editor, 'Transform tunnel', before, after);
    command.undo();
    assert.equal(manager.getObjectById(tunnel.userData.id), tunnel);
    assert.equal(manager.generateJSONExport(editor.getArenaSizeForExport()), original);
    command.redo();
    assert.equal(manager.generateJSONExport(editor.getArenaSizeForExport()), updated);
    manager.clearAllObjects();
});

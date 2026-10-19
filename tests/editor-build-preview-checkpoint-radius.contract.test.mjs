// Review finding E4 (19.10.2026): the build-flight property panel showed a checkpoint's internal
// ring scale under "Skalierung", so typing 6 did not give radius 6, and an invalid entry jumped back
// to the value from when the panel was drawn instead of the last accepted one.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { EditorBuildPreview } from '../editor/js/EditorBuildPreview.js';
import { EditorMapManager } from '../editor/js/EditorMapManager.js';

const LEGACY_ARENA = Object.freeze({ width: 2800, height: 950, depth: 2400 });
const SMALL_ARENA = Object.freeze({ width: 400, height: 200, depth: 400 });

/**
 * Stands for the few DOM nodes renderProperties builds: rows are labels holding a text node and
 * one input, inputs fire change events. Nothing else of the DOM is touched by the panel.
 */
class FakeElement extends EventTarget {
    constructor(tagName) {
        super();
        this.tagName = tagName;
        this.children = [];
        this.style = {};
        this.value = '';
        this.textContent = '';
    }

    append(...nodes) { this.children.push(...nodes); }

    replaceChildren(...nodes) { this.children = nodes; }
}

globalThis.document ??= /** @type {any} */ ({
    createElement: (tagName) => new FakeElement(tagName),
    createTextNode: (text) => ({ text }),
});

function createBuildEditor() {
    const core = { scene: new THREE.Scene(), objectsContainer: new THREE.Group(), transformControl: { object: null, detach() {} } };
    const mapManager = new EditorMapManager(core, { getClone() { return null; }, setCloneHydrationHandler() {} });
    mapManager.setArenaSizeProvider(() => LEGACY_ARENA);
    const editor = {
        mapManager,
        core,
        currentTool: 'checkpoint',
        toolDockState: { getActiveEntry: () => ({ tool: 'checkpoint', subType: 'gate' }) },
        dom: {},
        executeHistoryMutation: (_label, mutate) => mutate(),
        selectObject() {},
        isActiveLayerLocked: () => false,
    };
    const host = new FakeElement('div');
    return { editor, mapManager, host, preview: new EditorBuildPreview(editor, host) };
}

function findField(host, label) {
    const row = host.children.find((node) => node.children?.[0]?.text === label);
    return row?.children[1] || null;
}

function typeInto(input, value) {
    input.value = String(value);
    input.dispatchEvent(new Event('change'));
}

test('the build-flight panel edits a new checkpoint by its radius', () => {
    const { mapManager, host, preview } = createBuildEditor();
    preview.chooseCatalog();
    const radius = findField(host, 'Radius');
    assert.ok(radius, 'a checkpoint shows a radius field');
    assert.equal(Number(radius.value), 5.5, 'the field starts at the authored radius');

    typeInto(radius, 6);
    assert.equal(preview.confirm(new THREE.Vector3(0, 100, 0)), true);
    const placed = mapManager.core.objectsContainer.children.find((object) => object.userData.type === 'checkpoint');
    assert.equal(placed.userData.cpRadius, 6, 'the placed checkpoint has the typed radius');
    assert.ok(Math.abs(placed.scale.x - mapManager.getCheckpointRingScale(6, false)) < 1e-9, 'its ring shows that radius');
});

test('moving a checkpoint in build flight keeps a radius typed below the minimum ring', () => {
    const { mapManager, host, preview } = createBuildEditor();
    const gate = mapManager.createMesh('checkpoint', 'gate', 0, 100, 0, 0, { id: 'cp_a', cpRadius: 5.5 });
    assert.equal(preview.beginMove(gate), true);

    typeInto(findField(host, 'Radius'), 6);
    assert.equal(preview.confirm(new THREE.Vector3(40, 100, 0)), true);
    assert.equal(gate.userData.cpRadius, 6, 'the moved checkpoint takes the typed radius');
});

test('an invalid entry falls back to the last accepted radius', () => {
    const { host, preview } = createBuildEditor();
    preview.chooseCatalog();
    const radius = findField(host, 'Radius');
    typeInto(radius, 6);
    typeInto(radius, 'abc');
    assert.equal(radius.value, '6', 'the field returns to the radius typed before');
});

test('confirming a build after an arena resize keeps the authored radius', () => {
    let arena = LEGACY_ARENA;
    const { mapManager, preview } = createBuildEditor();
    mapManager.setArenaSizeProvider(() => arena);
    const gate = mapManager.createMesh('checkpoint', 'gate', 0, 100, 0, 0, { id: 'cp_a', cpRadius: 5.5 });
    preview.chooseCatalog();

    arena = SMALL_ARENA;
    mapManager.refreshCheckpointRingScales();
    assert.equal(preview.confirm(new THREE.Vector3(80, 100, 0)), true);
    const placed = mapManager.core.objectsContainer.children.find((object) => object !== gate && object.userData.type === 'checkpoint');
    assert.equal(placed.userData.cpRadius, 5.5, 'a ring drawn for the old arena does not rename the new checkpoint');

    assert.equal(preview.beginMove(gate), true);
    arena = LEGACY_ARENA;
    mapManager.refreshCheckpointRingScales();
    assert.equal(preview.confirm(new THREE.Vector3(40, 100, 0)), true);
    assert.equal(gate.userData.cpRadius, 5.5, 'a moved checkpoint keeps its radius across the resize');
});

test('a radius typed while moving reaches the checkpoint exactly', () => {
    const { mapManager, host, preview } = createBuildEditor();
    mapManager.setArenaSizeProvider(() => SMALL_ARENA);
    const gate = mapManager.createMesh('checkpoint', 'gate', 0, 100, 0, 0, { id: 'cp_a', cpRadius: 40 });
    assert.equal(preview.beginMove(gate), true);
    typeInto(findField(host, 'Radius'), 47.3);
    assert.equal(preview.confirm(new THREE.Vector3(40, 100, 0)), true);
    assert.equal(gate.userData.cpRadius, 47.3, 'the typed radius, not one read back from the ring');
});
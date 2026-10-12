// Finding #30 of an earlier bug hunt: the editor drew a checkpoint ring fourteen times its authored
// radius, while the match draws it from the shared ring rule (three quarters of the radius, never
// below a minimum ring). The test builds the same checkpoint in the editor and through the game's
// own ring builder and compares both rings in editor units.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { EditorMapManager } from '../editor/js/EditorMapManager.js';
import { bindEditorPropertyControls } from '../editor/js/ui/EditorPropertyControls.js';
import { getCustomMapConversionScale } from '../src/entities/CustomMapLoader.js';
import {
    CHECKPOINT_RING_MIN_RADIUS,
    CHECKPOINT_RING_RADIUS_FACTOR,
    FINISH_RING_MIN_RADIUS,
} from '../src/entities/arena/CheckpointRingVisualRadius.js';
import { parseMapJSON, toArenaMapDefinition } from '../src/entities/MapSchema.js';
import { PortalLayoutBuilder } from '../src/entities/arena/portal/PortalLayoutBuilder.js';
import { getRuntimeMapScale } from '../src/shared/contracts/RuntimeMapCatalogContract.js';

const SMALL_ARENA = Object.freeze({ width: 400, height: 200, depth: 400 });
// The editor's own default is a legacy world-sized arena, converted with a much larger factor.
const LEGACY_ARENA = Object.freeze({ width: 2800, height: 950, depth: 2400 });

/** Stands for the editor scene: only what EditorMapManager touches when it places objects. */
function createEditor(arenaSize) {
    const core = {
        scene: new THREE.Scene(),
        objectsContainer: new THREE.Group(),
        transformControl: { object: null, detach() {} },
    };
    core.scene.add(core.objectsContainer);
    const mapManager = new EditorMapManager(core, { getClone() { return null; }, setCloneHydrationHandler() {} });
    mapManager.setArenaSizeProvider?.(() => arenaSize);
    return mapManager;
}

function editorRingRadius(mapManager, object) {
    return object.scale.x * mapManager.torusGeo.parameters.radius;
}

/** The ring the match builds for the exported map, measured back in editor units. */
function gameRingRadii(mapManager, arenaSize) {
    const parsed = parseMapJSON(mapManager.generateJSONExport(arenaSize));
    const conversion = getCustomMapConversionScale(parsed.map).scale;
    const runtimeMap = toArenaMapDefinition(parsed.map, { mapScale: conversion }).map;
    const arena = { renderer: null };
    const mapScale = getRuntimeMapScale();
    new PortalLayoutBuilder(arena)._buildCheckpointRings(runtimeMap, mapScale);
    const toEditorUnits = conversion / mapScale;
    return arena.checkpointRings.map((ring) => {
        const ringMesh = ring.mesh.userData.ringMesh;
        return ringMesh.geometry.parameters.radius * ringMesh.scale.x * toEditorUnits;
    });
}

function assertClose(actual, expected, message) {
    assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: editor ${actual}, game ${expected}`);
}

for (const [label, arenaSize] of [['a small arena', SMALL_ARENA], ['the legacy default arena', LEGACY_ARENA]]) {
    test(`the editor draws a checkpoint ring as large as the match does in ${label}`, () => {
        const mapManager = createEditor(arenaSize);
        const gate = mapManager.createMesh('checkpoint', 'gate', 0, 100, 0, 0, { id: 'cp_a', cpRadius: 40 });
        const small = mapManager.createMesh('checkpoint', 'gate', 80, 100, 0, 0, { id: 'cp_b', cpRadius: 5.5 });
        const finish = mapManager.createMesh('checkpoint', 'finish', 160, 100, 0, 0, { id: 'cp_f', cpRadius: 7 });

        const [gameGate, gameSmall, gameFinish] = gameRingRadii(mapManager, arenaSize);
        assertClose(editorRingRadius(mapManager, gate), gameGate, 'a large gate');
        assertClose(editorRingRadius(mapManager, small), gameSmall, 'a gate held up by the minimum ring');
        assertClose(editorRingRadius(mapManager, finish), gameFinish, 'the finish');
    });
}

test('scaling a checkpoint with the gizmo stores the radius whose ring it shows', () => {
    const mapManager = createEditor(SMALL_ARENA);
    const gate = mapManager.createMesh('checkpoint', 'gate', 0, 100, 0, 0, { id: 'cp_a', cpRadius: 40 });
    const reference = mapManager.createMesh('checkpoint', 'gate', 80, 100, 0, 0, { id: 'cp_ref', cpRadius: 60 });

    // Drag the gate ring up to the size of a radius-60 ring; the stored radius follows the ring.
    gate.scale.setScalar(reference.scale.x);
    mapManager.syncObjectScaleMetadata(gate);
    assertClose(gate.userData.cpRadius, 60, 'the radius behind the dragged ring');
});

/**
 * Stands for the editor UI around the size field: one input, history mutations run at once and
 * nothing is locked, so a change event goes through the real property control.
 */
function bindSizeField(mapManager, selectedObject) {
    const propSize = Object.assign(new EventTarget(), { value: '' });
    bindEditorPropertyControls({
        dom: { propSize },
        mapManager,
        selectedObject,
        isObjectLocked: () => false,
        isManagedObjectAlive: () => true,
        executeHistoryMutation: (_label, mutate) => mutate(),
        showPropPanel() {},
    });
    return (value) => {
        propSize.value = String(value);
        propSize.dispatchEvent(new Event('change'));
    };
}

function exportedRadius(mapManager, arenaSize, id) {
    const exported = JSON.parse(mapManager.generateJSONExport(arenaSize));
    return exported.parcours.checkpoints.find((entry) => entry.id === id)?.radius;
}

/** Scales the ring like the gizmo does: the mesh first, then the editor reads the radius back. */
function dragRing(mapManager, object, factor) {
    object.scale.setScalar(object.scale.x * factor);
    mapManager.notifyObjectMutated(object);
}

test('a radius typed into the size field is the radius the map exports, even below the minimum ring', () => {
    const mapManager = createEditor(LEGACY_ARENA);
    const gate = mapManager.createMesh('checkpoint', 'gate', 0, 250, 0, 0, { id: 'cp_a' });
    const typeSize = bindSizeField(mapManager, gate);

    typeSize(9);
    assert.equal(exportedRadius(mapManager, LEGACY_ARENA, 'cp_a'), 9, 'the typed radius reaches the export');
    assertClose(gate.scale.x, mapManager.getCheckpointRingScale(9, false), 'the ring follows the shared ring rule');

    // Moving or turning the gate runs the same metadata sync; the radius must not drift with it.
    gate.position.x += 25;
    gate.rotation.y = Math.PI / 3;
    mapManager.notifyObjectMutated(gate);
    assert.equal(exportedRadius(mapManager, LEGACY_ARENA, 'cp_a'), 9, 'a move keeps the typed radius');
});

for (const [label, arenaSize, radius] of [['a small arena', SMALL_ARENA, 40], ['the legacy default arena', LEGACY_ARENA, 400]]) {
    test(`a gizmo round trip changes the radius only in proportion in ${label}`, () => {
        const mapManager = createEditor(arenaSize);
        const gate = mapManager.createMesh('checkpoint', 'gate', 0, 100, 0, 0, { id: 'cp_a', cpRadius: radius });

        dragRing(mapManager, gate, 1.5);
        assertClose(gate.userData.cpRadius, radius * 1.5, 'a ring half again as large');
        dragRing(mapManager, gate, 1 / 1.5);
        assertClose(gate.userData.cpRadius, radius, 'the ring dragged back');
    });
}

for (const finish of [false, true]) {
    test(`shrinking a ${finish ? 'finish' : 'gate'} into the minimum ring settles on a stable radius`, () => {
        const mapManager = createEditor(LEGACY_ARENA);
        const subType = finish ? 'finish' : 'gate';
        const conversion = getCustomMapConversionScale({ arenaSize: LEGACY_ARENA }).scale;
        const minimumRing = finish ? FINISH_RING_MIN_RADIUS : CHECKPOINT_RING_MIN_RADIUS;
        const smallestRadiusOfMinimumRing = minimumRing / CHECKPOINT_RING_RADIUS_FACTOR * conversion;

        const tight = mapManager.createMesh('checkpoint', subType, 0, 100, 0, 0, { id: 'cp_tight', cpRadius: 9 });
        const ringScale = tight.scale.x;
        dragRing(mapManager, tight, 0.5);
        assert.equal(tight.userData.cpRadius, 9, 'a radius already inside the minimum ring stays where it was');
        assertClose(tight.scale.x, ringScale, 'the ring stays at the minimum');

        // A map holds one finish, so the wide ring gets an editor of its own.
        const wideEditor = createEditor(LEGACY_ARENA);
        const wide = wideEditor.createMesh('checkpoint', subType, 0, 100, 0, 0, { id: 'cp_wide', cpRadius: 400 });
        dragRing(wideEditor, wide, 0.01);
        assertClose(wide.userData.cpRadius, smallestRadiusOfMinimumRing, 'a large ring shrunk below the minimum');
        dragRing(wideEditor, wide, 0.5);
        assertClose(wide.userData.cpRadius, smallestRadiusOfMinimumRing, 'shrinking again keeps that radius');
    });
}

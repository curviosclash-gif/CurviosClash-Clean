// The flight test warns where a match would crash: the game's own arena collision for blocks,
// the floor and the arena walls. The ship's hitbox is the match hitbox, measured in world units.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { EditorMapManager } from '../editor/js/EditorMapManager.js';
import { createEditorCollisionProbe } from '../editor/js/ui/EditorCollisionValidation.js';
import { evaluateFlightClearance } from '../editor/js/EditorFlightClearance.js';

const ARENA = Object.freeze({ width: 2800, height: 950, depth: 2400 });
const UNITS = 35 / CONFIG_SECTIONS.ARENA.MAP_SCALE;
const HITBOX = CONFIG_SECTIONS.PLAYER.HITBOX_RADIUS;

function createEditorWithBlock() {
    const core = {
        scene: new THREE.Scene(),
        objectsContainer: new THREE.Group(),
        transformControl: { object: null, detach() {} },
    };
    core.scene.add(core.objectsContainer);
    const mapManager = new EditorMapManager(core, { getClone() { return null; }, setCloneHydrationHandler() {} });
    mapManager.setArenaSizeProvider(() => ARENA);
    mapManager.createMesh('hard', null, 0, 300, 0, 100, { id: 'wall', sizeX: 200, sizeY: 200, sizeZ: 200 });
    return { mapManager, getArenaSizeForExport: () => ARENA, core };
}

function clearance(editor, position) {
    const probe = createEditorCollisionProbe(editor, editor.core.objectsContainer.children);
    return evaluateFlightClearance({
        position: new THREE.Vector3(...position),
        arenaSize: ARENA,
        hitboxRadiusWorld: HITBOX,
        unitsPerWorldUnit: UNITS,
        isBlocked: probe,
    });
}

test('flying into a block warns like the match collision', () => {
    const editor = createEditorWithBlock();
    assert.deepEqual(clearance(editor, [0, 300, 0]), { colliding: true, reason: 'geometry' });
    // Just outside the block face plus the hitbox, the ship passes.
    assert.deepEqual(clearance(editor, [0, 300, 100 + HITBOX * UNITS + 5]), { colliding: false, reason: null });
    // Touching the face with the hitbox already counts.
    assert.equal(clearance(editor, [0, 300, 100 + HITBOX * UNITS * 0.5]).colliding, true);
});

test('the floor and the arena walls warn as well', () => {
    const editor = createEditorWithBlock();
    assert.deepEqual(clearance(editor, [800, HITBOX * UNITS * 0.5, 0]), { colliding: true, reason: 'floor' });
    assert.deepEqual(clearance(editor, [1400 + 1, 300, 0]), { colliding: true, reason: 'outside' });
    assert.deepEqual(clearance(editor, [0, 950 + 1, 0]), { colliding: true, reason: 'outside' });
    assert.deepEqual(clearance(editor, [800, 300, 800]), { colliding: false, reason: null });
});

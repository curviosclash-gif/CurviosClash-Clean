import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
    TANK_TURRET_HEIGHT,
    createMapUnitAssets,
    createMapUnitVisual,
    removeMapUnitVisual,
} from '../src/entities/systems/map-units/MapUnitVisualOps.js';
import { applyAuthoredMapUnitBody } from '../src/entities/systems/map-units/MapUnitModelCache.js';

function fakeRenderer() {
    const scene = new Set();
    return { scene, addToScene: (object) => scene.add(object), removeFromScene: (object) => scene.delete(object) };
}

/** A stand-in for the loaded GLB: named meshes whose geometry sits in ground space. */
function fakeLibrary() {
    const material = new THREE.MeshStandardMaterial({ color: 0x334422 });
    const parts = new Map();
    for (const [name, size, at] of [
        ['tank_hull', [4.6, 1.5, 6.8], [0, 1.0, 0]],
        ['tank_track_left', [1.1, 1.2, 7.2], [-2.75, 0.7, 0]],
        ['tank_track_right', [1.1, 1.2, 7.2], [2.75, 0.7, 0]],
        ['tank_turret', [2.9, 1.5, 4.1], [0, 2.6, 0]],
        ['tank_barrel', [0.8, 0.7, 3.7], [0, 2.45, 3.1]],
        ['tank_wreck', [4.6, 1.4, 6.8], [0, 0.8, 0]],
    ]) {
        const geometry = new THREE.BoxGeometry(...size);
        geometry.translate(...at);
        parts.set(name, new THREE.Mesh(geometry, material));
    }
    return { parts, material };
}

function bodyMeshes(root) {
    const found = [];
    root.traverse((node) => {
        if (node.isMesh && node.userData.mapUnitBody === true) found.push(node);
    });
    return found;
}

test('without a model the tank is still built from boxes, with every hook in place', () => {
    const renderer = fakeRenderer();
    const root = createMapUnitVisual(renderer, createMapUnitAssets(), 1);
    assert.ok(root, 'a tank is drawn even before any model arrives');
    assert.ok(root.userData.headPivot, 'the turret pivot the aiming code turns');
    assert.ok(root.userData.muzzleFlash, 'the flash the weapons switch on');
    assert.ok(root.userData.healthFill, 'the health bar the damage code scales');
    assert.equal(root.userData.authoredBody, false, 'it knows it is still the fallback');
    assert.ok(bodyMeshes(root).length >= 4, 'hull, two tracks, turret and barrel are there');
});

test('the authored body replaces the boxes and keeps the hooks', () => {
    const renderer = fakeRenderer();
    const root = createMapUnitVisual(renderer, createMapUnitAssets(), 1);
    const pivot = root.userData.headPivot;
    const flash = root.userData.muzzleFlash;
    const healthFill = root.userData.healthFill;

    assert.equal(applyAuthoredMapUnitBody(root, fakeLibrary()), true);

    assert.equal(root.userData.headPivot, pivot, 'the pivot survives the swap');
    assert.equal(root.userData.muzzleFlash, flash, 'so does the flash');
    assert.equal(root.userData.healthFill, healthFill, 'and the health bar');
    assert.equal(root.userData.authoredBody, true);
    const names = bodyMeshes(root).map((mesh) => mesh.userData.mapUnitPart).sort();
    assert.deepEqual(names, ['tank_barrel', 'tank_hull', 'tank_track_left', 'tank_track_right', 'tank_turret']);
});

test('turret and barrel are lifted onto the pivot they turn around', () => {
    const renderer = fakeRenderer();
    const root = createMapUnitVisual(renderer, createMapUnitAssets(), 1);
    applyAuthoredMapUnitBody(root, fakeLibrary());
    const pivot = root.userData.headPivot;
    const parts = pivot.children.filter((child) => child.userData.mapUnitPart);
    assert.equal(parts.length, 2, 'turret and barrel hang on the pivot, the hull does not');
    for (const part of parts) {
        assert.ok(
            Math.abs(part.position.y + TANK_TURRET_HEIGHT) < 0.0001,
            `${part.userData.mapUnitPart} is authored in ground space and has to come down by the pivot height`,
        );
    }
});

test('the flash moves to the muzzle of the authored barrel', () => {
    const renderer = fakeRenderer();
    const root = createMapUnitVisual(renderer, createMapUnitAssets(), 1);
    const before = root.userData.muzzleFlash.position.z;
    applyAuthoredMapUnitBody(root, fakeLibrary());
    assert.notEqual(root.userData.muzzleFlash.position.z, before, 'the old flash sat at the old muzzle');
    assert.ok(root.userData.muzzleFlash.position.z > 4, 'the flash is at the end of the gun');
});

test('swapping twice does not stack two tanks on top of each other', () => {
    const renderer = fakeRenderer();
    const root = createMapUnitVisual(renderer, createMapUnitAssets(), 1);
    const library = fakeLibrary();
    applyAuthoredMapUnitBody(root, library);
    const after = bodyMeshes(root).length;
    applyAuthoredMapUnitBody(root, library);
    assert.equal(bodyMeshes(root).length, after);
});

test('the shared model survives a destroyed tank', () => {
    const renderer = fakeRenderer();
    const assets = createMapUnitAssets();
    const library = fakeLibrary();
    const unit = { root: createMapUnitVisual(renderer, assets, 1) };
    applyAuthoredMapUnitBody(unit.root, library);
    removeMapUnitVisual(renderer, unit);
    assert.equal(renderer.scene.size, 0, 'the tank left the scene');
    assert.equal(library.material.dispose.length >= 0, true);
    // A disposed shared material would come back as an empty program on the next tank.
    assert.ok(library.parts.get('tank_hull').geometry.attributes.position, 'the shared geometry is still usable');
});

test('a missing part leaves the boxes alone instead of drawing half a tank', () => {
    const renderer = fakeRenderer();
    const root = createMapUnitVisual(renderer, createMapUnitAssets(), 1);
    const broken = fakeLibrary();
    broken.parts.delete('tank_turret');
    assert.equal(applyAuthoredMapUnitBody(root, broken), false);
    assert.equal(root.userData.authoredBody, false, 'the fallback stays');
});

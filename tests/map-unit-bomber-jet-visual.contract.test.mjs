import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { Box3, Vector3 } from 'three';

import {
    BOMBER_JET_LENGTH,
    BOMBER_JET_MODEL_URL,
    fitBomberJetModel,
} from '../src/entities/systems/map-units/MapUnitBomberVisualOps.js';
import { normalizeMapUnit } from '../src/shared/contracts/MapUnitContract.js';
import { geometryOnlyGlbLoader } from './helpers/glb-geometry-loader.mjs';

// User decision 28.09.2026: the bomber that drops the bombs flies the Blender fighter jet, three
// times the size of the Star-Cruiser (Ship 5). OBJ player ships are fitted to 4.5 units on their
// longest axis (obj-vehicle-mesh.js), so the jet is 13.5 long at unit scale.
const SHIP5_LONGEST_EXTENT = 4.5;

async function loadFittedJet() {
    const gltf = await geometryOnlyGlbLoader.loadAsync(BOMBER_JET_MODEL_URL);
    const wrapper = fitBomberJetModel(gltf.scene, gltf.animations);
    wrapper.updateMatrixWorld(true);
    return { gltf, wrapper, box: new Box3().setFromObject(wrapper) };
}

test('the bomber jet model ships with the game assets', () => {
    assert.equal(BOMBER_JET_MODEL_URL, 'assets/models/fighter_jet/glb/01_fighter_jet.glb');
    assert.ok(existsSync(BOMBER_JET_MODEL_URL), 'the GLB is checked in');
});

test('the fitted jet is three Star-Cruisers long, centred, nose forward', async () => {
    assert.equal(BOMBER_JET_LENGTH, SHIP5_LONGEST_EXTENT * 3);
    const { box } = await loadFittedJet();
    const size = box.getSize(new Vector3());
    const centre = box.getCenter(new Vector3());
    assert.ok(Math.abs(Math.max(size.x, size.y, size.z) - BOMBER_JET_LENGTH) < 0.01, `longest extent ${size.toArray()}`);
    // Nose to tail runs along z, the game's forward axis, so the fuselage is the longest extent.
    assert.ok(size.z >= size.x && size.z >= size.y, `the jet lies across its path: ${size.toArray()}`);
    for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(centre[axis]) < 0.01, `centre ${axis} ${centre[axis]}`);
});

test('the jet noses along +z, the way map units travel', async () => {
    // MapUnitDriveOps moves a unit by (sin yaw, cos yaw): yaw 0 flies towards +z. The GLB points
    // its nose at -z like a player ship, so the fit has to turn it round or it flies tail first.
    const { wrapper } = await loadFittedJet();
    const canopy = new Box3().setFromObject(wrapper.getObjectByName('canopy')).getCenter(new Vector3());
    assert.ok(canopy.z > 2, `the cockpit sits at z ${canopy.z.toFixed(2)}, behind the middle`);
});

test('the jet flies with its gear up', async () => {
    const { gltf, wrapper } = await loadFittedJet();
    assert.ok(gltf.animations.some((clip) => clip.name === 'gear_up'), 'the GLB carries gear_up');
    const nose = wrapper.getObjectByName('wheel_nose');
    assert.ok(nose, 'the nose wheel is a named node');
    const gearBox = new Box3().setFromObject(nose);
    const jetBox = new Box3().setFromObject(wrapper);
    // Retracted, the nose wheel sits inside the fuselage instead of hanging below everything.
    assert.ok(gearBox.min.y > jetBox.min.y + 0.05, `nose wheel still hangs at ${gearBox.min.y} (jet bottom ${jetBox.min.y})`);
});

test('the bomber hitbox grows with the bigger jet', () => {
    const bomber = normalizeMapUnit({ id: 'b', kind: 'bomber', path: [[0, 30, 0], [90, 30, 0]] });
    // Half the fitted length, so a hit on nose or tail still counts.
    assert.equal(bomber.hitboxRadius, BOMBER_JET_LENGTH / 2);
});

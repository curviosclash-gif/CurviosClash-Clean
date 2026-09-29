import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import {
    createRepairDroneAssets,
    createRepairDroneVisual,
    disposeRepairDroneAssets,
    removeRepairDroneVisual,
    updateRepairDroneVisual,
} from '../src/entities/systems/repair-drone/RepairDroneVisualOps.js';

const GLB_URL = new URL('../assets/models/repair_drone/glb/repair_drone.glb', import.meta.url);
const ROTORS = ['rotor_front_left', 'rotor_front_right', 'rotor_rear_left', 'rotor_rear_right'];

test('the deployed repair drone swaps to the actual Blender model with four movable rotors', async () => {
    const bytes = await readFile(GLB_URL);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    for (const name of ROTORS) assert.ok(gltf.scene.getObjectByName(name), `${name} survived export`);

    const assets = createRepairDroneAssets({ loader: { loadAsync: async () => gltf } });
    const renderer = { addToScene() {}, removeFromScene() {} };
    const root = createRepairDroneVisual(renderer, assets);
    const visual = root.userData.repairDroneVisual;
    assert.equal(visual.fallback.visible, true, 'the old shape covers asynchronous loading');
    await assets.modelPromise;
    assert.equal(visual.fallback.visible, false, 'the Blender model replaces the old shape');
    assert.ok(visual.model);
    assert.equal(visual.rotors.length, 4);

    const drone = { root, position: new THREE.Vector3(1, 2, 3), yaw: 0.5 };
    updateRepairDroneVisual(drone);
    assert.deepEqual(root.position.toArray(), [1, 2, 3]);
    assert.equal(visual.rotors[0].rotation.y, 9);
    assert.equal(visual.rotors[1].rotation.y, -9);

    const size = new THREE.Box3().setFromObject(visual.model).getSize(new THREE.Vector3());
    assert.ok(Math.max(size.x, size.y, size.z) <= 2.5, 'the visual stays within drone scale');
    removeRepairDroneVisual(renderer, drone);
    assert.equal(drone.root, null);
    disposeRepairDroneAssets(assets);
});

test('late GLB loading cannot reattach a removed repair drone', async () => {
    let finishLoad;
    const assets = createRepairDroneAssets({ loader: {
        loadAsync: () => new Promise((resolve) => { finishLoad = resolve; }),
    } });
    const renderer = { addToScene() {}, removeFromScene() {} };
    const root = createRepairDroneVisual(renderer, assets);
    removeRepairDroneVisual(renderer, { root });
    const template = new THREE.Group();
    for (const name of ROTORS) {
        const rotor = new THREE.Group();
        rotor.name = name;
        template.add(rotor);
    }
    finishLoad({ scene: template });
    await assets.modelPromise;
    assert.equal(assets.model, template, 'the valid model finished loading');
    assert.equal(root.userData.repairDroneVisual.model, null);
    disposeRepairDroneAssets(assets);
});

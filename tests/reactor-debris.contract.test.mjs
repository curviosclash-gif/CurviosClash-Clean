import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    createDebrisLaunches, DEBRIS_CHUNKS, DEBRIS_NAME, DEBRIS_PUFFS_NAME, DEBRIS_TRAIL_PUFFS, debrisPosition,
} from '../src/entities/effects/ReactorDebrisEffect.js';
import { attachReactorSmoke } from '../src/entities/effects/ReactorSmokeEffect.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';

test('every client throws the same chunks, and each variant throws its own', () => {
    assert.deepEqual(createDebrisLaunches(2), createDebrisLaunches(2));
    assert.notDeepEqual(createDebrisLaunches(1), createDebrisLaunches(2));
    assert.equal(createDebrisLaunches(3).length, DEBRIS_CHUNKS);
});

test('chunks fly real arcs: launched within a third of a second, landed within ten, then at rest', () => {
    for (const seed of [1, 2, 3, 4]) {
        for (const launch of createDebrisLaunches(seed)) {
            assert.ok(launch.start > 0 && launch.start < 0.4);
            const before = debrisPosition(launch, launch.start - 0.01);
            assert.equal(before.flying, false);
            const landed = debrisPosition(launch, 30);
            assert.ok(landed.landAt > 3 && landed.landAt < 10, `lands after ${landed.landAt.toFixed(2)} s`);
            const reach = Math.hypot(landed.x, landed.z);
            assert.ok(reach > 50 && reach < 340, `lands ${reach.toFixed(0)} m out`);
            assert.ok(Math.abs(landed.y - launch.size * 0.5) < 1e-9, 'rests on the ground');
            assert.deepEqual(debrisPosition(launch, 60), landed, 'and stays there');
            const apex = debrisPosition(launch, launch.start + launch.speed * Math.sin(launch.elevation) / 9.81);
            // The flattest throw (13 m/s upwards) still rises v^2 / 2g = 8.6 m.
            assert.ok(apex.y > launch.y + 5, 'rises before it falls');
            // Continuous: no jump at landing.
            const justBefore = debrisPosition(launch, landed.landAt - 1e-4);
            assert.ok(Math.hypot(justBefore.x - landed.x, justBefore.y - landed.y, justBefore.z - landed.z) < 0.1);
        }
    }
});

test('the reactor cloud gets its debris on load, visual only and outside the measured model', async () => {
    const buffer = readFileSync(new URL('../assets/maps/reactor_site/glb/torus_cloud_2.glb', import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(gltf.animations[0]); action.play();
    await attachReactorSmoke(gltf.scene, action, { loadTexture: async () => new THREE.Texture() });
    const chunks = gltf.scene.getObjectByName(DEBRIS_NAME);
    const puffs = gltf.scene.getObjectByName(DEBRIS_PUFFS_NAME);
    assert.ok(chunks && puffs, 'both debris layers are attached');
    assert.equal(chunks.geometry.instanceCount, DEBRIS_CHUNKS);
    assert.equal(puffs.geometry.instanceCount, DEBRIS_CHUNKS * (DEBRIS_TRAIL_PUFFS + 1));
    for (const mesh of [chunks, puffs]) {
        assert.ok(/_nocol/.test(mesh.name) && /_noshadow/.test(mesh.name), 'no collider, no shadow');
        mesh.geometry.computeBoundingBox();
        assert.ok(mesh.geometry.boundingBox.getSize(new THREE.Vector3()).length() < 2, 'the carrier geometry stays tiny');
        action.time = 3.2; mesh.onBeforeRender();
        assert.equal(mesh.material.uniforms.debrisTime.value, 3.2, 'posed from the breach clock');
    }
    const variantTwo = createDebrisLaunches(2);
    const arc = chunks.geometry.getAttribute('launchArc');
    assert.ok(Math.abs(arc.getX(0) - variantTwo[0].azimuth) < 1e-6, 'the throw follows the cloud variant');
    let released = 0;
    for (const resource of [chunks.geometry, chunks.material, puffs.geometry, puffs.material]) {
        resource.addEventListener('dispose', () => released++);
    }
    disposeObject3DResources(gltf.scene);
    assert.equal(released, 4);
});

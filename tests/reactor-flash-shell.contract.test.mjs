import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { attachReactorFlashShell, flashShellFade } from '../src/entities/effects/ReactorFlashOverlay.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';

const FIREBALL_PEAK_RADIUS = 62;

async function load(variant) {
    const buffer = readFileSync(new URL(`../assets/maps/reactor_site/glb/torus_cloud_${variant}.glb`, import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(gltf.animations[0]); action.play();
    const seek = (time) => { action.time = time; mixer.update(0); gltf.scene.updateMatrixWorld(true); };
    return { gltf, mixer, action, seek };
}

test('every cloud variant carries a hemispherical flash shell keyed ahead of the fireball', async () => {
    for (let variant = 1; variant <= 4; variant += 1) {
        const { gltf, seek } = await load(variant);
        const rig = gltf.scene.getObjectByName('flash');
        assert.ok(rig, `variant ${variant} has a flash rig`);
        const mesh = rig.children.find((node) => node.isMesh);
        assert.ok(mesh, 'with a mesh');
        assert.equal(mesh.material.name, 'Flash');
        const positions = mesh.geometry.attributes.position;
        let lowest = Infinity, highest = -Infinity;
        for (let i = 0; i < positions.count; i += 1) {
            lowest = Math.min(lowest, positions.getY(i)); highest = Math.max(highest, positions.getY(i));
        }
        assert.ok(lowest > -0.01 && highest > 0.95, 'a dome standing on the ground, radius one');
        seek(0);
        assert.ok(rig.scale.x < 0.01, 'nothing at frame one, so the loader measures the ruin alone');
        seek(0.12);
        assert.ok(Math.abs(rig.scale.x - 1.3 * FIREBALL_PEAK_RADIUS) < 3, `full size at 0.12 s: ${rig.scale.x.toFixed(1)}`);
        seek(0.45);
        assert.ok(rig.scale.x < 0.01, 'gone again well before the fireball peaks');
        disposeObject3DResources(gltf.scene);
    }
});

test('the shell glows additively and fades out within a third of a second', async () => {
    assert.ok(flashShellFade(0.02) > 0.9);
    assert.ok(flashShellFade(0.2) < flashShellFade(0.1));
    assert.equal(flashShellFade(0.4), 0);
    assert.equal(flashShellFade(0), 0, 'nothing before the breach');
    const { gltf, action, seek } = await load(1);
    const shell = attachReactorFlashShell(gltf.scene, action);
    assert.ok(shell);
    assert.equal(shell.material.blending, THREE.AdditiveBlending);
    assert.equal(shell.material.depthWrite, false);
    assert.equal(shell.material.toneMapped, false);
    seek(0.08); shell.onBeforeRender();
    assert.ok(shell.material.uniforms.shellFade.value > 0.5);
    seek(2); shell.onBeforeRender();
    assert.equal(shell.material.uniforms.shellFade.value, 0);
    disposeObject3DResources(gltf.scene);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { attachReactorFireball, fireballGlow, fireballTemperatureColor } from '../src/entities/effects/ReactorFireballEffect.js';
import { createReactorSmoke } from '../src/entities/effects/ReactorSmokeEffect.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';

async function fixture(variant = 1) {
    const buffer = readFileSync(new URL(`../assets/maps/reactor_site/glb/torus_cloud_${variant}.glb`, import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(gltf.animations[0]); action.play();
    const camera = new THREE.PerspectiveCamera(); camera.position.set(450, 400, 500); camera.lookAt(0, 280, 0); camera.updateMatrixWorld();
    const seek = (time) => { action.time = time; mixer.update(0); gltf.scene.updateMatrixWorld(true); };
    return { ...gltf, mixer, action, camera, seek };
}

test('the fireball cools from white through yellow and orange to dull red without exceeding the tone-mapping limit', () => {
    const times = [0.05, 0.4, 1.0, 1.8, 2.8, 4.2];
    const ratios = times.map((t) => { const c = fireballTemperatureColor(t); return c.g / c.r; });
    for (let i = 1; i < ratios.length; i++) assert.ok(ratios[i] < ratios[i - 1], `green share falls at ${times[i]} s`);
    const white = fireballTemperatureColor(0.05);
    assert.ok(white.g / white.r > 0.9 && white.b / white.r > 0.8, 'first flash is near white');
    assert.ok(fireballTemperatureColor(2.8).g / fireballTemperatureColor(2.8).r < 0.35, 'late fireball is red');
    for (const t of [0, ...times, 10]) {
        const c = fireballTemperatureColor(t);
        assert.ok(Math.max(c.r, c.g, c.b) < 2, 'emission stays below 2');
    }
});

test('the fireball glow rises instantly and is gone once the fireball is', () => {
    assert.equal(fireballGlow(0), 0);
    assert.ok(fireballGlow(1) > 0.9);
    assert.equal(fireballGlow(5), 0);
    assert.equal(fireballGlow(30), 0);
});

test('attaching replaces the flat fireball, adds a ground glow and keeps the loader bounds untouched', async () => {
    for (let variant = 1; variant <= 4; variant++) {
        const f = await fixture(variant);
        const fireMesh = f.scene.getObjectByName('fire').children.find((node) => node.isMesh);
        const original = fireMesh.material;
        let disposedOriginal = false;
        original.addEventListener('dispose', () => { disposedOriginal = true; });
        const effect = attachReactorFireball(f.scene, f.action);
        assert.ok(effect);
        assert.ok(disposedOriginal, 'the replaced fireball material is released');
        assert.equal(fireMesh.material.isShaderMaterial, true);
        assert.equal(fireMesh.material.fog, true, 'the fireball fades into the map fog');
        // The brightest body of the scene takes only part of the fog: full fog erased it
        // beyond the fog distance while the smoke above it stayed visible.
        assert.match(fireMesh.material.fragmentShader, /reactorFogFactor\(\)\s*\*\s*0?\.25/);
        assert.doesNotMatch(fireMesh.material.fragmentShader, /#include <fog_fragment>/);
        assert.equal(fireMesh.material.visible, true);
        const glow = f.scene.getObjectByName('reactor-fire-glow_nocol_noshadow');
        assert.ok(glow, 'ground glow exists');
        const measuredSize = () => {
            // Measurements elsewhere recompute geometry bounds, so the glow must stay small in them.
            glow.geometry.computeBoundingBox();
            glow.updateMatrixWorld(true);
            return new THREE.Box3().setFromObject(glow).getSize(new THREE.Vector3()).length();
        };
        assert.ok(measuredSize() < 3, 'ground glow never widens the measured model');

        f.seek(1.4);
        fireMesh.onBeforeRender(null, null, f.camera);
        glow.onBeforeRender(null, null, f.camera);
        assert.ok(glow.material.uniforms.glow.value > 0.5, 'ground is lit at the fireball peak');
        const fireRadius = f.scene.getObjectByName('fire').getWorldScale(new THREE.Vector3()).x;
        assert.ok(glow.material.uniforms.glowRadius.value > 2 * fireRadius, 'light reaches beyond the fireball');
        assert.ok(measuredSize() < 3, 'a lit glow is still not part of the measured model');
        const hot = fireMesh.material.uniforms.fireColor.value.clone();

        f.seek(3);
        fireMesh.onBeforeRender(null, null, f.camera);
        assert.ok(fireMesh.material.uniforms.fireColor.value.g < hot.g, 'seeking forward cools the fireball');
        f.seek(12);
        glow.onBeforeRender(null, null, f.camera);
        assert.equal(glow.material.uniforms.glow.value, 0);
        f.seek(1.4);
        fireMesh.onBeforeRender(null, null, f.camera);
        assert.deepEqual(fireMesh.material.uniforms.fireColor.value.toArray(), hot.toArray(), 'seeking back is deterministic');

        let released = 0;
        for (const resource of [fireMesh.material, glow.material, glow.geometry]) resource.addEventListener('dispose', () => released++);
        disposeObject3DResources(f.scene);
        assert.equal(released, 3);
        f.mixer.stopAllAction(); f.mixer.uncacheRoot(f.scene);
    }
});

test('smoke takes the map fog and is lit orange by the fireball only while it burns', async () => {
    const f = await fixture();
    const layer = createReactorSmoke(f.scene, f.action, new THREE.Texture());
    assert.equal(layer.material.fog, true);
    assert.ok(layer.material.uniforms.fogColor && layer.material.uniforms.fogFar, 'fog uniforms are present');
    assert.match(layer.material.fragmentShader, /fogColor/);
    f.seek(1); layer.onBeforeRender(null, null, f.camera);
    assert.ok(layer.material.uniforms.fireGlow.value > 0.9);
    assert.ok(layer.material.uniforms.fireLight.value.w > 0, 'fire light carries the fireball radius');
    f.seek(20); layer.onBeforeRender(null, null, f.camera);
    assert.equal(layer.material.uniforms.fireGlow.value, 0);
    disposeObject3DResources(f.scene);
});

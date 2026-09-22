import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createGlbAnimationTrack, GlbAnimationDriver } from '../src/entities/arena/GlbAnimationDriver.js';
import { createReactorSmoke, SMOKE_DISSOLVE_SECONDS, SMOKE_RESIDUE, smokeDensityAfter } from '../src/entities/effects/ReactorSmokeEffect.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';

function fakeTrack(mode, root = new THREE.Object3D()) {
    const action = { time: 0 };
    const mixer = { update() {}, getRoot: () => root, stopAllAction() {}, uncacheRoot() {} };
    return { root, track: createGlbAnimationTrack({ mixer, action, clip: { name: 'Clip', duration: 49 }, clock: { mode }, modelId: 'cloud' }) };
}

test('a one-shot clip reports how long it has been over; a loop never does', () => {
    const once = fakeTrack('once');
    const loop = fakeTrack('loop');
    const driver = new GlbAnimationDriver();
    driver.setTracks([once.track, loop.track]);
    driver.setTrackStart('cloud', 10);
    driver.setElapsedSeconds(30); driver.advance(0);
    assert.equal(once.root.userData.clipOverrunSeconds, 0, 'still playing');
    driver.setElapsedSeconds(10 + 49 + 120); driver.advance(0);
    assert.equal(once.root.userData.clipOverrunSeconds, 120);
    assert.equal(loop.root.userData.clipOverrunSeconds, undefined);
    driver.setTrackStart('cloud', 0);
    driver.setTrackStart('cloud', 200);
    assert.equal(once.root.userData.clipOverrunSeconds, 0, 'a new breach starts over');
});

async function cloud() {
    const buffer = readFileSync(new URL('../assets/maps/reactor_site/glb/torus_cloud_1.glb', import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(gltf.animations[0]); action.play();
    const layer = createReactorSmoke(gltf.scene, action, new THREE.Texture());
    const camera = new THREE.PerspectiveCamera(); camera.position.set(900, 500, 1000); camera.lookAt(0, 400, 0); camera.updateMatrixWorld();
    action.time = gltf.animations[0].duration; mixer.update(0); gltf.scene.updateMatrixWorld(true);
    const sample = (after) => {
        gltf.scene.userData.clipOverrunSeconds = after;
        layer.onBeforeRender(null, null, camera);
        const data = layer.material.uniforms.smokeData.value.image.data;
        let opacity = 0, area = 0;
        for (let row = 0; row < layer.geometry.instanceCount; row += 1) {
            const o = row * 16;
            opacity += data[o + 7] - Math.floor(data[o + 7]);
            area += data[o + 4] * data[o + 5];
        }
        return { cards: layer.geometry.instanceCount, opacity, area };
    };
    return { gltf, sample };
}

test('after the clip the cloud stands for seven minutes, spreads, then leaves a faint rest', async () => {
    assert.equal(SMOKE_DISSOLVE_SECONDS, 420);
    assert.ok(SMOKE_RESIDUE > 0 && SMOKE_RESIDUE < 0.3);
    assert.equal(smokeDensityAfter(0), 1);
    assert.ok(Math.abs(smokeDensityAfter(SMOKE_DISSOLVE_SECONDS) - SMOKE_RESIDUE) < 1e-9);
    const { gltf, sample } = await cloud();
    const steps = [0, 60, 180, 300, 360, 420, 900].map(sample);
    for (let i = 1; i < steps.length - 1; i += 1) {
        assert.ok(steps[i].opacity < steps[i - 1].opacity, `thinner at step ${i}`);
    }
    // Four minutes gave only 15 percent left; now five minutes still hold most of the head.
    assert.ok(steps[3].opacity > steps[0].opacity * 0.6, 'still a dense cloud after five minutes');
    assert.ok(steps[3].area / steps[3].opacity > steps[0].area / steps[0].opacity, 'what remains spreads out');
    const rest = steps[5], later = steps[6];
    assert.ok(rest.opacity > 0, 'a thin rest remains');
    assert.ok(rest.opacity < steps[0].opacity * 0.35, 'the rest is faint');
    assert.ok(Math.abs(later.opacity - rest.opacity) < 1e-6, 'after seven minutes nothing changes');
    assert.ok(rest.cards < steps[0].cards * 0.75, 'fine detail and the rolling streams are gone, which saves draws');
    disposeObject3DResources(gltf.scene);
});

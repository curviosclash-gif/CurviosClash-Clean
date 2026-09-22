import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readPngRgba } from './helpers/png-rgba.mjs';
import { createReactorSmoke } from '../src/entities/effects/ReactorSmokeEffect.js';
import { resolveSmokeSun, SMOKE_FRAGMENT, SMOKE_VERTEX } from '../src/entities/effects/ReactorSmokeGeometry.js';
import { disposeObject3DResources } from '../src/shared/rendering/ThreeDisposal.js';

const smokeDir = new URL('../assets/vfx/torus-explosions/smoke/', import.meta.url);
const lightA = readPngRgba(fileURLToPath(new URL('smoke-light-a.png', smokeDir)));
const lightB = readPngRgba(fileURLToPath(new URL('smoke-light-b.png', smokeDir)));
const TILE = 256;

// Mean of one channel over part of a tile, weighted by alpha; region in tile fractions, y down.
function regionMean(png, tile, channel, [x0, x1, y0, y1]) {
    const column = tile % 4, row = 3 - Math.floor(tile / 4);
    let sum = 0, weight = 0;
    for (let y = Math.floor(y0 * TILE); y < y1 * TILE; y += 1) {
        for (let x = Math.floor(x0 * TILE); x < x1 * TILE; x += 1) {
            const index = ((row * TILE + y) * png.width + column * TILE + x) * 4;
            const alpha = png.data[index + 3] / 255;
            sum += png.data[index + channel] * alpha; weight += alpha;
        }
    }
    return sum / Math.max(1e-6, weight);
}

test('the two light atlases replace the single baked-light atlas and share one alpha', () => {
    assert.equal(existsSync(new URL('smoke-atlas.png', smokeDir)), false, 'the old baked-light atlas is gone');
    assert.equal(lightA.width, 1024); assert.equal(lightB.width, 1024);
    let difference = 0;
    for (let i = 3; i < lightA.data.length; i += 4) difference += Math.abs(lightA.data[i] - lightB.data[i]);
    assert.ok(difference / (lightA.data.length / 4) < 1, 'both atlases carry the same density');
});

test('every shape shades itself: the lit side is brighter than the side facing away', () => {
    const right = [0.62, 0.9, 0.3, 0.7], left = [0.1, 0.38, 0.3, 0.7];
    const top = [0.3, 0.7, 0.1, 0.38], bottom = [0.3, 0.7, 0.62, 0.9];
    for (let tile = 0; tile < 16; tile += 1) {
        // Dense billows and column parts shadow themselves hard (measured about 2.5-3.9x);
        // thin wisps and holed billows let the light through (1.1-2.1x), as thin smoke does.
        const contrast = tile < 8 ? 2 : 1.08;
        // A.r = lit from the right, B.r = lit from the left; A.g = top, B.g = bottom.
        assert.ok(regionMean(lightA, tile, 0, right) > regionMean(lightB, tile, 0, right) * contrast,
            `tile ${tile}: its right edge is brighter in light from the right`);
        assert.ok(regionMean(lightB, tile, 0, left) > regionMean(lightA, tile, 0, left) * contrast,
            `tile ${tile}: its left edge is brighter in light from the left`);
        assert.ok(regionMean(lightA, tile, 1, top) > regionMean(lightB, tile, 1, top) * contrast,
            `tile ${tile}: its top is brighter in light from above`);
        assert.ok(regionMean(lightB, tile, 1, bottom) > regionMean(lightA, tile, 1, bottom) * contrast,
            `tile ${tile}: its bottom is brighter in light from below`);
    }
    // Dense billows pass less light from behind than they reflect from the front.
    for (let tile = 0; tile < 4; tile += 1) {
        const whole = [0, 1, 0, 1];
        assert.ok(regionMean(lightB, tile, 2, whole) > regionMean(lightA, tile, 2, whole));
    }
});

test('the sun is the brightest directional light of the scene, or a fixed default', () => {
    const direction = new THREE.Vector3(), color = new THREE.Color();
    const scene = new THREE.Scene();
    assert.equal(resolveSmokeSun(scene, direction, color), false, 'no light: default sun');
    assert.ok(Math.abs(direction.length() - 1) < 1e-6 && direction.y > 0.5, 'the default sun stands high');

    const weak = new THREE.DirectionalLight(0x4f86d9, 0.3); weak.position.set(-10, 0, 0);
    const key = new THREE.DirectionalLight(0xfff4e8, 1.35); key.position.set(0, 10, 0);
    scene.add(weak, key, key.target, weak.target); scene.updateMatrixWorld(true);
    assert.equal(resolveSmokeSun(scene, direction, color), true);
    assert.ok(direction.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-6, 'points towards the key light');
    assert.ok(color.r > color.b, 'takes the warm key light colour');
    key.position.set(10, 0, 0); scene.updateMatrixWorld(true);
    resolveSmokeSun(scene, direction, color);
    assert.ok(direction.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-6, 'follows a moving sun');
});

test('the shader mixes six lights in the turned frame of each card', async () => {
    assert.match(SMOKE_VERTEX, /uniform vec3 sunDirection/);
    assert.match(SMOKE_VERTEX, /vSunLocal/);
    assert.match(SMOKE_FRAGMENT, /smokeLightA/);
    assert.match(SMOKE_FRAGMENT, /smokeLightB/);
    const buffer = readFileSync(new URL('../assets/maps/reactor_site/glb/torus_cloud_1.glb', import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(gltf.animations[0]); action.play();
    const a = new THREE.Texture(), b = new THREE.Texture();
    const layer = createReactorSmoke(gltf.scene, action, a, b);
    assert.equal(layer.material.uniforms.smokeLightA.value, a);
    assert.equal(layer.material.uniforms.smokeLightB.value, b);
    const scene = new THREE.Scene();
    const key = new THREE.DirectionalLight(0xffffff, 1.35); key.position.set(0, 0, 10);
    scene.add(key, key.target, gltf.scene); scene.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(); camera.position.set(450, 400, 500); camera.lookAt(0, 280, 0); camera.updateMatrixWorld();
    layer.onBeforeRender(null, scene, camera);
    assert.ok(layer.material.uniforms.sunDirection.value.distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-6);
    disposeObject3DResources(gltf.scene);
});

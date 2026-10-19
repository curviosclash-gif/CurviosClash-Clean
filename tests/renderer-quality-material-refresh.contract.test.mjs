import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';
import { RenderQualityController } from '../src/core/renderer/RenderQualityController.js';

function createHarness({ toneMapping = THREE.ACESFilmicToneMapping, devicePixelRatio = 1 } = {}) {
    const renderer = {
        toneMapping,
        shadowMap: { enabled: true, needsUpdate: false },
        pixelRatio: 1,
        setPixelRatio(value) { this.pixelRatio = value; },
        getPixelRatio() { return this.pixelRatio; },
    };
    const scene = new THREE.Scene();
    const keyLight = new THREE.DirectionalLight();
    keyLight.castShadow = true;
    scene.add(keyLight);

    const materials = {
        shared: new THREE.MeshStandardMaterial(),
        single: new THREE.MeshBasicMaterial(),
        arrayA: new THREE.MeshLambertMaterial(),
        arrayB: new THREE.MeshPhongMaterial(),
    };
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), materials.shared));
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), materials.shared));
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), materials.single));
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), [materials.arrayA, materials.arrayB]));

    const post = {
        presets: [],
        pixelRatios: [],
        setQualityPreset(preset) { this.presets.push(preset?.id); },
        setPixelRatio(value) { this.pixelRatios.push(value); },
    };
    const previousWindow = globalThis.window;
    globalThis.window = { devicePixelRatio };
    const controller = new RenderQualityController(renderer, scene, post);
    return {
        controller,
        keyLight,
        materials: Object.values(materials),
        post,
        renderer,
        restore() {
            controller.dispose();
            if (previousWindow === undefined) delete globalThis.window;
            else globalThis.window = previousWindow;
        },
    };
}

function versionsOf(materials) {
    return materials.map((material) => material.version);
}

test('quality-only resolution, map-size, bloom, and supersample changes leave material versions alone', () => {
    const harness = createHarness();
    try {
        const { controller, keyLight, materials, post, renderer } = harness;
        const versions = versionsOf(materials);
        controller.setBloomQuality(2);
        assert.equal(post.presets.at(-1), 'high');
        let disposedMaps = 0;
        keyLight.shadow.map = { dispose() { disposedMaps += 1; } };
        renderer.shadowMap.needsUpdate = false;

        controller.setQuality('ULTRA');
        assert.equal(renderer.shadowMap.enabled, true);
        assert.equal(keyLight.shadow.mapSize.width, 2048);
        assert.equal(keyLight.shadow.map, null);
        assert.equal(disposedMaps, 1);
        assert.equal(renderer.pixelRatio, 1);
        assert.equal(renderer.shadowMap.needsUpdate, true);
        assert.deepEqual(versionsOf(materials), versions);

        renderer.shadowMap.needsUpdate = false;
        controller.setQuality('ULTRA', { supersample: true });
        assert.equal(renderer.pixelRatio, 1.25);
        assert.deepEqual(post.pixelRatios, [1, 1.25]);
        assert.equal(renderer.shadowMap.needsUpdate, true);
        assert.deepEqual(versionsOf(materials), versions);

        controller.setShadowQuality(1);
        assert.equal(renderer.shadowMap.enabled, true);
        assert.equal(keyLight.shadow.mapSize.width, 256);
        assert.equal(renderer.shadowMap.needsUpdate, true);
        assert.deepEqual(versionsOf(materials), versions);

        controller.setBloomQuality(0);
        assert.equal(post.presets.at(-1), 'off');
        assert.deepEqual(versionsOf(materials), versions);
        assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
    } finally {
        harness.restore();
    }
});

test('shadow enable and disable refresh each distinct real material once, including arrays and shared use', () => {
    const harness = createHarness();
    try {
        const { controller, materials, renderer } = harness;
        assert.deepEqual(versionsOf(materials), [0, 0, 0, 0]);

        controller.setQuality('LOW');
        assert.equal(renderer.shadowMap.enabled, false);
        assert.deepEqual(versionsOf(materials), [1, 1, 1, 1]);

        controller.setQuality('HIGH');
        assert.equal(renderer.shadowMap.enabled, true);
        assert.deepEqual(versionsOf(materials), [2, 2, 2, 2]);

        controller.setShadowQuality(0);
        assert.equal(renderer.shadowMap.enabled, false);
        assert.deepEqual(versionsOf(materials), [3, 3, 3, 3]);

        controller.setShadowQuality(3);
        assert.equal(renderer.shadowMap.enabled, true);
        assert.deepEqual(versionsOf(materials), [4, 4, 4, 4]);
    } finally {
        harness.restore();
    }
});

test('tone mapping remains ACES without an extra material version bump', () => {
    const harness = createHarness({ toneMapping: THREE.NoToneMapping });
    try {
        const { controller, materials, renderer } = harness;
        const versions = versionsOf(materials);

        controller.setQuality('MEDIUM');

        assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
        assert.deepEqual(versionsOf(materials), versions,
            'Three.js r186 detects the tone-mapping parameter change while selecting the program');
    } finally {
        harness.restore();
    }
});

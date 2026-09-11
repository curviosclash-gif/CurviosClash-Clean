import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { Renderer } from '../src/core/Renderer.js';
import { CONFIG } from '../src/core/Config.js';
import { CameraRigSystem } from '../src/core/renderer/CameraRigSystem.js';
import { SceneLightingRig } from '../src/core/renderer/SceneLightingRig.js';
import { getAtmosphericFogUniforms } from '../src/core/renderer/AtmosphericFogShaderPatch.js';
import { FALKENWACHT_MAPS } from '../src/core/config/maps/presets/burg_falkenwacht/index.js';

test('Falkenwacht triples fog and camera range and restores it on settings and map changes', () => {
    const runtime = Object.create(Renderer.prototype);
    runtime.scene = new THREE.Scene();
    runtime.scene.fog = new THREE.Fog(0, 50, 200);
    runtime._lightingRig = new SceneLightingRig({
        scene: runtime.scene, renderer: { toneMappingExposure: 1 }, config: CONFIG,
    });
    runtime._environmentController = { apply() {} };
    runtime.cameraRigSystem = new CameraRigSystem();
    runtime.cameras = runtime.cameraRigSystem.cameras;
    runtime._getAspect = () => 16 / 9;
    runtime._graphicsStyle = 'modern';
    runtime._viewDistance = 0;
    runtime._mapScale = 1;

    try {
        runtime.setMapLighting(undefined);
        const first = runtime.createCamera(0);
        assert.equal(first.far, 200);
        for (const map of Object.values(FALKENWACHT_MAPS)) {
            runtime.setMapLighting(map.lighting);
            assert.equal(runtime.scene.fog.near, 450);
            assert.equal(runtime.scene.fog.far, 600);
            assert.equal(first.far, 600);
            assert.equal(getAtmosphericFogUniforms().fogClipDistance.value, 600);
            const second = runtime.createCamera(1);
            assert.equal(second.far, 600);
            const frustum = new THREE.Frustum().setFromProjectionMatrix(first.projectionMatrix);
            assert.ok(frustum.containsPoint(new THREE.Vector3(0, 0, -500)));
            assert.ok(!frustum.containsPoint(new THREE.Vector3(0, 0, -601)));

            runtime.setViewDistance(100);
            assert.equal(runtime.scene.fog.far, 100);
            assert.ok(runtime.cameras.every(camera => camera.far === 200));
            assert.equal(getAtmosphericFogUniforms().fogClipDistance.value, 200);
            runtime.setViewDistance(0);
            assert.ok(runtime.cameras.every(camera => camera.far === 600));

            runtime.setMapLighting(undefined);
            assert.equal(runtime.scene.fog.far, 190);
            assert.ok(runtime.cameras.every(camera => camera.far === 200));
        }
    } finally {
        runtime._lightingRig.dispose();
    }
});

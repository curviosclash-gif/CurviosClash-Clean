import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { Renderer } from '../src/core/Renderer.js';
import { CONFIG } from '../src/core/Config.js';
import { CameraRigSystem } from '../src/core/renderer/CameraRigSystem.js';
import { SceneLightingRig } from '../src/core/renderer/SceneLightingRig.js';
import { applyAtmosphericFogLayer, getAtmosphericFogUniforms } from '../src/core/renderer/AtmosphericFogShaderPatch.js';
import { MapFogLayerDriver } from '../src/core/renderer/MapFogLayerDriver.js';
import { REACTOR_SITE_MAPS } from '../src/core/config/maps/presets/reactor_site/index.js';

test('reactor camera reaches its cloud while fog and subsequent maps retain their own ranges', () => {
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
    runtime._mapCameraFar = 0;
    runtime._mapFogLayerDriver = new MapFogLayerDriver({ apply: applyAtmosphericFogLayer });

    try {
        runtime.setMapLighting(undefined);
        const camera = runtime.createCamera(0);
        assert.equal(camera.far, 200);
        const map = REACTOR_SITE_MAPS.reactor_site;
        runtime.setMapLighting(map.lighting, 1, map.cameraFar);
        assert.equal(camera.far, 2000);
        assert.equal(runtime.createCamera(1).far, 2000, 'new split-screen cameras inherit the range');
        assert.equal(runtime.scene.fog.far, 600);
        assert.equal(getAtmosphericFogUniforms().fogClipDistance.value, 600);

        runtime.setViewDistance(100);
        assert.equal(camera.far, 2000, 'the cloud remains in range at a short view distance');
        assert.equal(getAtmosphericFogUniforms().fogClipDistance.value, 200);
        runtime.setMapLighting(undefined);
        assert.ok(runtime.cameras.every((entry) => entry.far === 200));
        assert.equal(getAtmosphericFogUniforms().fogClipDistance.value, 200);
    } finally {
        runtime._lightingRig.dispose();
    }
});

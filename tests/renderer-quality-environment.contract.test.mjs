import assert from 'node:assert/strict';
import test from 'node:test';

import { RenderQualityController } from '../src/core/renderer/RenderQualityController.js';

test('a quality step keeps the reflection environment of the current map', () => {
    const firstMapEnvironment = { name: 'first map sky' };
    const secondMapEnvironment = { name: 'second map sky' };
    const renderer = {
        shadowMap: { enabled: false, needsUpdate: false },
        setPixelRatio() {},
        getPixelRatio: () => 1,
    };
    const scene = {
        environment: firstMapEnvironment,
        fog: { near: 0, far: 0 },
        traverse() {},
    };
    const previousWindow = globalThis.window;
    globalThis.window = { devicePixelRatio: 1 };
    try {
        const controller = new RenderQualityController(renderer, scene);
        // A map load with another sky swaps the environment and disposes the old one.
        scene.environment = secondMapEnvironment;

        controller.setQuality('LOW');
        assert.equal(scene.environment, secondMapEnvironment, 'LOW must not restore the previous map sky');

        controller.setQuality('HIGH');
        assert.equal(scene.environment, secondMapEnvironment, 'HIGH must not restore the previous map sky');
    } finally {
        globalThis.window = previousWindow;
    }
});

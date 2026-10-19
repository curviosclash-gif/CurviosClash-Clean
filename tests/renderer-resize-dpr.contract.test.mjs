import assert from 'node:assert/strict';
import test from 'node:test';

import { Renderer } from '../src/core/Renderer.js';
import { RenderQualityController } from '../src/core/renderer/RenderQualityController.js';
import { RenderViewportSystem } from '../src/core/renderer/RenderViewportSystem.js';
import { CONFIG } from '../src/core/Config.js';

function createResizeRuntime() {
    let pixelRatio = 1;
    const pixelRatioWrites = [];
    const renderer = {
        info: {},
        shadowMap: { enabled: false, needsUpdate: false },
        setPixelRatio(next) {
            pixelRatio = next;
            pixelRatioWrites.push(next);
        },
        getPixelRatio() { return pixelRatio; },
        setSize(width, height) {
            this.size = { width, height, pixelWidth: Math.floor(width * pixelRatio), pixelHeight: Math.floor(height * pixelRatio) };
        },
        getContext() { return null; },
    };
    const pipeline = {
        pixelRatio,
        setPixelRatio(next) { this.pixelRatio = next; },
        setSize(width, height) {
            this.size = { width, height };
            this.setPixelRatio(renderer.getPixelRatio());
        },
        setQualityPreset() {},
    };
    const scene = { userData: {}, traverse() {} };
    const qualityController = new RenderQualityController(renderer, scene, pipeline);
    const viewportSystem = new RenderViewportSystem(renderer, {
        width: window.innerWidth,
        height: window.innerHeight,
        postProcessingPipeline: pipeline,
    });
    const runtime = Object.create(Renderer.prototype);
    runtime.renderer = renderer;
    runtime.qualityController = qualityController;
    runtime.viewportSystem = viewportSystem;
    runtime.cameras = [];
    runtime._width = viewportSystem.width;
    runtime._height = viewportSystem.height;
    return { runtime, renderer, qualityController, pipeline, pixelRatioWrites };
}

test('Renderer resize reapplies the effective pixel-ratio policy only when DPR changes', () => {
    const previousWindow = globalThis.window;
    globalThis.window = { devicePixelRatio: 1, innerWidth: 640, innerHeight: 480 };
    try {
        const { runtime, renderer, qualityController, pipeline, pixelRatioWrites } = createResizeRuntime();
        globalThis.window.devicePixelRatio = 2;
        globalThis.window.innerWidth = 960;
        globalThis.window.innerHeight = 540;
        runtime._onResize();

        const cappedHighRatio = Math.min(2, CONFIG.RENDER.MAX_PIXEL_RATIO);
        assert.equal(renderer.getPixelRatio(), cappedHighRatio);
        assert.equal(pipeline.pixelRatio, cappedHighRatio);
        assert.deepEqual(renderer.size, {
            width: 960,
            height: 540,
            pixelWidth: Math.floor(960 * cappedHighRatio),
            pixelHeight: Math.floor(540 * cappedHighRatio),
        });
        assert.equal(runtime._width, 960);
        assert.equal(runtime._height, 540);
        assert.equal(pixelRatioWrites.length, 1, 'resize applies the changed DPR once');

        globalThis.window.innerWidth = 1024;
        globalThis.window.innerHeight = 768;
        runtime._onResize();
        assert.equal(pixelRatioWrites.length, 1, 'same-DPR resize does not rewrite renderer pixel ratio');
        assert.deepEqual(renderer.size, {
            width: 1024,
            height: 768,
            pixelWidth: Math.floor(1024 * cappedHighRatio),
            pixelHeight: Math.floor(768 * cappedHighRatio),
        });

        qualityController.setQuality('LOW');
        assert.equal(renderer.getPixelRatio(), 0.8);
        globalThis.window.devicePixelRatio = 2.5;
        runtime._onResize();
        assert.equal(renderer.getPixelRatio(), 0.8, 'LOW keeps its existing pixel-ratio cap after resize');
        assert.equal(qualityController.getQualityState().effectiveQuality, 'LOW');

        qualityController.setQualityLock(true, 'cinematic-recording');
        assert.equal(qualityController.getQualityState().effectiveQuality, 'HIGH');
        globalThis.window.devicePixelRatio = 3;
        runtime._onResize();
        assert.equal(renderer.getPixelRatio(), cappedHighRatio, 'recording lock retains the existing effective HIGH policy');
        assert.equal(qualityController.getQualityState().qualityLockReason, 'cinematic-recording');
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as THREE from 'three';
import { RenderQualityController } from '../src/core/renderer/RenderQualityController.js';
import { RenderViewportSystem } from '../src/core/renderer/RenderViewportSystem.js';
import { BLOOM_QUALITY_LEVELS } from '../src/shared/contracts/BloomQualityContract.js';
import { VIEWPORT_LAYOUTS } from '../src/shared/contracts/ViewportLayoutContract.js';

function createRendererDouble() {
    const calls = [];
    return {
        calls,
        shadowMap: { enabled: true, needsUpdate: false },
        toneMapping: THREE.ACESFilmicToneMapping,
        pixelRatio: 1,
        getPixelRatio() { return this.pixelRatio; },
        setPixelRatio(value) { this.pixelRatio = value; },
        setSize(...args) { calls.push(['setSize', ...args]); },
        setScissorTest(...args) { calls.push(['setScissorTest', ...args]); },
        setViewport(...args) { calls.push(['setViewport', ...args]); },
        setScissor(...args) { calls.push(['setScissor', ...args]); },
        render(...args) { calls.push(['render', ...args]); },
    };
}

test('post-processing pass order ends in one output transform', () => {
    const source = readFileSync('src/core/renderer/ScenePostProcessingPipeline.js', 'utf8');
    const renderIndex = source.indexOf('addPass(this.renderPass)');
    const bloomIndex = source.indexOf('addPass(this.bloomPass)');
    const smaaIndex = source.indexOf('addPass(this.smaaPass)');
    const outputIndex = source.indexOf('addPass(this.outputPass)');

    assert.ok(renderIndex < bloomIndex && bloomIndex < smaaIndex && smaaIndex < outputIndex);
    assert.doesNotMatch(source, /renderer\.toneMapping\s*=/);
});

test('render quality gates requested bloom and restores it at HIGH', () => {
    const renderer = createRendererDouble();
    const presets = [];
    const pipeline = {
        setQualityPreset(preset) { presets.push(preset); },
        setPixelRatio() {},
    };
    const scene = { environment: {}, traverse() {} };
    const previousWindow = globalThis.window;
    globalThis.window = { devicePixelRatio: 1 };
    try {
        const controller = new RenderQualityController(renderer, scene, pipeline);
        controller.setBloomQuality(BLOOM_QUALITY_LEVELS.HIGH);
        assert.equal(presets.at(-1).id, 'high');
        controller.setQuality('MEDIUM');
        assert.equal(presets.at(-1).id, 'off');
        controller.setQuality('HIGH');
        assert.equal(presets.at(-1).id, 'high');
        assert.equal(controller.getBloomQuality(), BLOOM_QUALITY_LEVELS.HIGH);
    } finally {
        globalThis.window = previousWindow;
    }
});

test('viewport post-processing is limited to single and network layouts', () => {
    const renderer = createRendererDouble();
    const pipelineCalls = [];
    const pipeline = {
        setSize() {},
        render(scene, camera) {
            pipelineCalls.push([scene, camera]);
            return true;
        },
    };
    const viewport = new RenderViewportSystem(renderer, {
        width: 1280,
        height: 720,
        postProcessingPipeline: pipeline,
    });
    const scene = {};
    const cameras = [0, 1, 2, 3].map((id) => ({ id, updateProjectionMatrix() {} }));

    viewport.render(scene, cameras);
    assert.equal(pipelineCalls.length, 1);
    assert.equal(renderer.calls.filter(([name]) => name === 'render').length, 0);

    viewport.setViewportLayout(VIEWPORT_LAYOUTS.TWO_COLUMNS, cameras);
    viewport.render(scene, cameras);
    assert.equal(pipelineCalls.length, 1);
    assert.equal(renderer.calls.filter(([name]) => name === 'render').length, 2);

    viewport.setNetworkMode(true, 1, cameras);
    viewport.render(scene, cameras);
    assert.equal(pipelineCalls.length, 2);
    assert.equal(pipelineCalls.at(-1)[1], cameras[1]);
});

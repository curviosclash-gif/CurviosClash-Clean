import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { GpuFrameTimer } from '../src/core/renderer/GpuFrameTimer.js';
import { classifyGpuRenderer, readGpuCapabilities } from '../src/core/renderer/GpuCapabilityProbe.js';
import {
    isUltraAllowed,
    recordUltraOutcome,
    resolveAdaptiveQualityStep,
    resolveAutoStartQuality,
    shouldSupersample,
} from '../src/core/renderer/AdaptiveQualityPolicy.js';
import {
    RenderQualityController,
    ULTRA_SHADOW_MAP_SIZE,
    ULTRA_SUPERSAMPLE_PIXEL_RATIO,
} from '../src/core/renderer/RenderQualityController.js';

const RTX = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002484) Direct3D11 vs_5_0 ps_5_0, D3D11)';

function createFakeGl({ renderer = RTX, timer = true } = {}) {
    const ext = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };
    const info = { UNMASKED_RENDERER_WEBGL: 0x9246 };
    return {
        QUERY_RESULT: 0x8866,
        QUERY_RESULT_AVAILABLE: 0x8867,
        RENDERER: 0x1f01,
        disjoint: false,
        elapsedNs: 4e6,
        active: null,
        created: 0,
        deleted: 0,
        getExtension(name) {
            if (name === 'EXT_disjoint_timer_query_webgl2') return timer ? ext : null;
            return name === 'WEBGL_debug_renderer_info' ? info : null;
        },
        getParameter(parameter) {
            if (parameter === ext.GPU_DISJOINT_EXT) {
                const value = this.disjoint;
                this.disjoint = false;
                return value;
            }
            return parameter === info.UNMASKED_RENDERER_WEBGL ? renderer : '';
        },
        createQuery() { this.created += 1; return { ready: false, ns: 0 }; },
        deleteQuery() { this.deleted += 1; },
        beginQuery(_target, query) {
            assert.equal(this.active, null, 'timer queries must never nest');
            this.active = query;
        },
        endQuery() {
            this.active.ns = this.elapsedNs;
            this.active.ready = true;
            this.active = null;
        },
        getQueryParameter(query, parameter) {
            return parameter === this.QUERY_RESULT_AVAILABLE ? query.ready : query.ns;
        },
    };
}

function frames(timer, count) {
    for (let i = 0; i < count; i += 1) {
        timer.begin();
        timer.end();
    }
}

test('the GPU timer turns finished queries into a median in milliseconds', () => {
    const gl = createFakeGl();
    const timer = new GpuFrameTimer(gl, { windowSize: 8 });
    assert.equal(timer.available, true);
    assert.equal(timer.getStats().samples, 0);
    assert.ok(Number.isNaN(timer.getStats().medianMs));

    frames(timer, 5);
    // A result is only read at the next frame's begin, so the last query is still in flight.
    assert.deepEqual(timer.getStats(), { samples: 4, medianMs: 4 });

    gl.elapsedNs = 9e6;
    frames(timer, 7);
    const stats = timer.getStats();
    assert.equal(stats.samples, 8, 'the window is bounded');
    assert.equal(stats.medianMs, 9, 'older samples fall out of the window');
});

test('the GPU timer drops results from a disjoint period and from before a reset', () => {
    const gl = createFakeGl();
    const timer = new GpuFrameTimer(gl, { windowSize: 16 });
    frames(timer, 3);
    const before = timer.getStats().samples;
    gl.disjoint = true;
    frames(timer, 1);
    assert.equal(timer.getStats().samples, before, 'the result read during a disjoint event is discarded');

    timer.reset();
    assert.equal(timer.getStats().samples, 0);
    gl.elapsedNs = 2e6;
    frames(timer, 3);
    const stats = timer.getStats();
    assert.equal(stats.samples, 2, 'the query in flight at the reset is discarded too');
    assert.equal(stats.medianMs, 2);

    timer.dispose();
    assert.equal(gl.deleted, gl.created, 'every query is released');
    frames(timer, 2);
    assert.equal(gl.active, null, 'a disposed timer measures nothing');
});

test('without the timer extension the GPU timer stays silent', () => {
    const gl = createFakeGl({ timer: false });
    const timer = new GpuFrameTimer(gl);
    assert.equal(timer.available, false);
    frames(timer, 3);
    assert.equal(gl.created, 0);
    assert.equal(timer.getStats().samples, 0);
    assert.equal(new GpuFrameTimer(null).available, false);
});

test('GPU names are sorted into discrete, integrated, software and unknown', () => {
    const cases = [
        [RTX, 'discrete'],
        ['ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
        ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
        ['ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E92) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
        ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
        ['ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
        ['ANGLE (AMD, AMD Radeon 780M Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
        ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'software'],
        ['WebKit WebGL', 'unknown'],
        ['', 'unknown'],
    ];
    for (const [name, tier] of cases) {
        assert.equal(classifyGpuRenderer(name).tier, tier, name);
    }
    const live = readGpuCapabilities(createFakeGl(), true);
    assert.deepEqual({ ...live }, { gpuKey: RTX, tier: 'discrete', timerQuery: true });
    assert.equal(readGpuCapabilities({ getExtension() { throw new Error('lost'); } }).tier, 'unknown');
});

test('ULTRA is only offered in auto mode, on a timed discrete GPU that is not blocked', () => {
    const capabilities = { gpuKey: RTX, tier: 'discrete', timerQuery: true };
    assert.equal(isUltraAllowed({ setting: 'auto', capabilities }), true);
    assert.equal(isUltraAllowed({ setting: 'HIGH', capabilities }), false);
    assert.equal(isUltraAllowed({ setting: 'auto', capabilities, automation: true }), false);
    assert.equal(isUltraAllowed({ setting: 'auto', capabilities: { ...capabilities, tier: 'integrated' } }), false);
    assert.equal(isUltraAllowed({ setting: 'auto', capabilities: { ...capabilities, timerQuery: false } }), false);
    assert.equal(isUltraAllowed({ setting: 'auto', capabilities, profile: { gpuKey: RTX, verdict: 'blocked' } }), false);
    assert.equal(isUltraAllowed({ setting: 'auto', capabilities, profile: { gpuKey: 'old card', verdict: 'blocked' } }), true);

    assert.deepEqual(resolveAutoStartQuality({ capabilities, profile: { gpuKey: RTX, verdict: 'ultra', supersample: true }, ultraAllowed: true }),
        { quality: 'ULTRA', supersample: true });
    assert.deepEqual(resolveAutoStartQuality({ capabilities, profile: { gpuKey: RTX, verdict: 'ultra' }, ultraAllowed: false }),
        { quality: 'HIGH', supersample: false });
});

test('the regulator promotes on GPU headroom and demotes on load, never before a round has settled', () => {
    const fast = { samples: 180, medianMs: 4.5 };
    const base = { quality: 'HIGH', avgFps: 59, gpu: fast, ultraAllowed: true, playingSeconds: 12 };
    assert.equal(resolveAdaptiveQualityStep(base), 'ULTRA');
    assert.equal(resolveAdaptiveQualityStep({ ...base, playingSeconds: 5 }), 'HIGH');
    assert.equal(resolveAdaptiveQualityStep({ ...base, gpu: { samples: 180, medianMs: 7 } }), 'HIGH');
    assert.equal(resolveAdaptiveQualityStep({ ...base, gpu: { samples: 60, medianMs: 3 } }), 'HIGH');
    assert.equal(resolveAdaptiveQualityStep({ ...base, gpu: null }), 'HIGH');
    assert.equal(resolveAdaptiveQualityStep({ ...base, ultraAllowed: false }), 'HIGH');
    assert.equal(resolveAdaptiveQualityStep({ ...base, avgFps: 50 }), 'HIGH');
    assert.equal(resolveAdaptiveQualityStep({ ...base, avgFps: 40 }), 'MEDIUM');

    const ultra = { ...base, quality: 'ULTRA' };
    assert.equal(resolveAdaptiveQualityStep(ultra), 'ULTRA');
    assert.equal(resolveAdaptiveQualityStep({ ...ultra, gpu: { samples: 180, medianMs: 13 } }), 'HIGH');
    assert.equal(resolveAdaptiveQualityStep({ ...ultra, avgFps: 45 }), 'HIGH');
    assert.equal(resolveAdaptiveQualityStep({ ...ultra, avgFps: 45, playingSeconds: 3 }), 'ULTRA');

    assert.equal(resolveAdaptiveQualityStep({ quality: 'MEDIUM', avgFps: 20 }), 'LOW');
    assert.equal(resolveAdaptiveQualityStep({ quality: 'MEDIUM', avgFps: 60 }), 'MEDIUM');
    assert.equal(resolveAdaptiveQualityStep({ quality: 'MEDIUM', avgFps: 60, autoLowActive: true }), 'HIGH');
    assert.equal(resolveAdaptiveQualityStep({ quality: 'LOW', avgFps: 55, autoLowActive: true }), 'MEDIUM');
    assert.equal(resolveAdaptiveQualityStep({ quality: 'LOW', avgFps: 55 }), 'LOW');

    assert.equal(shouldSupersample({ samples: 180, medianMs: 3.9 }), true);
    assert.equal(shouldSupersample({ samples: 180, medianMs: 4.5 }), false);
    assert.equal(shouldSupersample({ samples: 20, medianMs: 1 }), false);
});

test('the device profile records ULTRA, sends one failure back to measuring and blocks the second', () => {
    const promoted = recordUltraOutcome(null, RTX, 'promote', { supersample: true });
    assert.deepEqual(promoted, { version: 1, gpuKey: RTX, verdict: 'ultra', downgrades: 0, supersample: true });
    const once = recordUltraOutcome(promoted, RTX, 'demote');
    assert.equal(once.verdict, 'unknown');
    assert.equal(once.downgrades, 1);
    assert.equal(once.supersample, false);
    const twice = recordUltraOutcome(recordUltraOutcome(once, RTX, 'promote'), RTX, 'demote');
    assert.equal(twice.verdict, 'blocked');
    const newCard = recordUltraOutcome(twice, 'another card', 'promote');
    assert.equal(newCard.gpuKey, 'another card');
    assert.equal(newCard.downgrades, 0, 'a new GPU starts with a clean record');
});

function createController({ devicePixelRatio = 1 } = {}) {
    globalThis.window = { devicePixelRatio };
    const renderer = {
        pixelRatio: 1,
        shadowMap: { enabled: true, needsUpdate: false },
        toneMapping: 0,
        getContext: () => createFakeGl(),
        setPixelRatio(value) { this.pixelRatio = value; },
        getPixelRatio() { return this.pixelRatio; },
    };
    const scene = new THREE.Scene();
    const keyLight = new THREE.DirectionalLight();
    keyLight.castShadow = true;
    scene.add(keyLight);
    const presets = [];
    const post = { setQualityPreset(preset) { presets.push(preset?.id); }, setPixelRatio() {} };
    const controller = new RenderQualityController(renderer, scene, post);
    return { controller, renderer, scene, keyLight, presets };
}

test('ULTRA doubles the shadow map, raises the pixel ratio and publishes itself to the scene', () => {
    const originalWindow = globalThis.window;
    try {
        const { controller, renderer, scene, keyLight } = createController({ devicePixelRatio: 1 });
        assert.deepEqual({ ...controller.gpuCapabilities }, { gpuKey: RTX, tier: 'discrete', timerQuery: true });
        controller.setQuality('HIGH');
        assert.equal(keyLight.shadow.mapSize.width, 1024);

        controller.setQuality('ULTRA');
        assert.equal(scene.userData.graphicsQuality, 'ULTRA');
        assert.equal(keyLight.shadow.mapSize.width, ULTRA_SHADOW_MAP_SIZE);
        assert.equal(renderer.pixelRatio, 1);

        controller.setQuality('ULTRA', { supersample: true });
        assert.equal(renderer.pixelRatio, ULTRA_SUPERSAMPLE_PIXEL_RATIO, 'supersampling applies without a level change');

        controller.setShadowQuality(2);
        assert.equal(keyLight.shadow.mapSize.width, 512, 'a lowered shadow setting stays the player\'s choice');

        const hiDpi = createController({ devicePixelRatio: 3 });
        hiDpi.controller.setQuality('ULTRA', { supersample: true });
        assert.equal(hiDpi.renderer.pixelRatio, 2, 'high-DPI screens are capped, not supersampled further');
        hiDpi.controller.setQuality('HIGH');
        assert.equal(hiDpi.renderer.pixelRatio, 1.5);
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    }
});

test('ULTRA lifts an untouched bloom to low and keeps ULTRA through a recording lock', () => {
    const originalWindow = globalThis.window;
    try {
        const { controller, presets } = createController();
        controller.setQuality('ULTRA');
        assert.equal(presets.at(-1), 'off', 'no floor until the runtime says the player never chose');
        controller.setBloomAutoFloor(true);
        assert.equal(presets.at(-1), 'low');
        controller.setBloomQuality(2);
        assert.equal(presets.at(-1), 'high');
        controller.setBloomQuality(0);
        controller.setBloomAutoFloor(false);
        assert.equal(presets.at(-1), 'off', 'a chosen "off" stands at ULTRA');
        controller.setBloomAutoFloor(true);
        controller.setQuality('HIGH');
        assert.equal(presets.at(-1), 'off', 'the floor is an ULTRA feature only');

        controller.setQuality('ULTRA');
        controller.setQualityLock(true, 'cinematic-recording');
        assert.equal(controller.getQualityState().effectiveQuality, 'ULTRA');
        controller.setQuality('LOW');
        assert.equal(controller.getQualityState().effectiveQuality, 'HIGH', 'a recording never drops below HIGH');
        controller.setQualityLock(false);
        assert.equal(controller.getQualityState().effectiveQuality, 'LOW');
        controller.dispose();
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    }
});

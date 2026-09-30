import assert from 'node:assert/strict';
import test from 'node:test';

import { RuntimeDiagnosticsSystem } from '../src/core/RuntimeDiagnosticsSystem.js';
import { GRAPHICS_AUTO_PROFILE_STORAGE_KEY } from '../src/shared/contracts/GraphicsQualityContract.js';

const RTX = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)';
const UHD = 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';

function withMockWindow(run, windowExtras = {}) {
    const original = globalThis.window;
    const listeners = new Map();
    globalThis.window = {
        addEventListener(type, listener) { listeners.set(type, listener); },
        removeEventListener(type) { listeners.delete(type); },
        dispatchEvent(event) { listeners.get(event.type)?.(event); },
        ...windowExtras,
    };
    return Promise.resolve().then(() => run(globalThis.window)).finally(() => {
        if (original === undefined) delete globalThis.window;
        else globalThis.window = original;
    });
}

function createHarness({
    gpuKey = RTX,
    tier = 'discrete',
    timerQuery = true,
    gpuMs = 4.5,
    gpuSamples = 180,
    setting = 'auto',
    bloomUserSet = false,
    storedProfile = null,
    state = 'PLAYING',
} = {}) {
    const calls = [];
    const bloomFloor = [];
    const toasts = [];
    const store = new Map();
    if (storedProfile) store.set(GRAPHICS_AUTO_PROFILE_STORAGE_KEY, storedProfile);
    const gpu = { samples: gpuSamples, medianMs: gpuMs, resets: 0 };
    const settings = { localSettings: { graphicsQuality: setting, bloomQualityUserSet: bloomUserSet } };
    const renderer = {
        setQuality(quality, options) { calls.push({ quality, supersample: options?.supersample === true }); },
        qualityController: {
            gpuCapabilities: { gpuKey, tier, timerQuery },
            gpuFrameTimer: {
                getStats: () => ({ samples: gpu.samples, medianMs: gpu.medianMs }),
                reset() { gpu.resets += 1; },
            },
            setBloomAutoFloor(enabled) { bloomFloor.push(enabled); },
        },
    };
    const runtimeAccess = {
        getRenderer: () => renderer,
        getMediaRecorderSystem: () => null,
        getEntityManager: () => null,
        getRenderDelta: () => 1 / 60,
        getState: () => harness.state,
        getGraphicsQualitySetting: () => settings.localSettings.graphicsQuality,
        getBloomQualityUserSet: () => settings.localSettings.bloomQualityUserSet === true,
        getSettingsRecordStore: () => ({
            loadJsonRecord: (key, fallback) => (store.has(key) ? structuredClone(store.get(key)) : fallback),
            saveJsonRecord: (key, value) => { store.set(key, structuredClone(value)); return { success: true }; },
        }),
        actionShowStatusToast: (message) => toasts.push(String(message)),
    };
    const harness = { calls, bloomFloor, toasts, store, gpu, settings, renderer, runtimeAccess, state };
    return harness;
}

function createDiagnostics(harness, avgFps = 59) {
    const diagnostics = new RuntimeDiagnosticsSystem(harness.runtimeAccess);
    diagnostics._fpsTracker.update = () => {};
    diagnostics._fpsTracker.avg = avgFps;
    return diagnostics;
}

// Advances in regulator-sized steps and skips the cooldown, which has its own test.
function runChecks(diagnostics, count, avgFps = 59) {
    for (let i = 0; i < count; i += 1) {
        diagnostics._fpsTracker.avg = avgFps;
        diagnostics._adaptiveCooldown = 0;
        diagnostics.update(3.1);
    }
}

test('auto mode steps up to ULTRA once a settled round shows GPU headroom, and remembers the GPU', async () => {
    await withMockWindow(async () => {
        const harness = createHarness({ gpuMs: 4.5 });
        const diagnostics = createDiagnostics(harness);
        try {
            runChecks(diagnostics, 3);
            assert.deepEqual(harness.calls, [], 'no ULTRA within the first ten seconds of a round');
            runChecks(diagnostics, 1);
            assert.deepEqual(harness.calls, [{ quality: 'ULTRA', supersample: false }]);
            assert.ok(harness.toasts.includes('Grafik: Sehr hoch'));
            const profile = harness.store.get(GRAPHICS_AUTO_PROFILE_STORAGE_KEY);
            assert.equal(profile.gpuKey, RTX);
            assert.equal(profile.verdict, 'ultra');
        } finally {
            diagnostics.dispose();
        }
    });
});

test('a card with plenty to spare also supersamples', async () => {
    await withMockWindow(async () => {
        const harness = createHarness({ gpuMs: 3.2 });
        const diagnostics = createDiagnostics(harness);
        try {
            runChecks(diagnostics, 4);
            assert.deepEqual(harness.calls, [{ quality: 'ULTRA', supersample: true }]);
            assert.equal(harness.store.get(GRAPHICS_AUTO_PROFILE_STORAGE_KEY).supersample, true);
        } finally {
            diagnostics.dispose();
        }
    });
});

test('a remembered GPU starts straight on ULTRA, a different one measures again', async () => {
    await withMockWindow(async () => {
        const stored = { version: 1, gpuKey: RTX, verdict: 'ultra', downgrades: 0, supersample: true };
        const same = createHarness({ storedProfile: stored, state: 'MENU' });
        const sameDiagnostics = createDiagnostics(same);
        const other = createHarness({ storedProfile: { ...stored, gpuKey: 'another card' }, state: 'MENU' });
        const otherDiagnostics = createDiagnostics(other);
        try {
            sameDiagnostics.update(1 / 60);
            assert.deepEqual(same.calls, [{ quality: 'ULTRA', supersample: true }]);
            otherDiagnostics.update(1 / 60);
            assert.deepEqual(other.calls, []);
        } finally {
            sameDiagnostics.dispose();
            otherDiagnostics.dispose();
        }
    });
});

test('integrated graphics, missing timers and automation never reach ULTRA on their own', async () => {
    for (const options of [{ gpuKey: UHD, tier: 'integrated' }, { timerQuery: false }]) {
        await withMockWindow(async () => {
            const harness = createHarness({ ...options, gpuMs: 2 });
            const diagnostics = createDiagnostics(harness);
            try {
                runChecks(diagnostics, 8);
                assert.deepEqual(harness.calls, [], JSON.stringify(options));
            } finally {
                diagnostics.dispose();
            }
        });
    }
    await withMockWindow(async () => {
        const harness = createHarness({ gpuMs: 2 });
        const diagnostics = createDiagnostics(harness);
        try {
            runChecks(diagnostics, 8);
            assert.deepEqual(harness.calls, [], 'a test run must keep its measurements comparable');
        } finally {
            diagnostics.dispose();
        }
    }, { navigator: { webdriver: true } });
});

test('ULTRA steps back under load, and the second step back blocks it on this GPU', async () => {
    await withMockWindow(async () => {
        const harness = createHarness({ gpuMs: 4.5 });
        const diagnostics = createDiagnostics(harness);
        try {
            runChecks(diagnostics, 4);
            assert.equal(harness.calls.at(-1).quality, 'ULTRA');
            harness.gpu.medianMs = 14;
            runChecks(diagnostics, 1);
            assert.equal(harness.calls.at(-1).quality, 'HIGH');
            assert.ok(harness.toasts.includes('Grafik automatisch reduziert'));
            let profile = harness.store.get(GRAPHICS_AUTO_PROFILE_STORAGE_KEY);
            assert.equal(profile.verdict, 'unknown');
            assert.equal(profile.downgrades, 1);

            harness.gpu.medianMs = 4.5;
            runChecks(diagnostics, 1);
            assert.equal(harness.calls.at(-1).quality, 'ULTRA', 'one step back sends it to measuring again');
            harness.gpu.medianMs = 14;
            runChecks(diagnostics, 1);
            profile = harness.store.get(GRAPHICS_AUTO_PROFILE_STORAGE_KEY);
            assert.equal(profile.verdict, 'blocked');
            harness.gpu.medianMs = 3;
            const before = harness.calls.length;
            runChecks(diagnostics, 4);
            assert.equal(harness.calls.length, before, 'blocked stays blocked');
        } finally {
            diagnostics.dispose();
        }
    });
});

test('a fixed menu level is applied once and never regulated', async () => {
    await withMockWindow(async () => {
        const harness = createHarness({ setting: 'MEDIUM', state: 'MENU' });
        const diagnostics = createDiagnostics(harness);
        try {
            diagnostics.update(1 / 60);
            assert.deepEqual(harness.calls, [{ quality: 'MEDIUM', supersample: false }]);
            harness.state = 'PLAYING';
            runChecks(diagnostics, 6, 15);
            assert.deepEqual(harness.calls, [{ quality: 'MEDIUM', supersample: false }]);

            harness.settings.localSettings.graphicsQuality = 'ULTRA';
            diagnostics.update(1 / 60);
            assert.equal(harness.calls.at(-1).quality, 'ULTRA', 'the player may pick ULTRA on any GPU');

            harness.settings.localSettings.graphicsQuality = 'auto';
            diagnostics.update(1 / 60);
            assert.equal(harness.calls.at(-1).quality, 'HIGH', 'back to auto starts from HIGH');
        } finally {
            diagnostics.dispose();
        }
    });
});

test('the ULTRA bloom floor follows whether the player ever picked a bloom level', async () => {
    await withMockWindow(async () => {
        const harness = createHarness({ state: 'MENU' });
        const diagnostics = createDiagnostics(harness);
        try {
            diagnostics.update(1 / 60);
            assert.deepEqual(harness.bloomFloor, [true]);
            diagnostics.update(1 / 60);
            assert.deepEqual(harness.bloomFloor, [true], 'only pushed on change');
            harness.settings.localSettings.bloomQualityUserSet = true;
            diagnostics.update(1 / 60);
            assert.deepEqual(harness.bloomFloor, [true, false]);
        } finally {
            diagnostics.dispose();
        }
    });
});

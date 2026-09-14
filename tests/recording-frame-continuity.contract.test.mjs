import assert from 'node:assert/strict';
import test from 'node:test';

import { MediaRecorderSystem } from '../src/core/MediaRecorderSystem.js';
import { CinematicReplayExportController } from '../src/core/recording/CinematicReplayExportController.js';
import { CinematicReplayRecorder } from '../src/core/recording/CinematicReplayRecorder.js';

function createEmptyEntityManager() {
    return {
        players: [],
        projectiles: [],
        powerups: [],
        turrets: [],
    };
}

function createParticleState(count = 1000) {
    return {
        count,
        positions: new Float32Array(count * 3),
        velocities: new Float32Array(count * 3),
        lifetimes: new Float32Array(count),
        maxLifetimes: new Float32Array(count),
        gravities: new Float32Array(count),
        scales: new Float32Array(count),
        colors: new Float32Array(count * 3),
    };
}

function createReplayExportHarness() {
    const beginCalls = [];
    const appendCalls = [];
    const finishCalls = [];
    const frameBytes = new Uint8ClampedArray(2 * 2 * 4);
    const saveContract = {
        contractVersion: 'preload.save.v2',
        async beginCinematicReplayExport(payload) {
            beginCalls.push(payload);
            return { started: true, exportId: 'continuity-export' };
        },
        async appendCinematicReplayFrame(payload) {
            appendCalls.push(payload);
            return { accepted: true };
        },
        async finishCinematicReplayExport(payload) {
            finishCalls.push(payload);
            return { saved: true, filePath: 'C:\\Videos\\continuity.mp4' };
        },
        async cancelCinematicReplayExport() {
            return { cancelled: true };
        },
    };
    const controller = new CinematicReplayExportController({
        runtimeGlobal: {
            __CURVIOS_APP__: true,
            curviosApp: {
                contracts: { save: saveContract },
                capabilities: {
                    save: {
                        available: true,
                        providerKind: 'electron-ipc',
                        contractVersion: 'preload.save.v2',
                    },
                },
            },
        },
        resolveExportFormat: () => ({ width: 2, height: 2, fps: 10 }),
        renderFrame: async ({ reset }) => reset
            ? null
            : {
                width: 2,
                height: 2,
                getContext: () => ({
                    getImageData: () => ({ data: frameBytes }),
                }),
            },
    });
    return { controller, beginCalls, appendCalls, finishCalls };
}

function createReplay(overrides = {}) {
    return {
        matchId: 'continuity-replay',
        durationMs: 4000,
        snapshots: [
            { timeMs: 0, players: [] },
            { timeMs: 400, players: [] },
        ],
        metadata: {},
        partial: false,
        partialReason: null,
        audioBlob: null,
        audioWarning: 'audio_capture_unavailable',
        ...overrides,
    };
}

test('cinematic replay memory limit is terminal and duration ends at the last accepted snapshot', async () => {
    let now = 1000;
    const recorder = new CinematicReplayRecorder({
        sampleFps: 30,
        maxEstimatedBytes: 1024 * 1024,
        now: () => now,
        globalScope: {},
    });
    const entityManager = createEmptyEntityManager();
    const fullParticles = createParticleState();

    recorder.start({ matchId: 'memory-limit' });
    for (let frame = 0; frame < 20; frame++) {
        now += 40;
        recorder.capture({ entityManager, particles: fullParticles, dt: 0.04 });
    }
    const snapshotCountAtLimit = recorder._snapshots.length;
    const elapsedAtLimit = recorder._elapsedMs;
    for (let frame = 20; frame < 100; frame++) {
        now += 40;
        recorder.capture({ entityManager, particles: null, dt: 0.04 });
    }

    const replay = await recorder.stop();
    assert.equal(replay.partial, true);
    assert.equal(replay.partialReason, 'replay_memory_budget');
    assert.equal(replay.snapshotCount, snapshotCountAtLimit);
    assert.equal(recorder._elapsedMs, elapsedAtLimit);
    assert.equal(replay.snapshots.at(-1)?.timeMs, 400);
    assert.equal(replay.durationMs, 400);
});

test('cinematic replay duration limit is terminal and does not append snapshots after the gap', async () => {
    let now = 1000;
    const recorder = new CinematicReplayRecorder({
        sampleFps: 30,
        maxDurationSeconds: 10,
        now: () => now,
        globalScope: {},
    });
    const entityManager = createEmptyEntityManager();

    recorder.start({ matchId: 'duration-limit' });
    for (let frame = 0; frame < 350; frame++) {
        now += 40;
        recorder.capture({ entityManager, dt: 0.04 });
    }

    const replay = await recorder.stop();
    assert.equal(replay.partial, true);
    assert.equal(replay.partialReason, 'replay_duration_limit');
    assert.equal(replay.snapshots.at(-1)?.timeMs, 10000);
    assert.equal(replay.durationMs, 10000);
    assert.equal(recorder._elapsedMs, 10040);
});

test('cinematic export uses one capped duration for a queued limit-partial replay', async () => {
    const harness = createReplayExportHarness();
    const result = await harness.controller.export(createReplay({
        partial: true,
        partialReason: 'replay_memory_budget',
    }));

    assert.equal(result.saved, true);
    assert.equal(harness.beginCalls[0]?.expectedDurationMs, 400);
    assert.deepEqual(harness.appendCalls.map((call) => call.frameIndex), [0, 1, 2, 3]);
    assert.deepEqual(harness.finishCalls, [{
        exportId: 'continuity-export',
        frameCount: 4,
        expectedDurationMs: 400,
    }]);
});

test('cinematic export preserves declared duration for complete and audio-partial replays', async () => {
    for (const replayState of [
        { partial: false, partialReason: null },
        { partial: true, partialReason: 'audio_stop_timeout' },
    ]) {
        const harness = createReplayExportHarness();
        const result = await harness.controller.export(createReplay({
            durationMs: 700,
            ...replayState,
        }));

        assert.equal(result.saved, true);
        assert.equal(harness.beginCalls[0]?.expectedDurationMs, 700);
        assert.equal(harness.appendCalls.length, 7);
        assert.equal(harness.finishCalls[0]?.expectedDurationMs, 700);
    }
});

test('cinematic export rejects empty replays and renders one frame for a zero-time limited snapshot', async () => {
    const emptyHarness = createReplayExportHarness();
    const emptyResult = await emptyHarness.controller.export(createReplay({ snapshots: [] }));
    assert.equal(emptyResult.saved, false);
    assert.equal(emptyResult.reason, 'replay_too_short');
    assert.equal(emptyHarness.beginCalls.length, 0);

    const singleHarness = createReplayExportHarness();
    const singleResult = await singleHarness.controller.export(createReplay({
        partial: true,
        partialReason: 'replay_duration_limit',
        durationMs: 5000,
        snapshots: [{ timeMs: 0, players: [] }],
    }));
    assert.equal(singleResult.saved, true);
    assert.equal(singleHarness.beginCalls[0]?.expectedDurationMs, 1);
    assert.equal(singleHarness.appendCalls.length, 1);
    assert.equal(singleHarness.finishCalls[0]?.expectedDurationMs, 1);
});

class FakeMediaRecorder {
    static isTypeSupported() {
        return true;
    }

    constructor(stream, options = {}) {
        this.stream = stream;
        this.mimeType = options.mimeType || 'video/webm';
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onerror = null;
        this.onstop = null;
    }

    start() {
        this.state = 'recording';
    }

    requestData() {
        this.ondataavailable?.({ data: new Blob(['frame'], { type: this.mimeType }) });
    }

    stop() {
        this.state = 'inactive';
        this.onstop?.();
    }
}

function createTrackedCanvas({ width, height, captureStream = null } = {}) {
    const dimensions = { width, height };
    const dimensionWrites = [];
    const drawCalls = [];
    const context = {
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        clearRect() {},
        drawImage(...args) {
            drawCalls.push(args);
        },
    };
    const canvas = {
        getContext() {
            return context;
        },
    };
    Object.defineProperties(canvas, {
        width: {
            get: () => dimensions.width,
            set: (value) => {
                dimensions.width = value;
                dimensionWrites.push(['width', value]);
            },
        },
        height: {
            get: () => dimensions.height,
            set: (value) => {
                dimensions.height = value;
                dimensionWrites.push(['height', value]);
            },
        },
    });
    if (captureStream) canvas.captureStream = captureStream;
    return { canvas, dimensions, dimensionWrites, drawCalls };
}

test('native recorder has one render-driven producer and keeps stream dimensions stable until restart', async () => {
    let perfNow = 1;
    const intervalCallbacks = [];
    const streamFpsCalls = [];
    const targetCanvases = [];
    const tracks = [];
    const source = createTrackedCanvas({
        width: 640,
        height: 360,
        captureStream() {
            throw new Error('source stream must not be used when the capture surface is available');
        },
    });
    const originalDocument = globalThis.document;
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    globalThis.document = {
        createElement() {
            const track = {
                requestFrameCalls: 0,
                stopCalls: 0,
                requestFrame() {
                    this.requestFrameCalls += 1;
                },
                stop() {
                    this.stopCalls += 1;
                },
            };
            const stream = {
                getVideoTracks: () => [track],
                getTracks: () => [track],
            };
            const target = createTrackedCanvas({
                width: 0,
                height: 0,
                captureStream(fps) {
                    streamFpsCalls.push(fps);
                    return stream;
                },
            });
            targetCanvases.push(target);
            tracks.push(track);
            return target.canvas;
        },
    };
    globalThis.setInterval = (callback) => {
        intervalCallbacks.push(callback);
        return { callback };
    };
    globalThis.clearInterval = () => {};

    const recorder = new MediaRecorderSystem({
        canvas: source.canvas,
        captureFps: 30,
        autoDownload: false,
        globalScope: {
            MediaRecorder: FakeMediaRecorder,
            Blob,
            performance: { now: () => perfNow },
            setTimeout,
            clearTimeout,
        },
        logger: { info() {}, warn() {}, error() {} },
        capabilityProbe: () => ({
            hasRecorder: true,
            canRecord: true,
            selectedMimeType: 'video/webm;codecs=vp9',
            recorderEngine: 'mediarecorder-native',
            supportReason: 'contract-test',
        }),
    });

    try {
        const firstStart = await recorder.startRecording({ type: 'contract-start' });
        assert.equal(firstStart.started, true);
        assert.deepEqual(streamFpsCalls, [30]);
        assert.equal(intervalCallbacks.length, 0);
        assert.equal(tracks[0].requestFrameCalls, 1, 'start emits the initial frame');
        const initialDimensions = { ...targetCanvases[0].dimensions };
        const initialDimensionWrites = targetCanvases[0].dimensionWrites.length;

        recorder.captureRenderedFrame(1 / 60);
        perfNow += 100;
        const requestsBeforeRender = tracks[0].requestFrameCalls;
        recorder.captureRenderedFrame(0.1);
        assert.equal(tracks[0].requestFrameCalls - requestsBeforeRender, 1);

        recorder._captureLevelIndex = 5;
        source.canvas.width = 1280;
        source.canvas.height = 720;
        perfNow += 100;
        recorder.captureRenderedFrame(0.1);
        assert.deepEqual(targetCanvases[0].dimensions, initialDimensions);
        assert.equal(targetCanvases[0].dimensionWrites.length, initialDimensionWrites);
        assert.equal(targetCanvases[0].drawCalls.at(-1)?.[0], source.canvas);

        const requestsBeforeStop = tracks[0].requestFrameCalls;
        const firstStop = await recorder.stopRecording({ type: 'cinematic_switch_stop' });
        assert.equal(firstStop.stopped, true);
        assert.equal(tracks[0].requestFrameCalls - requestsBeforeStop, 1, 'stop emits the final frame');
        assert.equal(tracks[0].stopCalls, 1);

        const secondStart = await recorder.startRecording({ type: 'contract-restart' });
        assert.equal(secondStart.started, true);
        assert.equal(targetCanvases.length, 2);
        assert.notEqual(targetCanvases[1].canvas, targetCanvases[0].canvas);
        assert.deepEqual(targetCanvases[1].dimensions, {
            width: Math.floor(1280 * 0.78),
            height: Math.floor(720 * 0.78),
        });
        assert.deepEqual(streamFpsCalls, [30, 30]);
        await recorder.stopRecording({ type: 'cinematic_switch_stop' });
        assert.equal(tracks[1].stopCalls, 1);
    } finally {
        await recorder.dispose();
        globalThis.document = originalDocument;
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
    }
});

test('native recorder retries failed setup with dimensions from the current source', async () => {
    for (const failureMode of ['constructor', 'start']) {
        let constructorCalls = 0;
        let startCalls = 0;
        const captureDimensions = [];
        const targetCanvases = [];
        const source = createTrackedCanvas({
            width: 640,
            height: 360,
            captureStream() {
                throw new Error('source stream must not be used when the capture surface is available');
            },
        });
        class FailOnceMediaRecorder extends FakeMediaRecorder {
            constructor(...args) {
                super(...args);
                constructorCalls += 1;
                if (failureMode === 'constructor' && constructorCalls === 1) {
                    throw new Error('constructor failed once');
                }
            }

            start(...args) {
                startCalls += 1;
                if (failureMode === 'start' && startCalls === 1) {
                    throw new Error('start failed once');
                }
                return super.start(...args);
            }
        }
        const originalDocument = globalThis.document;
        globalThis.document = {
            createElement() {
                let target = null;
                target = createTrackedCanvas({
                    width: 0,
                    height: 0,
                    captureStream(fps) {
                        captureDimensions.push({
                            fps,
                            width: target.canvas.width,
                            height: target.canvas.height,
                        });
                        const track = { requestFrame() {}, stop() {} };
                        return {
                            getVideoTracks: () => [track],
                            getTracks: () => [track],
                        };
                    },
                });
                targetCanvases.push(target);
                return target.canvas;
            },
        };
        const recorder = new MediaRecorderSystem({
            canvas: source.canvas,
            captureFps: 30,
            autoDownload: false,
            globalScope: {
                MediaRecorder: FailOnceMediaRecorder,
                Blob,
                performance: { now: () => 1 },
                setTimeout,
                clearTimeout,
            },
            logger: { info() {}, warn() {}, error() {} },
            capabilityProbe: () => ({
                hasRecorder: true,
                canRecord: true,
                selectedMimeType: 'video/webm;codecs=vp9',
                recorderEngine: 'mediarecorder-native',
                supportReason: 'contract-test',
            }),
        });

        try {
            const failedStart = await recorder.startRecording({ type: `fail-${failureMode}` });
            assert.equal(failedStart.started, false);
            source.canvas.width = 1280;
            source.canvas.height = 720;

            const retryStart = await recorder.startRecording({ type: `retry-${failureMode}` });
            assert.equal(retryStart.started, true);
            assert.equal(targetCanvases.length, 1, 'failed setup surface is safely reused');
            assert.deepEqual(captureDimensions.map(({ width, height }) => ({ width, height })), [
                { width: Math.floor(640 * 0.78), height: Math.floor(360 * 0.78) },
                { width: Math.floor(1280 * 0.78), height: Math.floor(720 * 0.78) },
            ]);
            await recorder.stopRecording({ type: 'cinematic_switch_stop' });
        } finally {
            await recorder.dispose();
            globalThis.document = originalDocument;
        }
    }
});

function configureNativeRenderCapture(recorder, track, captureFps = 30) {
    recorder._isRecording = true;
    recorder._activeRecorderEngine = 'mediarecorder-native';
    recorder._activeCaptureFps = captureFps;
    recorder._mediaRecorderSupportsRequestFrame = true;
    recorder._mediaRecorderVideoTrack = track;
    recorder._resetWebCodecsCaptureState(2);
}

test('native capture does not treat a steady 60 fps render cadence as pressure', () => {
    for (const captureFps of [30, 60]) {
        let perfNow = 1;
        const track = {
            requestFrameCalls: 0,
            requestFrame() {
                this.requestFrameCalls += 1;
            },
        };
        const recorder = new MediaRecorderSystem({
            canvas: null,
            captureFps,
            autoDownload: false,
            globalScope: { performance: { now: () => perfNow } },
            logger: { info() {}, warn() {}, error() {} },
        });
        configureNativeRenderCapture(recorder, track, captureFps);

        for (let frame = 0; frame < 330; frame++) {
            perfNow += 1000 / 60;
            recorder.captureRenderedFrame(1 / 60);
        }

        assert.equal(recorder._captureBackpressureEvents, 0, `captureFps=${captureFps}`);
        assert.equal(recorder._captureDroppedFrames, 0, `captureFps=${captureFps}`);
        assert.ok(recorder._captureLevelIndex <= 2, `captureFps=${captureFps}`);
        assert.ok(track.requestFrameCalls >= captureFps * 4.5, `captureFps=${captureFps}`);
    }
});

test('native capture still reacts to an actual 90 ms render stall', () => {
    let perfNow = 1;
    const track = {
        requestFrameCalls: 0,
        requestFrame() {
            this.requestFrameCalls += 1;
        },
    };
    const recorder = new MediaRecorderSystem({
        canvas: null,
        captureFps: 30,
        autoDownload: false,
        globalScope: { performance: { now: () => perfNow } },
        logger: { info() {}, warn() {}, error() {} },
    });
    configureNativeRenderCapture(recorder, track);
    recorder.captureRenderedFrame(1 / 60);

    perfNow += 90;
    recorder.captureRenderedFrame(0.09);

    assert.equal(recorder._captureLevelIndex, 4);
    assert.equal(recorder._captureBackpressureEvents, 1);
    assert.equal(track.requestFrameCalls, 1);
});

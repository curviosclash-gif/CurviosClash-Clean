import test from 'node:test';
import assert from 'node:assert/strict';
import * as ThreeModule from 'three';

import {
    CINEMATIC_REPLAY_EXPORT_FORMATS,
    createDefaultRecordingCaptureSettings,
    normalizeRecordingCaptureOrientation,
    normalizeRecordingCaptureSettings,
    RECORDING_CAPTURE_ORIENTATION,
    resolveCinematicReplayExportFormat,
} from '../src/shared/contracts/RecordingCaptureContract.js';
import { CinematicReplayExportController } from '../src/core/recording/CinematicReplayExportController.js';
import { MediaRecorderSystem } from '../src/core/MediaRecorderSystem.js';

globalThis.THREE = ThreeModule;
const { RecordingCapturePipeline } = await import('../src/core/renderer/RecordingCapturePipeline.js');

const LANDSCAPE = { width: 1920, height: 1080, fps: 60 };
const PORTRAIT = { width: 1080, height: 1920, fps: 60 };

function createSaveRuntime({ beginPayloads = [], appended = [] } = {}) {
    return {
        __CURVIOS_APP__: true,
        curviosApp: {
            contracts: {
                save: {
                    contractVersion: 'preload.save.v2',
                    beginCinematicReplayExport: async (payload) => {
                        beginPayloads.push(payload);
                        return { started: true, exportId: `export-${beginPayloads.length}` };
                    },
                    appendCinematicReplayFrame: async (payload) => {
                        appended.push(payload.frameBytes.byteLength);
                        return { accepted: true };
                    },
                    finishCinematicReplayExport: async () => ({ saved: true, filePath: 'C:\\Videos\\portrait.mp4' }),
                    cancelCinematicReplayExport: async () => ({ cancelled: true }),
                },
            },
            capabilities: {
                save: { available: true, providerKind: 'electron-ipc', contractVersion: 'preload.save.v2' },
            },
        },
    };
}

function createCanvas(width, height) {
    const frameBytes = new Uint8ClampedArray(width * height * 4);
    return {
        width,
        height,
        getContext: () => ({ getImageData: () => ({ data: frameBytes }) }),
    };
}

const REPLAY = {
    matchId: 'portrait-match',
    durationMs: 17,
    snapshots: [
        { timeMs: 0, players: [{ index: 0, pos: [0, 0, 0], rot: [0, 0, 0, 1], alive: true, health: 100 }] },
        { timeMs: 17, players: [{ index: 0, pos: [1, 0, 0], rot: [0, 0, 0, 1], alive: true, health: 100 }] },
    ],
    metadata: {},
};

test('recording capture settings carry an orientation that defaults to landscape', () => {
    assert.equal(createDefaultRecordingCaptureSettings().orientation, RECORDING_CAPTURE_ORIENTATION.LANDSCAPE);
    assert.equal(normalizeRecordingCaptureOrientation(' PORTRAIT '), RECORDING_CAPTURE_ORIENTATION.PORTRAIT);
    assert.equal(normalizeRecordingCaptureOrientation('sideways'), RECORDING_CAPTURE_ORIENTATION.LANDSCAPE);
    assert.equal(normalizeRecordingCaptureOrientation(null, 'portrait'), RECORDING_CAPTURE_ORIENTATION.PORTRAIT);

    const normalized = normalizeRecordingCaptureSettings({ profile: 'cinematic', orientation: 'Portrait' });
    assert.equal(normalized.orientation, 'portrait');
    assert.equal(normalized.profile, 'cinematic');
    // Missing fields fall back to the previous settings, so a partial update keeps the orientation.
    const kept = normalizeRecordingCaptureSettings({ profile: 'cinematic' }, normalized);
    assert.equal(kept.orientation, 'portrait');
    assert.equal(normalizeRecordingCaptureSettings({ orientation: 42 }).orientation, 'landscape');
});

test('cinematic replay export format follows the orientation', () => {
    assert.deepEqual(resolveCinematicReplayExportFormat('portrait'), PORTRAIT);
    assert.deepEqual(resolveCinematicReplayExportFormat('landscape'), LANDSCAPE);
    assert.deepEqual(resolveCinematicReplayExportFormat(undefined), LANDSCAPE);
    assert.deepEqual(resolveCinematicReplayExportFormat('bogus'), LANDSCAPE);
    assert.deepEqual(CINEMATIC_REPLAY_EXPORT_FORMATS.portrait, PORTRAIT);
    assert.equal(Object.isFrozen(CINEMATIC_REPLAY_EXPORT_FORMATS.portrait), true);
});

test('cinematic capture pipeline renders a 1080x1920 surface in portrait orientation', () => {
    const pipeline = new RecordingCapturePipeline({ sourceCanvas: null, sourceRenderer: null, scene: null });
    pipeline.setSettings({ profile: 'cinematic', hudMode: 'clean' });
    assert.deepEqual(pipeline._resolveCinematicCaptureSize(), { width: 1920, height: 1080 });

    pipeline.setSettings({ orientation: 'portrait' });
    assert.equal(pipeline.getSettings().profile, 'cinematic');
    assert.deepEqual(pipeline._resolveCinematicCaptureSize(), { width: 1080, height: 1920 });

    pipeline.setSettings({ orientation: 'landscape' });
    assert.deepEqual(pipeline._resolveCinematicCaptureSize(), { width: 1920, height: 1080 });
});

test('cinematic export requests and validates the portrait frame size', async () => {
    const beginPayloads = [];
    const appended = [];
    const controller = new CinematicReplayExportController({
        runtimeGlobal: createSaveRuntime({ beginPayloads, appended }),
        resolveExportFormat: () => PORTRAIT,
        renderFrame: async ({ reset }) => (reset ? null : createCanvas(1080, 1920)),
    });

    const result = await controller.export(REPLAY);

    assert.equal(result.saved, true);
    assert.equal(beginPayloads.length, 1);
    assert.equal(beginPayloads[0].width, 1080);
    assert.equal(beginPayloads[0].height, 1920);
    assert.equal(beginPayloads[0].fps, 60);
    assert.deepEqual(appended, [1080 * 1920 * 4, 1080 * 1920 * 4]);
});

test('cinematic export rejects a landscape frame when portrait was requested', async () => {
    const controller = new CinematicReplayExportController({
        runtimeGlobal: createSaveRuntime(),
        logger: { warn() {} },
        resolveExportFormat: () => PORTRAIT,
        renderFrame: async ({ reset }) => (reset ? null : createCanvas(1920, 1080)),
    });

    const result = await controller.export(REPLAY);

    assert.equal(result.saved, false);
    assert.equal(result.reason, 'offline_frame_size_invalid');
});

test('cinematic export keeps the 1080p landscape default without a format resolver', async () => {
    const beginPayloads = [];
    const controller = new CinematicReplayExportController({
        runtimeGlobal: createSaveRuntime({ beginPayloads }),
        renderFrame: async ({ reset }) => (reset ? null : createCanvas(1920, 1080)),
    });

    const result = await controller.export(REPLAY);

    assert.equal(result.saved, true);
    assert.equal(beginPayloads[0].width, 1920);
    assert.equal(beginPayloads[0].height, 1080);
});

test('media recorder system feeds the live orientation into the replay exporter', () => {
    const recorder = new MediaRecorderSystem({
        canvas: null,
        globalScope: {},
        recordingCaptureSettings: { profile: 'cinematic', orientation: 'portrait' },
    });

    assert.deepEqual(recorder._cinematicReplayExporter.resolveExportFormat(), PORTRAIT);

    recorder.setRecordingCaptureSettings({ orientation: 'landscape' });
    assert.deepEqual(recorder._cinematicReplayExporter.resolveExportFormat(), LANDSCAPE);

    // A hotkey start only names profile and preset; the orientation must survive that partial update.
    recorder.setRecordingCaptureSettings({ orientation: 'portrait' });
    recorder.setRecordingCaptureSettings({ profile: 'cinematic', exportPreset: 'youtube-mp4' });
    assert.deepEqual(recorder._cinematicReplayExporter.resolveExportFormat(), PORTRAIT);
});

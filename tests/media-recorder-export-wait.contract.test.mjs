import assert from 'node:assert/strict';
import test from 'node:test';

import { MediaRecorderSystem } from '../src/core/MediaRecorderSystem.js';
import { RECORDER_ENGINE } from '../src/core/recording/MediaRecorderSupport.js';

function withGlobalPatch(patch, callback) {
    const previous = new Map();
    for (const [key, value] of Object.entries(patch)) {
        previous.set(key, globalThis[key]);
        globalThis[key] = value;
    }
    return Promise.resolve()
        .then(callback)
        .finally(() => {
            for (const [key, value] of previous.entries()) {
                if (value === undefined) {
                    delete globalThis[key];
                } else {
                    globalThis[key] = value;
                }
            }
        });
}

function createDeferred() {
    let resolve = null;
    let reject = null;
    const promise = new Promise((innerResolve, innerReject) => {
        resolve = innerResolve;
        reject = innerReject;
    });
    return { promise, resolve, reject };
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stands for the Electron preload save contract. The main process answers
 * save-recording-video-export only after the native save dialog closed (and a
 * possible ffmpeg transcode ran), so an unattended dialog means no answer at all.
 */
function createDesktopRuntime(saveRecordingVideoExport) {
    const saveContract = {
        contractVersion: 'preload.save.v2',
        saveRecordingVideoExport,
    };
    return {
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
        fetch: async () => {
            throw new Error('the disk API fallback must not run on desktop');
        },
    };
}

/**
 * A live MediaRecorder capture that is about to stop: the engine hands back the
 * finished blob right away, as NativeMediaRecorderEngine does within its own 4 s cap.
 */
function createRecordingSystem({ exportWaitTimeoutMs }) {
    const recorder = new MediaRecorderSystem({
        canvas: null,
        autoRecordingEnabled: false,
        autoDownload: true,
        exportWaitTimeoutMs,
        logger: null,
        globalScope: {
            setTimeout,
            clearTimeout,
            __CURVIOS_APP__: globalThis.__CURVIOS_APP__,
            curviosApp: globalThis.curviosApp,
            fetch: globalThis.fetch,
        },
    });
    recorder._isRecording = true;
    recorder._activeMimeType = 'video/webm';
    recorder._activeRecorderEngine = RECORDER_ENGINE.NATIVE_MEDIARECORDER;
    recorder._activeRecording = {
        startedAt: Date.now() - 30_000,
        trigger: { type: 'recording_requested', context: { sessionId: 'perf-analysis' } },
    };
    recorder._activeRecorderStrategy = {
        stop: async () => ({
            ok: true,
            blob: new Blob(['clip'], { type: 'video/webm' }),
            mimeType: 'video/webm',
        }),
        dispose() {},
    };
    return recorder;
}

const SAVED_RESULT = Object.freeze({
    saved: true,
    code: 'RECORDING_SAVE_OK',
    filePath: 'C:/Videos/perf-analysis.webm',
    masterContainer: 'webm',
    deliveryContainer: 'webm',
});

test('an unattended desktop save dialog does not keep stopRecording pending', async () => {
    const dialog = createDeferred();
    let saveCalls = 0;
    await withGlobalPatch(createDesktopRuntime(() => {
        saveCalls += 1;
        return dialog.promise;
    }), async () => {
        const recorder = createRecordingSystem({ exportWaitTimeoutMs: 40 });

        const stopPromise = recorder.stopRecording({ source: 'perf-analysis', command: 'stop' });
        const outcome = await Promise.race([
            stopPromise.then((result) => ({ result })),
            delay(1000).then(() => 'pending'),
        ]);

        assert.notEqual(outcome, 'pending', 'stopRecording stayed pending while the save dialog was open');
        assert.equal(saveCalls, 1, 'the desktop save was requested once');
        assert.equal(outcome.result.stopped, true, 'the recording itself counts as stopped');
        assert.equal(outcome.result.exportStatus?.status, 'export_pending', 'the stop result says the save is still open');
        assert.equal(recorder.isRecording(), false);
        assert.equal(recorder._pendingStop, null, 'no stop stays pending after the bounded wait');

        dialog.resolve(SAVED_RESULT);
        await delay(0);
        const exportMeta = recorder.getLastExportMeta();
        assert.equal(exportMeta?.exportStatus?.status, 'saved_via_app', 'the late save result reaches the export meta');
        assert.equal(exportMeta?.filePath, SAVED_RESULT.filePath);
    });
});

test('a desktop save that answers within the wait still returns its final status', async () => {
    await withGlobalPatch(createDesktopRuntime(async () => SAVED_RESULT), async () => {
        const recorder = createRecordingSystem({ exportWaitTimeoutMs: 1000 });

        const result = await recorder.stopRecording({ type: 'contract_test' });

        assert.equal(result.stopped, true);
        assert.equal(result.exportStatus?.status, 'saved_via_app', 'a fast save is not reported as pending');
        assert.equal(result.filePath, SAVED_RESULT.filePath);
    });
});

test('a late save result does not overwrite a newer export record', async () => {
    const dialog = createDeferred();
    await withGlobalPatch(createDesktopRuntime(() => dialog.promise), async () => {
        const recorder = createRecordingSystem({ exportWaitTimeoutMs: 20 });
        const outcome = await Promise.race([
            recorder.stopRecording({ type: 'contract_test' }),
            delay(1000).then(() => 'pending'),
        ]);
        assert.notEqual(outcome, 'pending', 'stopRecording stayed pending while the save dialog was open');
        const newerExport = { filePath: 'C:/Videos/newer-recording.webm' };
        recorder._lastExport = newerExport;

        dialog.resolve(SAVED_RESULT);
        await delay(0);

        assert.equal(recorder._lastExport, newerExport, 'a late save keeps the newer export record');
    });
});

test('a late save result updates its export record while a newer recording is active', async () => {
    const dialog = createDeferred();
    await withGlobalPatch(createDesktopRuntime(() => dialog.promise), async () => {
        const recorder = createRecordingSystem({ exportWaitTimeoutMs: 20 });
        const outcome = await recorder.stopRecording({ type: 'contract_test' });
        assert.equal(outcome.exportStatus?.status, 'export_pending');

        recorder._activeRecording = { startedAt: Date.now(), trigger: { type: 'new_recording' } };
        dialog.resolve(SAVED_RESULT);
        await delay(0);

        assert.equal(recorder.getLastExportMeta()?.exportStatus?.status, 'saved_via_app');
        assert.equal(recorder.getLastExportMeta()?.filePath, SAVED_RESULT.filePath);
    });
});

test('a late desktop save cancellation updates the pending export to cancelled', async () => {
    const dialog = createDeferred();
    await withGlobalPatch(createDesktopRuntime(() => dialog.promise), async () => {
        const recorder = createRecordingSystem({ exportWaitTimeoutMs: 20 });
        const outcome = await recorder.stopRecording({ type: 'contract_test' });
        assert.equal(outcome.exportStatus?.status, 'export_pending');

        dialog.resolve({ saved: false, cancelled: true, code: 'RECORDING_SAVE_CANCELLED' });
        await delay(0);

        assert.equal(recorder.getLastExportMeta()?.exportStatus?.status, 'cancelled');
        assert.equal(recorder.getLastExportMeta()?.failureReason, 'cancelled');
    });
});

test('a late desktop save failure updates the pending export to failed', async () => {
    const dialog = createDeferred();
    await withGlobalPatch(createDesktopRuntime(() => dialog.promise), async () => {
        const recorder = createRecordingSystem({ exportWaitTimeoutMs: 20 });
        const outcome = await Promise.race([
            recorder.stopRecording({ type: 'contract_test' }),
            delay(1000).then(() => 'pending'),
        ]);
        assert.notEqual(outcome, 'pending', 'stopRecording stayed pending while the save dialog was open');

        dialog.reject(new Error('save_failed'));
        await delay(0);

        assert.equal(recorder.getLastExportMeta()?.exportStatus?.status, 'desktop_save_failed');
        assert.equal(recorder.getLastExportMeta()?.failureReason, 'desktop-save-failed');
    });
});

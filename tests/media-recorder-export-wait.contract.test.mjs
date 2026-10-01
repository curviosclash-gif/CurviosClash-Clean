import assert from 'node:assert/strict';
import test from 'node:test';

import { MediaRecorderSystem } from '../src/core/MediaRecorderSystem.js';
import { RECORDER_ENGINE } from '../src/core/recording/MediaRecorderSupport.js';
import { releaseSavedExportPayload, replaceLastExport } from '../src/core/recording/MediaRecorderExportFinalizeOps.js';
import { renderQueuedCinematicReplay } from '../src/core/recording/CinematicReplayMediaRecorderOps.js';

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
function createRecordingSystem({ exportWaitTimeoutMs, downloadHandler = undefined }) {
    const recorder = new MediaRecorderSystem({
        canvas: null,
        autoRecordingEnabled: false,
        autoDownload: true,
        downloadHandler,
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

test('only confirmed save transports release a record payload, once', async () => {
    const revokedUrls = [];
    await withGlobalPatch({
        URL: {
            createObjectURL() { return 'blob:unused'; },
            revokeObjectURL(url) { revokedUrls.push(url); },
        },
    }, () => {
        for (const [index, status] of [
            'saved_via_app',
            'saved_via_download',
            'saved_via_api',
            'saved_via_download_fallback',
        ].entries()) {
            const record = {
                blob: new Blob([status]),
                objectUrl: `blob:saved-${index}`,
                fileName: 'retained-metadata.webm',
                exportStatus: { status },
            };
            assert.equal(releaseSavedExportPayload(record), true);
            assert.equal(record.blob, null);
            assert.equal(record.objectUrl, null);
            assert.equal(record.fileName, 'retained-metadata.webm');
            assert.equal(releaseSavedExportPayload(record), true, 'confirmed release remains harmless when repeated');
        }
        for (const status of ['export_pending', 'cancelled', 'desktop_save_failed', 'export_failed']) {
            const record = {
                blob: new Blob([status]),
                objectUrl: `blob:recoverable-${status}`,
                exportStatus: { status },
            };
            assert.equal(releaseSavedExportPayload(record), false);
            assert.ok(record.blob instanceof Blob);
            assert.notEqual(record.objectUrl, null);
        }
    });
    assert.deepEqual(revokedUrls, [
        'blob:saved-0', 'blob:saved-1', 'blob:saved-2', 'blob:saved-3',
    ]);
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

test('a confirmed desktop save releases retained payload references but keeps export metadata', async () => {
    const revokedUrls = [];
    let nextUrl = 0;
    await withGlobalPatch(createDesktopRuntime(async () => SAVED_RESULT), async () => {
        await withGlobalPatch({
            URL: {
                createObjectURL: () => `blob:saved-${++nextUrl}`,
                revokeObjectURL: (url) => revokedUrls.push(url),
            },
        }, async () => {
            const recorder = createRecordingSystem({ exportWaitTimeoutMs: 1000 });
            const result = await recorder.stopRecording({ type: 'contract_test' });
            const record = recorder._lastExport;

            assert.equal(result.exportStatus?.status, 'saved_via_app');
            assert.equal(record.blob, null);
            assert.equal(record.objectUrl, null);
            assert.deepEqual(revokedUrls, ['blob:saved-1']);
            assert.equal(recorder.getLastExportMeta()?.filePath, SAVED_RESULT.filePath);
            assert.equal(recorder.getLastExportMeta()?.sizeBytes, 4);

            await recorder.dispose();
            assert.deepEqual(revokedUrls, ['blob:saved-1'], 'dispose does not revoke the released URL twice');
        });
    });
});

test('native share cancel and error retain payload, while confirmed share releases it', async () => {
    const cases = [
        { result: { saved: false, cancelled: true, transport: 'native-share' }, saved: false },
        { result: new Error('share_failed'), saved: false },
        { result: { saved: true, transport: 'native-share' }, saved: true },
    ];
    let nextUrl = 0;
    await withGlobalPatch({ __CURVIOS_APP__: true, curviosApp: undefined, fetch: undefined }, async () => {
        for (const [index, entry] of cases.entries()) {
            const revokedUrls = [];
            await withGlobalPatch({
                URL: {
                    createObjectURL: () => `blob:native-share-${++nextUrl}`,
                    revokeObjectURL: (url) => revokedUrls.push(url),
                },
            }, async () => {
                const recorder = createRecordingSystem({
                    exportWaitTimeoutMs: 1000,
                    downloadHandler: async () => {
                        if (entry.result instanceof Error) throw entry.result;
                        return entry.result;
                    },
                });
                const result = await recorder.stopRecording({ type: 'contract_test' });
                const record = recorder._lastExport;
                if (entry.saved) {
                    assert.equal(result.exportStatus?.status, 'saved_via_download');
                    assert.equal(record.blob, null);
                    assert.equal(record.objectUrl, null);
                    assert.deepEqual(revokedUrls, [`blob:native-share-${index + 1}`]);
                } else {
                    assert.equal(result.exportStatus?.status, entry.result?.cancelled ? 'cancelled' : 'download_failed');
                    assert.equal(
                        result.exportStatus?.failureReason,
                        entry.result?.cancelled ? 'cancelled' : 'share_failed'
                    );
                    assert.ok(record.blob instanceof Blob, 'cancelled or failed shares keep the payload recoverable');
                    assert.equal(record.objectUrl, `blob:native-share-${index + 1}`);
                    assert.deepEqual(revokedUrls, []);
                }
                assert.equal(recorder.getLastExportMeta()?.sizeBytes, 4, 'save metadata remains available');
                await recorder.dispose();
                assert.deepEqual(revokedUrls, [`blob:native-share-${index + 1}`]);
            });
        }
    });
});

test('a late save result does not overwrite a newer export record', async () => {
    const dialog = createDeferred();
    const revokedUrls = [];
    await withGlobalPatch(createDesktopRuntime(() => dialog.promise), async () => {
        await withGlobalPatch({
            URL: {
                createObjectURL: () => 'blob:stale-export',
                revokeObjectURL: (url) => revokedUrls.push(url),
            },
        }, async () => {
            const recorder = createRecordingSystem({ exportWaitTimeoutMs: 20 });
            const outcome = await Promise.race([
                recorder.stopRecording({ type: 'contract_test' }),
                delay(1000).then(() => 'pending'),
            ]);
            assert.notEqual(outcome, 'pending', 'stopRecording stayed pending while the save dialog was open');
            const staleExport = recorder._lastExport;
            const newerExport = { filePath: 'C:/Videos/newer-recording.webm' };
            replaceLastExport(recorder, newerExport);

            dialog.resolve(SAVED_RESULT);
            await delay(0);

            assert.equal(recorder._lastExport, newerExport, 'a late save keeps the newer export record');
            assert.equal(staleExport.exportStatus.status, 'export_pending', 'stale success cannot mutate its displaced record');
            assert.ok(staleExport.blob instanceof Blob);
            assert.equal(staleExport.objectUrl, 'blob:stale-export');
            assert.deepEqual(revokedUrls, ['blob:stale-export'], 'replacement revokes the stale URL once');
        });
    });
});

test('dispose revokes a pending export URL once and ignores its eventual save result', async () => {
    const dialog = createDeferred();
    const revokedUrls = [];
    await withGlobalPatch(createDesktopRuntime(() => dialog.promise), async () => {
        await withGlobalPatch({
            URL: {
                createObjectURL: () => 'blob:disposed-pending',
                revokeObjectURL: (url) => revokedUrls.push(url),
            },
        }, async () => {
            const recorder = createRecordingSystem({ exportWaitTimeoutMs: 20 });
            const outcome = await recorder.stopRecording({ type: 'contract_test' });
            const record = recorder._lastExport;
            assert.equal(outcome.exportStatus?.status, 'export_pending');

            await recorder.dispose();
            assert.equal(recorder._lastExport, null);
            assert.deepEqual(revokedUrls, ['blob:disposed-pending']);

            dialog.resolve(SAVED_RESULT);
            await delay(0);
            assert.equal(recorder._lastExport, null, 'a late completion cannot repopulate disposed state');
            assert.equal(record.exportStatus.status, 'export_pending', 'disposed records are not mutated after disposal');
            assert.deepEqual(revokedUrls, ['blob:disposed-pending'], 'late completion does not revoke twice');
        });
    });
});

test('a late save result updates its export record while a newer recording is active', async () => {
    const dialog = createDeferred();
    const revokedUrls = [];
    await withGlobalPatch(createDesktopRuntime(() => dialog.promise), async () => {
        await withGlobalPatch({
            URL: {
                createObjectURL: () => 'blob:late-saved',
                revokeObjectURL: (url) => revokedUrls.push(url),
            },
        }, async () => {
            const recorder = createRecordingSystem({ exportWaitTimeoutMs: 20 });
            const outcome = await recorder.stopRecording({ type: 'contract_test' });
            const record = recorder._lastExport;
            assert.equal(outcome.exportStatus?.status, 'export_pending');
            assert.ok(record.blob instanceof Blob);
            assert.equal(record.objectUrl, 'blob:late-saved');

            recorder._activeRecording = { startedAt: Date.now(), trigger: { type: 'new_recording' } };
            dialog.resolve(SAVED_RESULT);
            await delay(0);

            assert.equal(recorder.getLastExportMeta()?.exportStatus?.status, 'saved_via_app');
            assert.equal(recorder.getLastExportMeta()?.filePath, SAVED_RESULT.filePath);
            assert.equal(record.blob, null);
            assert.equal(record.objectUrl, null);
            assert.deepEqual(revokedUrls, ['blob:late-saved']);

            await recorder.dispose();
            assert.deepEqual(revokedUrls, ['blob:late-saved'], 'dispose cannot revoke a successfully released URL twice');
        });
    });
});

test('a late desktop save cancellation updates the pending export to cancelled', async () => {
    const dialog = createDeferred();
    await withGlobalPatch(createDesktopRuntime(() => dialog.promise), async () => {
        const recorder = createRecordingSystem({ exportWaitTimeoutMs: 20 });
        const outcome = await recorder.stopRecording({ type: 'contract_test' });
        assert.equal(outcome.exportStatus?.status, 'export_pending');
        const record = recorder._lastExport;

        dialog.resolve({ saved: false, cancelled: true, code: 'RECORDING_SAVE_CANCELLED' });
        await delay(0);

        assert.equal(recorder.getLastExportMeta()?.exportStatus?.status, 'cancelled');
        assert.equal(recorder.getLastExportMeta()?.failureReason, 'cancelled');
        assert.ok(record.blob instanceof Blob, 'cancelled saves retain the recoverable payload');
        assert.ok(record.objectUrl);
        await recorder.dispose();
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
        const record = recorder._lastExport;

        dialog.reject(new Error('save_failed'));
        await delay(0);

        assert.equal(recorder.getLastExportMeta()?.exportStatus?.status, 'desktop_save_failed');
        assert.equal(recorder.getLastExportMeta()?.failureReason, 'desktop-save-failed');
        assert.ok(record.blob instanceof Blob, 'failed saves retain the recoverable payload');
        assert.ok(record.objectUrl);
        await recorder.dispose();
    });
});

test('partial export replacements revoke the old URL once and keep the newest export through dispose', async () => {
    const revokedUrls = [];
    const createdUrls = [];
    let nextUrl = 0;
    await withGlobalPatch({
        URL: {
            createObjectURL(blob) {
                const objectUrl = `blob:recording-${++nextUrl}`;
                createdUrls.push({ objectUrl, blob });
                return objectUrl;
            },
            revokeObjectURL(objectUrl) { revokedUrls.push(objectUrl); },
        },
    }, async () => {
        const recorder = new MediaRecorderSystem({
            canvas: null,
            autoRecordingEnabled: false,
            autoDownload: false,
            logger: null,
        });
        const normalBlob = new Blob(['normal clip'], { type: 'video/webm' });
        await recorder._finalizeBlobExport(normalBlob, 'video/webm');
        const oldUrl = recorder._lastExport.objectUrl;
        assert.equal(oldUrl, 'blob:recording-1');

        const stopWithPartialBlob = async (engine, blob) => {
            recorder._isRecording = true;
            recorder._activeRecorderEngine = engine;
            recorder._activeRecording = { startedAt: Date.now(), trigger: { type: 'contract_test' } };
            recorder._activeRecorderStrategy = {
                stop: async () => ({
                    ok: true,
                    blob,
                    mimeType: 'video/webm',
                    partial: true,
                    partialReason: 'contract_test_partial',
                }),
                dispose() {},
            };
            return recorder.stopRecording({ type: 'contract_test' });
        };

        const firstPartial = new Blob(['first partial'], { type: 'video/webm' });
        await stopWithPartialBlob(RECORDER_ENGINE.NATIVE_MEDIARECORDER, firstPartial);
        assert.deepEqual(revokedUrls, [oldUrl], 'the first partial replaces and releases the previous normal export URL');
        assert.strictEqual(recorder._lastExport.blob, firstPartial);

        const secondPartial = new Blob(['second partial'], { type: 'video/webm' });
        await stopWithPartialBlob(RECORDER_ENGINE.NATIVE_WEBCODECS, secondPartial);
        assert.deepEqual(revokedUrls, [oldUrl], 'the displaced partial had no URL to revoke a second time');
        assert.strictEqual(recorder._lastExport.blob, secondPartial, 'the newest partial blob remains available');

        const latestNormalBlob = new Blob(['latest normal clip'], { type: 'video/webm' });
        await recorder._finalizeBlobExport(latestNormalBlob, 'video/webm');
        const latestUrl = recorder._lastExport.objectUrl;
        assert.equal(latestUrl, 'blob:recording-2', 'the next normal export keeps its newly created URL');
        assert.deepEqual(revokedUrls, [oldUrl]);

        await recorder.dispose();
        assert.deepEqual(revokedUrls, [oldUrl, latestUrl], 'dispose releases the currently retained URL exactly once');
        assert.deepEqual(createdUrls.map(({ objectUrl }) => objectUrl), [oldUrl, latestUrl]);
    });
});

test('cinematic replay replacement revokes a previously retained export URL', async () => {
    const revokedUrls = [];
    let nextUrl = 0;
    await withGlobalPatch({
        URL: {
            createObjectURL() { return `blob:cinematic-${++nextUrl}`; },
            revokeObjectURL(objectUrl) { revokedUrls.push(objectUrl); },
        },
    }, async () => {
        const recorder = new MediaRecorderSystem({
            canvas: null,
            autoRecordingEnabled: false,
            autoDownload: false,
            logger: null,
        });
        await recorder._finalizeBlobExport(new Blob(['prior export'], { type: 'video/webm' }), 'video/webm');
        const previousUrl = recorder._lastExport.objectUrl;

        recorder._cinematicReplayRecorder = { isRecording: false };
        recorder._pendingStop = null;
        recorder._cinematicReplayLibrary = {
            getReplay: (id) => (id === 'replay-1' ? { id } : null),
            remove: (id) => id === 'replay-1',
        };
        recorder._cinematicReplayExporter = {
            export: async () => ({ saved: true, fileName: 'replay.mp4' }),
        };
        recorder._notifyCinematicReplayLibraryChange = () => {};

        const result = await renderQueuedCinematicReplay(recorder, 'replay-1');
        assert.equal(result.saved, true);
        assert.deepEqual(revokedUrls, [previousUrl]);
        assert.equal(recorder._lastExport.fileName, 'replay.mp4');
        assert.equal(recorder._lastExport.objectUrl, undefined);
    });
});

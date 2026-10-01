import test from 'node:test';
import assert from 'node:assert/strict';

import { attemptAutoDownload, defaultDownload } from '../src/core/recording/DownloadService.js';

function withGlobalPatch(patch, callback) {
    const previous = new Map();
    for (const [key, value] of Object.entries(patch)) {
        previous.set(key, globalThis[key]);
        if (value === undefined) {
            globalThis[key] = undefined;
        } else {
            globalThis[key] = value;
        }
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

test('V115.4.3 DownloadService keeps desktop failures on the desktop transport', async () => {
    const status = await withGlobalPatch({
        fetch: undefined,
        curviosApp: {
            saveVideo: async () => ({
                saved: false,
                code: 'desktop-save-denied',
            }),
        },
    }, () => attemptAutoDownload({
        blob: new Blob(['clip'], { type: 'video/webm' }),
        fileName: 'clip.webm',
        mimeType: 'video/webm',
        autoDownload: true,
        downloadHandler: null,
        logger: null,
    }));

    assert.equal(status.transport, 'app');
    assert.equal(status.status, 'desktop_save_failed');
    assert.equal(status.failureReason, 'desktop-save-failed');
    assert.equal(
        status.warnings.includes('Desktop-Speicheradapter meldete desktop-save-denied.'),
        true
    );
    assert.equal(
        status.warnings.includes('Browser-Download-Handler ist nicht verfügbar; Download-Fallback wurde übersprungen.'),
        false
    );
    assert.equal(new Set(status.warnings).size, status.warnings.length);
});

test('desktop save cancellation never starts browser or API fallbacks', async () => {
    let fetchCalls = 0;
    let downloadCalls = 0;
    const saveContract = {
        contractVersion: 'preload.save.v2',
        saveRecordingVideoExport: async () => ({
            saved: false,
            cancelled: true,
            code: 'RECORDING_SAVE_CANCELLED',
        }),
    };
    const status = await withGlobalPatch({
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
            fetchCalls++;
            throw new Error('API fallback must not run');
        },
    }, () => attemptAutoDownload({
        blob: new Blob(['clip'], { type: 'video/webm' }),
        fileName: 'clip.webm',
        mimeType: 'video/webm',
        captureProfile: 'cinematic',
        autoDownload: true,
        downloadHandler: () => { downloadCalls++; },
        logger: null,
    }));

    assert.equal(status.status, 'cancelled');
    assert.equal(status.failureReason, 'cancelled');
    assert.equal(fetchCalls, 0);
    assert.equal(downloadCalls, 0);
});

test('browser download adapter awaits structured async save results and preserves legacy handlers', async () => {
    const runtimeGlobal = { __CURVIOS_APP__: true, fetch: undefined };
    const attempt = (downloadHandler) => attemptAutoDownload({
        blob: new Blob(['clip'], { type: 'video/webm' }),
        fileName: 'clip.webm',
        mimeType: 'video/webm',
        autoDownload: true,
        downloadHandler,
        logger: null,
        runtimeGlobal,
    });

    const cancelled = await attempt(async () => ({ saved: false, cancelled: true, transport: 'native-share' }));
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.failureReason, 'cancelled');
    assert.equal(cancelled.fallbackReason, 'cancelled');

    const nativeError = new Error('share_failed');
    nativeError.code = 'NATIVE_SHARE_FAILED';
    const rejected = await attempt(async () => { throw nativeError; });
    assert.equal(rejected.status, 'download_failed');
    assert.equal(rejected.failureReason, 'share_failed');
    assert.equal(rejected.saveCode, 'NATIVE_SHARE_FAILED');

    const shared = await attempt(async () => ({ saved: true, transport: 'native-share', uri: 'file:///cache/clip.webm' }));
    assert.equal(shared.status, 'saved_via_download');

    const legacy = await attempt(() => {});
    assert.equal(legacy.status, 'saved_via_download', 'legacy handlers without a result keep their prior success behavior');
});

test('browser save cancellation is returned as cancellation after one API fallback attempt', async () => {
    let fetchCalls = 0;
    let downloadCalls = 0;
    const status = await attemptAutoDownload({
        blob: new Blob(['clip'], { type: 'video/webm' }),
        fileName: 'clip.webm',
        mimeType: 'video/webm',
        autoDownload: true,
        downloadHandler: async () => {
            downloadCalls++;
            return { saved: false, cancelled: true, transport: 'native-share' };
        },
        logger: null,
        runtimeGlobal: {
            __CURVIOS_APP__: true,
            fetch: async () => {
                fetchCalls++;
                return { ok: false, status: 500 };
            },
        },
    });

    assert.equal(status.status, 'cancelled');
    assert.equal(status.failureReason, 'cancelled');
    assert.equal(status.fallbackReason, 'cancelled');
    assert.equal(fetchCalls, 1);
    assert.equal(downloadCalls, 1, 'cancellation does not start another save attempt');
});

test('defaultDownload returns the browser anchor result to its save caller', () => {
    const clicks = [];
    const runtimeGlobal = {
        URL: {
            createObjectURL: () => 'blob:anchor-export',
            revokeObjectURL() {},
        },
        setTimeout(callback) { callback(); },
        document: {
            createElement() {
                return {
                    style: {},
                    click() { clicks.push([this.href, this.download]); },
                    remove() {},
                };
            },
            body: { appendChild() {} },
        },
    };
    const result = defaultDownload({
        blob: new Blob(['clip']),
        fileName: 'clip.webm',
        globalScope: runtimeGlobal,
    });

    assert.deepEqual(result, { saved: true, transport: 'download' });
    assert.deepEqual(clicks, [['blob:anchor-export', 'clip.webm']]);
});

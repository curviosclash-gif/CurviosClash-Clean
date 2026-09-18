import test from 'node:test';
import assert from 'node:assert/strict';

import { attemptAutoDownload } from '../src/core/recording/DownloadService.js';

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

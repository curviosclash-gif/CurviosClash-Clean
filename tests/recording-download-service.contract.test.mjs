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

test('V115.4.3 DownloadService reports missing browser fallback handler instead of throwing', async () => {
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

    assert.equal(status.transport, 'download-failed');
    assert.equal(status.status, 'download_failed');
    assert.equal(status.failureReason, 'fetch-unavailable');
    assert.equal(
        status.warnings.includes('Desktop-Speicheradapter meldete desktop-save-denied.'),
        true
    );
    assert.equal(
        status.warnings.includes('Browser-Download-Handler ist nicht verfuegbar; Download-Fallback wurde uebersprungen.'),
        true
    );
    assert.equal(new Set(status.warnings).size, status.warnings.length);
});

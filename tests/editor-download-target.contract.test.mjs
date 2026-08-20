import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';

const require = createRequire(import.meta.url);
const {
    installEditorDownloadTarget,
    resolveFreeTargetPath,
    sanitizeDownloadFileName,
} = require('../electron/editor-download-target.cjs');

const APP_ORIGIN = 'http://127.0.0.1:5173';
const TRUSTED_URL = `${APP_ORIGIN}${EDITOR_VIEW_PATHS.VEHICLE_LAB}`;
const FOREIGN_URL = `${APP_ORIGIN}/index.html`;

function createDownloadItem(fileName) {
    const item = new EventEmitter();
    item.savePath = '';
    item.getFilename = () => fileName;
    item.getSavePath = () => item.savePath;
    item.setSavePath = (value) => { item.savePath = value; };
    return item;
}

function emitDownload(session, fileName, sourceUrl) {
    const item = createDownloadItem(fileName);
    session.emit('will-download', {}, item, { getURL: () => sourceUrl });
    return item;
}

test('editor downloads receive an explicit target instead of staying pending', async () => {
    const downloads = await mkdtemp(path.join(os.tmpdir(), 'curvios-dl-'));
    const session = new EventEmitter();
    try {
        installEditorDownloadTarget(session, {
            isTrustedEditorUrl: (url) => url === TRUSTED_URL,
            getDownloadsDirectory: () => downloads,
        });

        const item = emitDownload(session, 'prufschiff-umlaut.json', TRUSTED_URL);

        assert.equal(item.getSavePath(), path.join(downloads, 'prufschiff-umlaut.json'));
    } finally {
        await rm(downloads, { recursive: true, force: true });
    }
});

test('downloads from other windows keep the default save dialog', async () => {
    const downloads = await mkdtemp(path.join(os.tmpdir(), 'curvios-dl-'));
    const session = new EventEmitter();
    try {
        installEditorDownloadTarget(session, {
            isTrustedEditorUrl: (url) => url === TRUSTED_URL,
            getDownloadsDirectory: () => downloads,
        });

        assert.equal(emitDownload(session, 'beute.json', FOREIGN_URL).getSavePath(), '');
        assert.equal(emitDownload(session, 'setup.exe', TRUSTED_URL).getSavePath(), '');
    } finally {
        await rm(downloads, { recursive: true, force: true });
    }
});

test('editor downloads never overwrite an existing export', async () => {
    const downloads = await mkdtemp(path.join(os.tmpdir(), 'curvios-dl-'));
    try {
        await writeFile(path.join(downloads, 'schiff.json'), '{}', 'utf8');
        assert.equal(resolveFreeTargetPath(downloads, 'schiff.json'), path.join(downloads, 'schiff (2).json'));

        await writeFile(path.join(downloads, 'schiff (2).json'), '{}', 'utf8');
        assert.equal(resolveFreeTargetPath(downloads, 'schiff.json'), path.join(downloads, 'schiff (3).json'));
    } finally {
        await rm(downloads, { recursive: true, force: true });
    }
});

test('download file names cannot escape the target directory', () => {
    const BACKSLASH = String.fromCharCode(92);
    // Trennzeichen werden zu Bindestrichen, statt als Pfad gelesen zu werden.
    assert.equal(sanitizeDownloadFileName('../../etc/passwd.json'), 'etc-passwd.json');
    assert.equal(sanitizeDownloadFileName(`a/b${BACKSLASH}c.json`), 'a-b-c.json');
    assert.equal(sanitizeDownloadFileName('...'), 'export.json');
    assert.equal(sanitizeDownloadFileName(''), 'export.json');
    assert.equal(sanitizeDownloadFileName('mein:schiff?.json'), 'mein-schiff-.json');

    const hostile = ['../../etc/passwd.json', `a/b${BACKSLASH}c.json`, `C:${BACKSLASH}Windows${BACKSLASH}schiff.json`];
    for (const raw of hostile) {
        const name = sanitizeDownloadFileName(raw);
        assert.equal(name.includes('/'), false);
        assert.equal(name.includes(BACKSLASH), false);
        assert.equal(name.startsWith('.'), false);
    }
});

test('unregistering the handler restores the default behaviour', async () => {
    const downloads = await mkdtemp(path.join(os.tmpdir(), 'curvios-dl-'));
    const session = new EventEmitter();
    try {
        const dispose = installEditorDownloadTarget(session, {
            isTrustedEditorUrl: () => true,
            getDownloadsDirectory: () => downloads,
        });
        dispose();

        assert.equal(session.listenerCount('will-download'), 0);
        assert.equal(emitDownload(session, 'schiff.json', TRUSTED_URL).getSavePath(), '');
    } finally {
        await rm(downloads, { recursive: true, force: true });
    }
});

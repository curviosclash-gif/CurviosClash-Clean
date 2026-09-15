import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    createCinematicReplayVideoExportJob,
    parseFrameRate,
} = require('../electron/cinematic-replay-video-export-job.cjs');

class MockEncoderProcess extends EventEmitter {
    constructor() {
        super();
        this.stdin = new PassThrough();
        // Drain like ffmpeg would; otherwise a full-size frame never finishes writing.
        this.stdin.resume();
        this.stderr = new PassThrough();
        this.pid = 0;
    }

    kill() {
        queueMicrotask(() => this.emit('close', null, 'SIGKILL'));
        return true;
    }
}

class FailingEncoderProcess extends MockEncoderProcess {
    constructor() {
        super();
        this.stdin.write = (_bytes, callback) => {
            queueMicrotask(() => {
                const error = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
                this.stdin.emit('error', error);
                callback?.(error);
                this.emit('close', 1, null);
            });
            return true;
        };
    }
}

test('cinematic exporter accepts 1080p60 landscape and portrait and uses correct temporary container extensions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'curvios-export-contract-'));
    const videoDirectory = path.join(root, 'videos');
    let spawnedArgs = null;
    const job = createCinematicReplayVideoExportJob({
        app: {
            getPath(name) {
                return name === 'videos' ? videoDirectory : root;
            },
        },
        dialog: {
            async showSaveDialog() {
                return { canceled: false, filePath: path.join(videoDirectory, 'match.mp4') };
            },
        },
        spawnProcess(_command, args) {
            spawnedArgs = args;
            // Every export gets its own encoder process, like ffmpeg in production.
            return new MockEncoderProcess();
        },
        probeCapability: async () => ({ available: true, command: 'ffmpeg', source: 'test' }),
        executeCommand: async () => ({ ok: true, stdout: ' V..... libx264 H.264 encoder', stderr: '' }),
    });
    try {
        const invalid = await job.begin({ width: 1280, height: 720, fps: 60 });
        assert.equal(invalid.reason, 'invalid_cinematic_format');
        const started = await job.begin({
            matchId: 'match-contract',
            fileName: 'match.mp4',
            width: 1920,
            height: 1080,
            fps: 60,
            expectedDurationMs: 1000,
            audioBytes: new Uint8Array([1, 2, 3]),
            audioMimeType: 'audio/webm;codecs=opus',
        });
        assert.equal(started.started, true);
        assert.match(spawnedArgs.at(-1), /\.tmp\.mp4$/);
        const audioInputIndex = spawnedArgs.indexOf('-i', spawnedArgs.indexOf('pipe:0') + 1);
        assert.match(spawnedArgs[audioInputIndex + 1], /\.webm$/);
        assert.equal(spawnedArgs.includes('libx264'), true);
        assert.equal(spawnedArgs.includes('yuv420p'), true);
        assert.equal(spawnedArgs.includes('60000'), true);
        assert.equal(spawnedArgs[spawnedArgs.indexOf('-preset') + 1], 'veryfast');
        assert.equal(spawnedArgs[spawnedArgs.indexOf('-af') + 1], 'apad');
        assert.equal(spawnedArgs[spawnedArgs.indexOf('-t') + 1], '1');
        assert.equal(spawnedArgs.includes('-shortest'), false);

        const rejected = await job.appendFrame({
            exportId: started.exportId,
            frameIndex: 0,
            frameBytes: new Uint8Array(1),
        });
        assert.equal(rejected.accepted, false);
        assert.equal(rejected.reason, 'frame_size_invalid');

        const cancelled = await job.cancel({ exportId: started.exportId });
        assert.equal(cancelled.cancelled, true);
        assert.equal(job.getStatus().active, false);

        const square = await job.begin({ width: 1080, height: 1080, fps: 60 });
        assert.equal(square.reason, 'invalid_cinematic_format');
        const portrait = await job.begin({
            matchId: 'match-portrait',
            fileName: 'portrait.mp4',
            width: 1080,
            height: 1920,
            fps: 60,
            expectedDurationMs: 1000,
        });
        assert.equal(portrait.started, true);
        assert.equal(portrait.width, 1080);
        assert.equal(portrait.height, 1920);
        assert.equal(spawnedArgs[spawnedArgs.indexOf('-video_size') + 1], '1080x1920');
        const portraitFrame = await job.appendFrame({
            exportId: portrait.exportId,
            frameIndex: 0,
            frameBytes: new Uint8Array(1920 * 1080 * 4),
        });
        assert.equal(portraitFrame.accepted, true);
        await job.cancel({ exportId: portrait.exportId });
    } finally {
        await rm(root, { recursive: true });
    }
});

test('cinematic exporter reports frame-rate fractions exactly', () => {
    assert.equal(parseFrameRate('60/1'), 60);
    assert.equal(parseFrameRate('60000/1000'), 60);
    assert.equal(parseFrameRate('0/0'), 0);
});

test('cinematic exporter reports an early encoder pipe close without an unhandled stream error', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'curvios-export-epipe-'));
    const child = new FailingEncoderProcess();
    const job = createCinematicReplayVideoExportJob({
        app: {
            getPath(name) {
                return name === 'videos' ? path.join(root, 'videos') : root;
            },
        },
        dialog: {
            async showSaveDialog() {
                return { canceled: false, filePath: path.join(root, 'videos', 'match.mp4') };
            },
        },
        spawnProcess: () => child,
        probeCapability: async () => ({ available: true, command: 'ffmpeg', source: 'test' }),
        executeCommand: async () => ({ ok: true, stdout: ' V..... libx264 H.264 encoder', stderr: '' }),
    });
    try {
        const started = await job.begin({
            matchId: 'match-epipe',
            width: 1920,
            height: 1080,
            fps: 60,
            expectedDurationMs: 1000,
        });
        assert.equal(started.started, true);
        const appendResult = await job.appendFrame({
            exportId: started.exportId,
            frameIndex: 0,
            frameBytes: new Uint8Array(1920 * 1080 * 4),
        });
        assert.equal(appendResult.accepted, false);
        assert.match(appendResult.reason, /EPIPE/);
        await job.cancel({ exportId: started.exportId });
    } finally {
        await rm(root, { recursive: true });
    }
});

test('desktop shutdown asks before aborting an active export and has no three-second cutoff', async () => {
    const source = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /GRACEFUL_CLOSE_TIMEOUT_MS\s*=\s*3000\b/);
    assert.match(source, /Export abwarten/);
    assert.match(source, /Export abbrechen/);
    const lifecycle = await readFile(new URL('../electron/main-window-lifecycle.cjs', import.meta.url), 'utf8');
    assert.match(lifecycle, /application_close_confirmed/);
    // J1: the fallback timeout must never be skipped, not even after the export
    // dialog was confirmed — otherwise a hung renderer traps the window.
    assert.doesNotMatch(source, /exportCloseApproved\s*\?\s*null/);
    assert.match(source, /render-process-gone/);
    assert.match(source, /Wiederherstellen/);
    assert.match(source, /Bestaetigt bereinigen/);
});

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
        this.stderr = new PassThrough();
        this.pid = 0;
    }

    kill() {
        queueMicrotask(() => this.emit('close', null, 'SIGKILL'));
        return true;
    }
}

test('cinematic exporter enforces 1080p60 and uses correct temporary container extensions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'curvios-export-contract-'));
    const videoDirectory = path.join(root, 'videos');
    let spawnedArgs = null;
    const child = new MockEncoderProcess();
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
            return child;
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
    } finally {
        await rm(root, { recursive: true });
    }
});

test('cinematic exporter reports frame-rate fractions exactly', () => {
    assert.equal(parseFrameRate('60/1'), 60);
    assert.equal(parseFrameRate('60000/1000'), 60);
    assert.equal(parseFrameRate('0/0'), 0);
});

test('desktop shutdown asks before aborting an active export and has no three-second cutoff', async () => {
    const source = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /GRACEFUL_CLOSE_TIMEOUT_MS\s*=\s*3000\b/);
    assert.match(source, /Export abwarten/);
    assert.match(source, /Export abbrechen/);
    assert.match(source, /application_close_confirmed/);
    assert.match(source, /exportCloseApproved\s*\?\s*null/);
    assert.match(source, /Wiederherstellen/);
    assert.match(source, /Bestaetigt bereinigen/);
});

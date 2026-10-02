import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { CinematicReplayExportController } from '../src/core/recording/CinematicReplayExportController.js';

const require = createRequire(import.meta.url);
const { createCinematicReplayVideoExportJob } = require('../electron/cinematic-replay-video-export-job.cjs');

const FRAME_BYTES = 1920 * 1080 * 4;
const MISSING_MESSAGE = 'H.264-Encoder (FFmpeg/libx264) ist nicht verfügbar.';

// Like a real FFmpeg that cannot open its output: it reports the reason on
// stderr, exits, and every later stdin write fails with EOF.
class EarlyExitEncoderProcess extends EventEmitter {
    constructor(stderrText, exitCode) {
        super();
        this.stdin = new PassThrough();
        this.stderr = new PassThrough();
        this.pid = 0;
        this.stdin.write = (_bytes, callback) => {
            const error = Object.assign(new Error('write EOF'), { code: 'EOF' });
            queueMicrotask(() => {
                this.stdin.emit('error', error);
                callback?.(error);
            });
            return false;
        };
        queueMicrotask(() => {
            this.stderr.end(stderrText);
            this.stderr.once('close', () => this.emit('close', exitCode, null));
        });
    }

    kill() {
        return true;
    }
}

async function runFailingAppend(stderrText) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'curvios-export-encoder-failure-'));
    const job = createCinematicReplayVideoExportJob({
        app: { getPath: (name) => (name === 'videos' ? path.join(root, 'videos') : root) },
        dialog: {
            async showSaveDialog() {
                return { canceled: false, filePath: path.join(root, 'videos', 'match.mp4') };
            },
        },
        spawnProcess: () => new EarlyExitEncoderProcess(stderrText, 4294967283),
        probeCapability: async () => ({ available: true, command: 'ffmpeg', source: 'test' }),
        executeCommand: async () => ({ ok: true, stdout: ' V..... libx264 H.264 encoder', stderr: '' }),
    });
    try {
        const started = await job.begin({ matchId: 'match-encoder-failure', width: 1920, height: 1080, fps: 60 });
        assert.equal(started.started, true);
        const result = await job.appendFrame({
            exportId: started.exportId,
            frameIndex: 0,
            frameBytes: new Uint8Array(FRAME_BYTES),
        });
        await job.cancel({ exportId: started.exportId });
        return result;
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

test('an encoder that cannot create the output file reports access denied with its stderr', async () => {
    const stderr = '[out#0/mp4 @ 0000] Error opening output C:\\Videos\\.curvios.tmp.mp4: Permission denied\n'
        + 'Error opening output files: Permission denied\n';
    const result = await runFailingAppend(stderr);
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'ffmpeg_output_access_denied');
    assert.match(result.diagnostics, /Permission denied/);
    assert.equal(result.exitCode, 4294967283);
});

test('an encoder that exits for another reason reports an abort with its stderr', async () => {
    const result = await runFailingAppend('Unrecognized option \'fps_mode\'.\n');
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'ffmpeg_encode_aborted');
    assert.match(result.writeError, /EOF/);
    assert.match(result.diagnostics, /fps_mode/);
});

function createController(saveOverrides) {
    const saveContract = {
        contractVersion: 'preload.save.v2',
        beginCinematicReplayExport: async () => ({ started: true, exportId: 'export-1' }),
        appendCinematicReplayFrame: async () => ({ accepted: true }),
        finishCinematicReplayExport: async () => ({ saved: true }),
        cancelCinematicReplayExport: async () => ({ cancelled: true }),
        ...saveOverrides,
    };
    const statuses = [];
    const controller = new CinematicReplayExportController({
        runtimeGlobal: {
            __CURVIOS_APP__: true,
            curviosApp: {
                contracts: { save: saveContract },
                capabilities: {
                    save: { available: true, providerKind: 'electron-ipc', contractVersion: 'preload.save.v2' },
                },
            },
        },
        renderFrame: async ({ reset }) => (reset ? null : {
            width: 1920,
            height: 1080,
            getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(FRAME_BYTES) }) }),
        }),
        onStatus: (status) => statuses.push(status),
        logger: { warn() {} },
    });
    return { controller, statuses };
}

const replay = {
    matchId: 'match-message',
    durationMs: 17,
    snapshots: [{ timeMs: 0, players: [] }, { timeMs: 17, players: [] }],
    metadata: {},
    audioBlob: null,
};

test('the export message tells an aborted encoder apart from a missing one', async () => {
    const aborted = createController({
        appendCinematicReplayFrame: async () => ({
            accepted: false,
            reason: 'ffmpeg_encode_aborted',
            diagnostics: 'Conversion failed!',
        }),
    });
    const abortedResult = await aborted.controller.export(replay);
    assert.equal(abortedResult.saved, false);
    assert.notEqual(abortedResult.message, MISSING_MESSAGE);
    assert.match(abortedResult.message, /abgebrochen/);
    assert.equal(abortedResult.diagnostics, 'Conversion failed!');
    assert.equal(aborted.statuses.at(-1).message, abortedResult.message);

    const denied = createController({
        appendCinematicReplayFrame: async () => ({ accepted: false, reason: 'ffmpeg_output_access_denied' }),
    });
    const deniedResult = await denied.controller.export(replay);
    assert.match(deniedResult.message, /Zugriff verweigert/);

    // Older main processes still answer with the raw pipe error.
    const legacy = createController({
        appendCinematicReplayFrame: async () => ({ accepted: false, reason: 'encoder_input_closed' }),
    });
    assert.match((await legacy.controller.export(replay)).message, /abgebrochen/);

    const missing = createController({
        beginCinematicReplayExport: async () => ({
            started: false,
            reason: 'libx264_encoder_unavailable',
            code: 'RECORDING_H264_ENCODER_UNAVAILABLE',
        }),
    });
    assert.equal((await missing.controller.export(replay)).message, MISSING_MESSAGE);

    const finishFailed = createController({
        finishCinematicReplayExport: async () => ({
            saved: false,
            reason: 'ffmpeg_encode_failed',
            diagnostics: 'moov atom not found',
        }),
    });
    const finishResult = await finishFailed.controller.export(replay);
    assert.match(finishResult.message, /abgebrochen/);
    assert.equal(finishResult.diagnostics, 'moov atom not found');
});

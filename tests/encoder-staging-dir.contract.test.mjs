// Playtest 02.10.2026: a cinematic render never produced a video when the app ran from the
// checkout. FFmpeg inherits the low integrity label of the sandboxed checkout, runs with low
// integrity and was denied writing next to the chosen target; AppData\LocalLow stays writable.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveEncoderStagingDirectory, publishStagedFile } = require('../electron/encoder-staging-dir.cjs');

test('on Windows the encoder writes into LocalLow, elsewhere and without a home it keeps the fallback', () => {
    const app = { getPath: (name) => (name === 'home' ? 'C:\\Users\\Pilot' : '') };
    assert.equal(resolveEncoderStagingDirectory(app, { platform: 'win32', fallback: 'X' }),
        path.join('C:\\Users\\Pilot', 'AppData', 'LocalLow', 'CurviosClash', 'export'));
    assert.equal(resolveEncoderStagingDirectory(app, { platform: 'linux', fallback: 'X' }), 'X');
    assert.equal(resolveEncoderStagingDirectory({ getPath: () => { throw new Error('no home'); } }, { platform: 'win32', fallback: 'X' }), 'X');
    assert.equal(resolveEncoderStagingDirectory(null, { platform: 'win32', fallback: 'X' }), 'X');
});

test('a staged video moves to its target, across volumes through a part file', async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'curvios-staging-'));
    t.after(() => rm(root, { recursive: true }));
    const staged = path.join(root, 'staged.mp4');
    await writeFile(staged, 'video');
    const target = path.join(root, 'out', 'match.mp4');
    await publishStagedFile(staged, target);
    assert.equal(await readFile(target, 'utf8'), 'video');

    const calls = [];
    const fsImpl = {
        mkdir: async () => {},
        rename: async (from, to) => {
            calls.push(['rename', path.basename(from), path.basename(to)]);
            if (from === 'staged' && to === 'target') throw Object.assign(new Error('cross device'), { code: 'EXDEV' });
        },
        copyFile: async (from, to) => calls.push(['copy', path.basename(from), path.basename(to)]),
        rm: async (file) => calls.push(['rm', path.basename(file)]),
    };
    await publishStagedFile('staged', 'target', fsImpl);
    assert.deepEqual(calls, [
        ['rename', 'staged', 'target'],
        ['copy', 'staged', 'target.part'],
        ['rename', 'target.part', 'target'],
        ['rm', 'staged'],
    ], 'the target only ever receives a complete file');

    const failing = { ...fsImpl, copyFile: async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } };
    calls.length = 0;
    await assert.rejects(publishStagedFile('staged', 'target', failing), /disk full/);
    assert.deepEqual(calls.at(-1), ['rm', 'target.part'], 'a failed copy leaves no part file behind');
    assert.deepEqual(await readdir(path.join(root, 'out')), ['match.mp4']);
});

test('the cinematic exporter hands FFmpeg an output path in the staging folder', { skip: process.platform !== 'win32' }, async () => {
    const { createCinematicReplayVideoExportJob } = require('../electron/cinematic-replay-video-export-job.cjs');
    const root = await mkdtemp(path.join(os.tmpdir(), 'curvios-staging-job-'));
    const videos = path.join(root, 'videos');
    let outputPath = null;
    const job = createCinematicReplayVideoExportJob({
        app: { getPath: (name) => (name === 'videos' ? videos : root) },
        dialog: { async showSaveDialog() { return { canceled: false, filePath: path.join(videos, 'match.mp4') }; } },
        spawnProcess(_command, args) {
            outputPath = args.at(-1);
            const encoder = new EventEmitter();
            encoder.stdin = new PassThrough().resume();
            encoder.stderr = new PassThrough();
            encoder.kill = () => { queueMicrotask(() => encoder.emit('close', null, 'SIGKILL')); return true; };
            return encoder;
        },
        probeCapability: async () => ({ available: true, command: 'ffmpeg', source: 'test' }),
        executeCommand: async () => ({ ok: true, stdout: ' V..... libx264 H.264 encoder', stderr: '' }),
    });
    try {
        const started = await job.begin({ matchId: 'm1', fileName: 'match.mp4', width: 1920, height: 1080, fps: 60, expectedDurationMs: 1000 });
        assert.equal(started.started, true, JSON.stringify(started));
        assert.equal(path.dirname(outputPath), path.join(root, 'AppData', 'LocalLow', 'CurviosClash', 'export'),
            'FFmpeg writes into LocalLow, not next to the target');
        await job.cancel({ exportId: started.exportId });
    } finally {
        await rm(root, { recursive: true });
    }
});

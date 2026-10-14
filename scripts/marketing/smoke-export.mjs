// Synthetic media validates the encoder and quality gates, never human provenance.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { run, ffmpeg, sourceDecodeArgs } from './session-tools.mjs';
import { exportSessionMedia } from './export-session-media.mjs';

const folder = await mkdtemp(path.join(os.tmpdir(), 'curvios-media-smoke-'));
try {
const source = path.join(folder, 'source.webm');
await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=60',
    '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', path.join(folder, 'picture.mp4')]);
await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '3', '-c:a', 'libopus', source]);
const candidate = { startMs: 500, endMs: 2500, captions: [{ start: 0, end: 2, text: 'Technical test' }] };
const probe = await exportSessionMedia({ folder, source, candidate });
assert.equal(probe.streams.find((s) => s.codec_type === 'video').nb_frames, '120');
const invalid = path.join(folder, 'black'); await mkdir(invalid);
await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:size=1080x1920:rate=60',
    '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', path.join(invalid, 'picture.mp4')]);
await assert.rejects(exportSessionMedia({ folder: invalid, source, candidate }), /black_or_frozen_frames/);
const damaged = path.join(folder, 'damaged.webm');
await writeFile(damaged, Buffer.from('invalid source packet stream'));
await assert.rejects(run(ffmpeg, sourceDecodeArgs(damaged)), /exited/);
console.log('Media export and black/freeze rejection passed.');
} finally {
    await rm(folder, { recursive: true, force: true });
}

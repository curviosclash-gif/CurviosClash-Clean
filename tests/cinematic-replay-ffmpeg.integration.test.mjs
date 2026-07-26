import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateMp4 } = require('../electron/cinematic-replay-video-export-job.cjs');

function resolveCommand(name) {
    const locator = process.platform === 'win32' ? 'where.exe' : 'which';
    try {
        return String(execFileSync(locator, [name], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        })).split(/\r?\n/).find(Boolean) || null;
    } catch {
        return null;
    }
}

test('real FFmpeg output is playable H.264 MP4 at 1080p60 with synchronized audio', async (t) => {
    const ffmpeg = resolveCommand(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const ffprobe = resolveCommand(process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    if (!ffmpeg || !ffprobe) {
        t.skip('FFmpeg/ffprobe not available in test environment');
        return;
    }
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'curvios-replay-ffmpeg-'));
    const outputPath = path.join(tempDirectory, 'cinematic-integration.mp4');
    try {
        const encode = spawnSync(ffmpeg, [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-f', 'lavfi', '-i', 'color=c=0x203050:s=1920x1080:r=60:d=1',
            '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
            '-map', '0:v:0', '-map', '1:a:0',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
            '-pix_fmt', 'yuv420p', '-r', '60', '-fps_mode', 'cfr',
            '-video_track_timescale', '60000',
            '-c:a', 'aac', '-b:a', '192k',
            '-movflags', '+faststart',
            outputPath,
        ], { encoding: 'utf8', timeout: 120000 });
        assert.equal(encode.status, 0, encode.stderr || 'FFmpeg encode failed');

        const validation = await validateMp4({
            ffprobeCommand: ffprobe,
            filePath: outputPath,
            width: 1920,
            height: 1080,
            fps: 60,
            expectedDurationMs: 1000,
            audioExpected: true,
        });
        assert.equal(validation.valid, true, JSON.stringify(validation));
        assert.equal(validation.videoCodec, 'h264');
        assert.equal(validation.audioPresent, true);
        assert.ok(Math.abs(validation.fps - 60) < 0.01);
        assert.ok(Math.abs(validation.durationSeconds - 1) < 0.1);

        const fallbackValidation = await validateMp4({
            ffprobeCommand: path.join(tempDirectory, 'missing-ffprobe'),
            ffmpegCommand: ffmpeg,
            filePath: outputPath,
            width: 1920,
            height: 1080,
            fps: 60,
            expectedDurationMs: 1000,
            audioExpected: true,
        });
        assert.equal(fallbackValidation.valid, true, JSON.stringify(fallbackValidation));
        assert.equal(fallbackValidation.validationTool, 'ffmpeg');

        const decode = spawnSync(ffmpeg, [
            '-hide_banner', '-loglevel', 'error',
            '-i', outputPath,
            '-map', '0:v:0', '-map', '0:a:0',
            '-f', 'null', '-',
        ], { encoding: 'utf8', timeout: 120000 });
        assert.equal(decode.status, 0, decode.stderr || 'FFmpeg decode failed');
    } finally {
        await rm(tempDirectory, { recursive: true });
    }
});

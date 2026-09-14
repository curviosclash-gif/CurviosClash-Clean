const path = require('node:path');
const { existsSync, promises: fsPromises } = require('node:fs');
const { spawn } = require('node:child_process');
const {
    executeProcess,
    probeNativeTranscodeCapability,
    terminateChildProcess,
} = require('./recording-video-export-job.cjs');

const CONTRACT_VERSION = 'cinematic-replay-video-export.v1';
const TEMP_DIRECTORY_NAME = 'curviosclash-recording-exports';
const MANIFEST_SUFFIX = '.export.json';
const MIN_VALID_MP4_BYTES = 16 * 1024;
const MAX_DIAGNOSTIC_LENGTH = 64 * 1024;
// Mirrors CINEMATIC_REPLAY_EXPORT_FORMATS in src/shared/contracts/RecordingCaptureContract.js.
const CINEMATIC_EXPORT_FPS = 60;
const SUPPORTED_CINEMATIC_FORMATS = Object.freeze([
    Object.freeze({ width: 1920, height: 1080 }),
    Object.freeze({ width: 1080, height: 1920 }),
]);

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function normalizePositiveInt(value, fallback, min, max) {
    const numeric = Math.trunc(Number(value));
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function sanitizeToken(value, fallback = 'recording') {
    return normalizeString(value, fallback)
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        || fallback;
}

function toUint8Array(value) {
    if (value instanceof Uint8Array) return value;
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (Array.isArray(value)) return Uint8Array.from(value);
    return new Uint8Array(0);
}

function parseFrameRate(value) {
    const [numerator, denominator] = String(value || '').split('/').map(Number);
    if (!Number.isFinite(numerator)) return 0;
    if (!Number.isFinite(denominator) || denominator === 0) return numerator;
    return numerator / denominator;
}

function parseFfmpegDurationSeconds(output) {
    const match = String(output || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
    if (!match) return 0;
    return (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
}

function formatDurationSeconds(durationMs) {
    const seconds = Math.max(0, Number(durationMs) || 0) / 1000;
    if (seconds <= 0) return '';
    return seconds.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

async function validateMp4WithFfmpeg({
    ffmpegCommand,
    filePath,
    width,
    height,
    fps,
    expectedDurationMs,
    audioExpected,
    sizeBytes,
}) {
    if (!normalizeString(ffmpegCommand)) {
        return { valid: false, reason: 'validation_ffprobe_failed' };
    }
    const decode = await executeProcess(ffmpegCommand, [
        '-hide_banner', '-v', 'info',
        '-i', filePath,
        '-map', '0:v:0',
        ...(audioExpected ? ['-map', '0:a:0'] : []),
        '-f', 'null', '-',
    ], Math.max(120000, (Number(expectedDurationMs) || 0) * 2));
    const diagnostics = `${decode.stdout}\n${decode.stderr}`;
    if (!decode.ok) {
        return { valid: false, reason: 'validation_decode_failed', errorCode: decode.errorCode };
    }
    const videoLine = diagnostics.split(/\r?\n/).find((line) => /Video:\s*h264\b/i.test(line)) || '';
    const resolutionMatch = videoLine.match(/(\d{2,5})x(\d{2,5})/);
    const fpsMatch = videoLine.match(/(\d+(?:\.\d+)?)\s*fps\b/i);
    const durationSeconds = parseFfmpegDurationSeconds(diagnostics);
    const expectedSeconds = Math.max(0, Number(expectedDurationMs) || 0) / 1000;
    const durationTolerance = Math.max(1, expectedSeconds * 0.08);
    const audioPresent = /Audio:\s*(?:aac|opus|vorbis|mp3)\b/i.test(diagnostics);
    if (!videoLine) return { valid: false, reason: 'validation_codec_invalid' };
    if (Number(resolutionMatch?.[1]) !== width || Number(resolutionMatch?.[2]) !== height) {
        return { valid: false, reason: 'validation_resolution_invalid' };
    }
    if (Math.abs(Number(fpsMatch?.[1]) - fps) > 0.01) {
        return { valid: false, reason: 'validation_framerate_invalid' };
    }
    if (!durationSeconds
        || (expectedSeconds > 0 && Math.abs(durationSeconds - expectedSeconds) > durationTolerance)) {
        return { valid: false, reason: 'validation_duration_invalid' };
    }
    if (audioExpected && !audioPresent) return { valid: false, reason: 'validation_audio_missing' };
    return {
        valid: true,
        sizeBytes,
        durationSeconds,
        fps,
        videoCodec: 'h264',
        audioCodec: audioPresent ? 'detected' : null,
        audioPresent,
        formatName: 'mp4',
        validationTool: 'ffmpeg',
    };
}

function resolveFfprobeCommand(ffmpegCommand) {
    const parsed = path.parse(normalizeString(ffmpegCommand));
    if (!parsed.dir) return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    const probeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    const adjacent = path.join(parsed.dir, probeName);
    return existsSync(adjacent) ? adjacent : probeName;
}

function buildFfmpegArgs(job) {
    const expectedDurationSeconds = formatDurationSeconds(job.expectedDurationMs);
    const args = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-y',
        '-f', 'rawvideo',
        '-pixel_format', 'rgba',
        '-video_size', `${job.width}x${job.height}`,
        '-framerate', String(job.fps),
        '-i', 'pipe:0',
    ];
    if (job.audioPath) {
        args.push('-i', job.audioPath, '-map', '0:v:0', '-map', '1:a:0?');
    } else {
        args.push('-map', '0:v:0');
    }
    args.push(
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-r', String(job.fps),
        '-fps_mode', 'cfr',
        '-video_track_timescale', '60000',
        '-movflags', '+faststart',
        '-metadata', 'encoder=CurviosClash Cinematic Replay',
        '-metadata', `comment=match:${job.matchId}`
    );
    if (job.audioPath) {
        // The replay timeline is authoritative. MediaRecorder audio may start late
        // or contain less wall-clock time than the deterministic replay. Pad short
        // audio and cap long audio instead of truncating the video via -shortest.
        args.push('-af', 'apad', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000');
        if (expectedDurationSeconds) {
            args.push('-t', expectedDurationSeconds);
        }
    } else {
        args.push('-an');
    }
    args.push('-f', 'mp4', job.tempVideoPath);
    return args;
}

function waitForChildClose(child) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        child.once('error', (error) => finish({
            ok: false,
            code: null,
            signal: null,
            errorCode: normalizeString(error?.code, 'spawn_failed'),
            errorMessage: normalizeString(error?.message, 'spawn_failed'),
        }));
        child.once('close', (code, signal) => finish({
            ok: code === 0,
            code,
            signal: signal || null,
            errorCode: code === 0 ? null : 'ffmpeg_non_zero_exit',
            errorMessage: code === 0 ? null : `ffmpeg_exit_${code}`,
        }));
    });
}

async function writeStdin(child, bytes) {
    return new Promise((resolve, reject) => {
        const stream = child?.stdin;
        if (!stream || stream.destroyed || stream.writableEnded) {
            reject(new Error('encoder_input_closed'));
            return;
        }
        const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let settled = false;
        const finish = (error = null) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error) reject(error);
            else resolve();
        };
        const onError = (error) => {
            finish(error);
        };
        const cleanup = () => {
            stream.off('error', onError);
        };
        stream.once('error', onError);
        try {
            stream.write(buffer, (error) => finish(error || null));
        } catch (error) {
            finish(error);
        }
    });
}

async function validateMp4({
    ffprobeCommand,
    ffmpegCommand = null,
    filePath,
    width,
    height,
    fps,
    expectedDurationMs,
    audioExpected,
}) {
    const stat = await fsPromises.stat(filePath);
    if (!stat.isFile() || stat.size < MIN_VALID_MP4_BYTES) {
        return { valid: false, reason: 'validation_size_invalid', sizeBytes: stat.size };
    }
    const handle = await fsPromises.open(filePath, 'r');
    let moovFound = false;
    try {
        const header = Buffer.alloc(Math.min(stat.size, 1024 * 1024));
        const readResult = await handle.read(header, 0, header.length, 0);
        moovFound = header.subarray(0, readResult.bytesRead).indexOf(Buffer.from('moov')) >= 0;
    } finally {
        await handle.close();
    }
    if (!moovFound) {
        return { valid: false, reason: 'validation_moov_missing', sizeBytes: stat.size };
    }
    const probe = await executeProcess(ffprobeCommand, [
        '-v', 'error',
        '-show_entries',
        'format=format_name,duration:stream=index,codec_type,codec_name,width,height,avg_frame_rate,r_frame_rate,duration',
        '-of', 'json',
        filePath,
    ], 30000);
    if (!probe.ok) {
        return validateMp4WithFfmpeg({
            ffmpegCommand,
            filePath,
            width,
            height,
            fps,
            expectedDurationMs,
            audioExpected,
            sizeBytes: stat.size,
        });
    }
    let parsed;
    try {
        parsed = JSON.parse(probe.stdout);
    } catch {
        return { valid: false, reason: 'validation_probe_json_invalid' };
    }
    const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
    const video = streams.find((stream) => stream?.codec_type === 'video') || null;
    const audio = streams.find((stream) => stream?.codec_type === 'audio') || null;
    const actualFps = parseFrameRate(video?.avg_frame_rate || video?.r_frame_rate);
    const durationSeconds = Number(parsed?.format?.duration || video?.duration);
    const expectedSeconds = Math.max(0, Number(expectedDurationMs) || 0) / 1000;
    const durationTolerance = Math.max(1, expectedSeconds * 0.08);
    const formatName = String(parsed?.format?.format_name || '').toLowerCase();
    if (!video || video.codec_name !== 'h264') {
        return { valid: false, reason: 'validation_codec_invalid', probe: parsed };
    }
    if (Number(video.width) !== width || Number(video.height) !== height) {
        return { valid: false, reason: 'validation_resolution_invalid', probe: parsed };
    }
    if (Math.abs(actualFps - fps) > 0.01) {
        return { valid: false, reason: 'validation_framerate_invalid', probe: parsed };
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0
        || (expectedSeconds > 0 && Math.abs(durationSeconds - expectedSeconds) > durationTolerance)) {
        return { valid: false, reason: 'validation_duration_invalid', probe: parsed };
    }
    if (!formatName.includes('mp4') && !formatName.includes('mov')) {
        return { valid: false, reason: 'validation_container_invalid', probe: parsed };
    }
    if (audioExpected && !audio) {
        return { valid: false, reason: 'validation_audio_missing', probe: parsed };
    }
    return {
        valid: true,
        sizeBytes: stat.size,
        durationSeconds,
        fps: actualFps,
        videoCodec: video.codec_name,
        audioCodec: audio?.codec_name || null,
        audioPresent: !!audio,
        formatName,
        validationTool: 'ffprobe',
    };
}

function createCinematicReplayVideoExportJob({
    app,
    dialog,
    resolveWindow = () => null,
    spawnProcess = spawn,
    probeCapability = probeNativeTranscodeCapability,
    executeCommand = executeProcess,
    now = () => Date.now(),
} = {}) {
    const jobs = new Map();
    let activeExportId = null;

    const resolveTempRoot = () => path.join(app.getPath('temp'), TEMP_DIRECTORY_NAME);

    async function cleanupJobFiles(job, { keepVideo = false } = {}) {
        const paths = [
            keepVideo ? null : job?.tempVideoPath,
            job?.audioPath,
            job?.manifestPath,
        ].filter(Boolean);
        await Promise.allSettled(paths.map((filePath) => fsPromises.rm(filePath, { force: true })));
    }

    async function writeManifest(job) {
        await fsPromises.writeFile(job.manifestPath, JSON.stringify({
            contractVersion: CONTRACT_VERSION,
            exportId: job.exportId,
            matchId: job.matchId,
            targetPath: job.targetPath,
            tempVideoPath: job.tempVideoPath,
            audioPath: job.audioPath,
            width: job.width,
            height: job.height,
            fps: job.fps,
            expectedDurationMs: job.expectedDurationMs,
            audioExpected: job.audioExpected,
            startedAt: job.startedAt,
        }, null, 2), 'utf8');
    }

    async function begin(payload = null) {
        if (activeExportId) {
            return { started: false, reason: 'export_already_running', exportId: activeExportId };
        }
        const request = payload && typeof payload === 'object' ? payload : {};
        const width = normalizePositiveInt(request.width, 1920, 16, 8192);
        const height = normalizePositiveInt(request.height, 1080, 16, 8192);
        const fps = normalizePositiveInt(request.fps, CINEMATIC_EXPORT_FPS, 1, 240);
        const formatSupported = SUPPORTED_CINEMATIC_FORMATS.some(
            (format) => format.width === width && format.height === height
        );
        if (!formatSupported || fps !== CINEMATIC_EXPORT_FPS) {
            return { started: false, reason: 'invalid_cinematic_format' };
        }
        const matchId = sanitizeToken(request.matchId, `match-${now()}`);
        const fileName = `${sanitizeToken(path.parse(request.fileName || `curvios-cinematic-${matchId}`).name)}.mp4`;
        const defaultPath = path.join(app.getPath('videos'), fileName);
        const dialogResult = await dialog.showSaveDialog(resolveWindow(), {
            title: 'Cinematic Replay Render speichern',
            defaultPath,
            filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
            properties: ['showOverwriteConfirmation'],
        });
        if (dialogResult?.canceled || !dialogResult?.filePath) {
            return { started: false, cancelled: true, code: 'RECORDING_SAVE_CANCELLED', reason: 'cancelled' };
        }
        const capability = await probeCapability();
        if (capability?.available !== true || !capability?.command) {
            return {
                started: false,
                reason: 'ffmpeg_encoder_unavailable',
                code: 'RECORDING_ENCODER_UNAVAILABLE',
                capability,
            };
        }
        const encoderProbe = await executeCommand(
            capability.command,
            ['-hide_banner', '-encoders'],
            10000
        );
        if (!encoderProbe.ok || !/\blibx264\b/.test(`${encoderProbe.stdout}\n${encoderProbe.stderr}`)) {
            return {
                started: false,
                reason: 'libx264_encoder_unavailable',
                code: 'RECORDING_H264_ENCODER_UNAVAILABLE',
                capability,
            };
        }

        const tempRoot = resolveTempRoot();
        await fsPromises.mkdir(tempRoot, { recursive: true });
        const exportId = `${matchId}-${process.pid}-${now()}-${Math.random().toString(16).slice(2)}`;
        const targetPath = path.extname(dialogResult.filePath).toLowerCase() === '.mp4'
            ? dialogResult.filePath
            : `${dialogResult.filePath}.mp4`;
        const audioBytes = toUint8Array(request.audioBytes);
        const audioExtension = String(request.audioMimeType || '').includes('ogg') ? '.ogg' : '.webm';
        const job = {
            exportId,
            matchId,
            targetPath,
            tempVideoPath: path.join(
                path.dirname(targetPath),
                `.curvios-recording-export-${exportId}.tmp.mp4`
            ),
            audioPath: audioBytes.byteLength > 0 ? path.join(tempRoot, `${exportId}.audio${audioExtension}`) : null,
            manifestPath: path.join(tempRoot, `${exportId}${MANIFEST_SUFFIX}`),
            width,
            height,
            fps,
            expectedDurationMs: Math.max(0, Number(request.expectedDurationMs) || 0),
            frameSize: width * height * 4,
            frameCount: 0,
            audioExpected: request.audioExpected === true && audioBytes.byteLength > 0,
            audioWarning: normalizeString(request.audioWarning) || null,
            ffmpegCommand: capability.command,
            ffprobeCommand: resolveFfprobeCommand(capability.command),
            capability,
            child: null,
            closePromise: null,
            stderr: '',
            cancelled: false,
            startedAt: now(),
        };
        if (job.audioPath) {
            await fsPromises.writeFile(job.audioPath, Buffer.from(
                audioBytes.buffer,
                audioBytes.byteOffset,
                audioBytes.byteLength
            ));
        }
        await writeManifest(job);
        try {
            job.child = spawnProcess(job.ffmpegCommand, buildFfmpegArgs(job), {
                windowsHide: true,
                stdio: ['pipe', 'ignore', 'pipe'],
            });
            job.child.stderr?.on('data', (chunk) => {
                job.stderr = `${job.stderr}${String(chunk || '')}`.slice(-MAX_DIAGNOSTIC_LENGTH);
            });
            // A child that exits early can emit EPIPE on stdin independently of
            // the write callback. Keep the stream error observed for the entire
            // job so it can never terminate the Electron main process unhandled.
            job.child.stdin?.on('error', (error) => {
                job.stdinError = normalizeString(error?.message, 'encoder_input_closed');
            });
            job.closePromise = waitForChildClose(job.child);
        } catch (error) {
            await cleanupJobFiles(job);
            return {
                started: false,
                reason: 'ffmpeg_spawn_failed',
                code: normalizeString(error?.code, 'RECORDING_ENCODER_SPAWN_FAILED'),
            };
        }
        jobs.set(exportId, job);
        activeExportId = exportId;
        return {
            started: true,
            exportId,
            width,
            height,
            fps,
            audioIncluded: !!job.audioPath,
            warnings: job.audioPath ? [] : [job.audioWarning || 'audio_capture_unavailable'],
        };
    }

    async function appendFrame(payload = null) {
        const request = payload && typeof payload === 'object' ? payload : {};
        const job = jobs.get(normalizeString(request.exportId));
        if (!job || job.cancelled) return { accepted: false, reason: 'export_not_active' };
        const frameBytes = toUint8Array(request.frameBytes);
        if (frameBytes.byteLength !== job.frameSize) {
            return {
                accepted: false,
                reason: 'frame_size_invalid',
                expectedBytes: job.frameSize,
                actualBytes: frameBytes.byteLength,
            };
        }
        if (Number(request.frameIndex) !== job.frameCount) {
            return { accepted: false, reason: 'frame_index_invalid', expectedFrameIndex: job.frameCount };
        }
        try {
            await writeStdin(job.child, frameBytes);
            job.frameCount++;
            return { accepted: true, frameCount: job.frameCount };
        } catch (error) {
            return {
                accepted: false,
                reason: normalizeString(error?.message, 'encoder_write_failed'),
            };
        }
    }

    async function finish(payload = null) {
        const request = payload && typeof payload === 'object' ? payload : {};
        const exportId = normalizeString(request.exportId);
        const job = jobs.get(exportId);
        if (!job || job.cancelled) return { saved: false, reason: 'export_not_active' };
        if (Number(request.frameCount) !== job.frameCount || job.frameCount <= 0) {
            return { saved: false, reason: 'frame_count_invalid' };
        }
        job.child.stdin.end();
        const closeResult = await job.closePromise;
        if (!closeResult.ok || job.cancelled) {
            await cleanupJobFiles(job);
            jobs.delete(exportId);
            activeExportId = activeExportId === exportId ? null : activeExportId;
            return {
                saved: false,
                reason: job.cancelled ? 'cancelled' : 'ffmpeg_encode_failed',
                code: closeResult.errorCode,
                diagnostics: job.stderr.slice(-4000),
            };
        }
        const validation = await validateMp4({
            ffprobeCommand: job.ffprobeCommand,
            ffmpegCommand: job.ffmpegCommand,
            filePath: job.tempVideoPath,
            width: job.width,
            height: job.height,
            fps: job.fps,
            expectedDurationMs: Number(request.expectedDurationMs) || job.expectedDurationMs,
            audioExpected: job.audioExpected,
        });
        if (!validation.valid) {
            await cleanupJobFiles(job);
            jobs.delete(exportId);
            activeExportId = activeExportId === exportId ? null : activeExportId;
            return { saved: false, reason: validation.reason, validation };
        }
        try {
            await fsPromises.mkdir(path.dirname(job.targetPath), { recursive: true });
            await fsPromises.rename(job.tempVideoPath, job.targetPath);
        } catch (error) {
            await cleanupJobFiles(job);
            jobs.delete(exportId);
            activeExportId = activeExportId === exportId ? null : activeExportId;
            return {
                saved: false,
                reason: 'atomic_publish_failed',
                code: normalizeString(error?.code, 'RECORDING_SAVE_FINALIZE_FAILED'),
            };
        }
        const warnings = job.audioPath ? [] : [job.audioWarning || 'audio_capture_unavailable'];
        await cleanupJobFiles(job, { keepVideo: true });
        jobs.delete(exportId);
        activeExportId = activeExportId === exportId ? null : activeExportId;
        return {
            saved: true,
            code: 'RECORDING_SAVE_OK',
            exportId,
            filePath: job.targetPath,
            fileName: path.basename(job.targetPath),
            container: 'mp4',
            codec: 'h264',
            width: job.width,
            height: job.height,
            fps: job.fps,
            frameCount: job.frameCount,
            audioIncluded: validation.audioPresent,
            warnings,
            validation,
        };
    }

    async function cancel(payload = null) {
        const exportId = normalizeString(payload?.exportId, activeExportId || '');
        const job = jobs.get(exportId);
        if (!job) return { cancelled: false, reason: 'export_not_active' };
        job.cancelled = true;
        try {
            job.child?.stdin?.destroy?.();
        } catch {
            // The process tree is terminated below.
        }
        terminateChildProcess(job.child);
        await Promise.race([
            job.closePromise,
            new Promise((resolve) => setTimeout(resolve, 2500)),
        ]);
        await cleanupJobFiles(job);
        jobs.delete(exportId);
        activeExportId = activeExportId === exportId ? null : activeExportId;
        return { cancelled: true, exportId };
    }

    async function listOrphans() {
        const tempRoot = resolveTempRoot();
        let entries = [];
        try {
            entries = await fsPromises.readdir(tempRoot, { withFileTypes: true });
        } catch (error) {
            if (error?.code === 'ENOENT') return [];
            throw error;
        }
        const orphans = [];
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith(MANIFEST_SUFFIX)) continue;
            const manifestPath = path.join(tempRoot, entry.name);
            try {
                const manifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
                if (jobs.has(manifest?.exportId)) continue;
                orphans.push({
                    ...manifest,
                    manifestPath,
                    videoExists: existsSync(manifest?.tempVideoPath || ''),
                    detectedAt: now(),
                });
            } catch {
                orphans.push({
                    manifestPath,
                    invalidManifest: true,
                    detectedAt: now(),
                });
            }
        }
        return orphans;
    }

    async function cleanupOrphans(orphanList = []) {
        const tempRoot = path.resolve(resolveTempRoot());
        let removed = 0;
        for (const orphan of Array.isArray(orphanList) ? orphanList : []) {
            const candidates = [
                orphan?.tempVideoPath,
                orphan?.audioPath,
                orphan?.manifestPath,
            ];
            for (const candidate of candidates) {
                const resolved = path.resolve(normalizeString(candidate));
                const isOwnedTempRootFile = resolved.startsWith(`${tempRoot}${path.sep}`);
                const baseName = path.basename(resolved);
                const isOwnedDeliveryTemp = baseName.startsWith('.curvios-recording-export-')
                    && baseName.endsWith('.tmp.mp4');
                if (!isOwnedTempRootFile && !isOwnedDeliveryTemp) continue;
                await fsPromises.rm(resolved, { force: true }).catch(() => {});
                removed++;
            }
        }
        return { cleaned: true, removed };
    }

    async function recoverOrphans(orphanList = []) {
        const capability = await probeCapability();
        const results = [];
        for (const orphan of Array.isArray(orphanList) ? orphanList : []) {
            if (!orphan?.videoExists || !normalizeString(orphan?.tempVideoPath)
                || !normalizeString(orphan?.targetPath)) {
                results.push({ recovered: false, reason: 'orphan_video_missing' });
                continue;
            }
            if (existsSync(orphan.targetPath)) {
                results.push({
                    recovered: false,
                    reason: 'target_already_exists',
                    targetPath: orphan.targetPath,
                });
                continue;
            }
            const validation = await validateMp4({
                ffprobeCommand: resolveFfprobeCommand(capability?.command),
                ffmpegCommand: capability?.command,
                filePath: orphan.tempVideoPath,
                width: Number(orphan.width) || 1920,
                height: Number(orphan.height) || 1080,
                fps: Number(orphan.fps) || 60,
                expectedDurationMs: Number(orphan.expectedDurationMs) || 0,
                audioExpected: orphan.audioExpected === true,
            });
            if (!validation.valid) {
                results.push({
                    recovered: false,
                    reason: validation.reason,
                    targetPath: orphan.targetPath,
                });
                continue;
            }
            try {
                await fsPromises.rename(orphan.tempVideoPath, orphan.targetPath);
                await Promise.allSettled([
                    orphan.audioPath ? fsPromises.rm(orphan.audioPath, { force: true }) : null,
                    orphan.manifestPath ? fsPromises.rm(orphan.manifestPath, { force: true }) : null,
                ].filter(Boolean));
                results.push({
                    recovered: true,
                    targetPath: orphan.targetPath,
                    validation,
                });
            } catch (error) {
                results.push({
                    recovered: false,
                    reason: 'orphan_publish_failed',
                    code: normalizeString(error?.code),
                    targetPath: orphan.targetPath,
                });
            }
        }
        return {
            recovered: results.filter((entry) => entry.recovered).length,
            failed: results.filter((entry) => !entry.recovered).length,
            results,
        };
    }

    function getStatus() {
        const job = activeExportId ? jobs.get(activeExportId) : null;
        return {
            active: !!job,
            exportId: job?.exportId || null,
            matchId: job?.matchId || null,
            frameCount: job?.frameCount || 0,
            startedAt: job?.startedAt || null,
        };
    }

    async function settle() {
        const job = activeExportId ? jobs.get(activeExportId) : null;
        if (!job) return { settled: true, active: false };
        const result = await job.closePromise;
        return { settled: true, active: false, result };
    }

    return Object.freeze({
        begin,
        appendFrame,
        finish,
        cancel,
        listOrphans,
        cleanupOrphans,
        recoverOrphans,
        getStatus,
        settle,
    });
}

module.exports = Object.freeze({
    CONTRACT_VERSION,
    createCinematicReplayVideoExportJob,
    parseFrameRate,
    resolveFfprobeCommand,
    validateMp4,
});

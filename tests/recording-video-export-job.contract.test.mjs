import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
    buildRecordingVideoTempPath,
    createRecordingVideoExportJob,
    createUnavailableNativeTranscodeCapability,
    resolveRecordingVideoExportTranscodeIntent,
    resolveRecordingVideoSaveCapabilityStatus,
} = require('../electron/recording-video-export-job.cjs');

function createVideoExportJobFixture(t, overrides = {}) {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curvios-recording-export-job-'));
    t.after(() => {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
    });
    const job = createRecordingVideoExportJob({
        app: {
            getPath() {
                return fixtureDir;
            },
        },
        dialog: {
            async showSaveDialog() {
                return {
                    canceled: false,
                    filePath: path.join(fixtureDir, 'cinematic-export'),
                };
            },
        },
        resolveWindow: () => null,
        ...overrides,
    });
    return {
        fixtureDir,
        job,
    };
}

function createVideoExportRequestPayload(videoBytes) {
    return {
        contractVersion: 'recording-video-export-request.v1',
        capabilityId: 'recording-video-export-save',
        runtimeKind: 'desktop',
        fileName: 'cinematic-export.webm',
        mimeType: 'video/webm',
        masterContainer: 'webm',
        deliveryContainer: 'mp4',
        transcodeRequested: true,
        videoBytes,
    };
}

test('recording-video-export transcode intent resolves desktop webm->mp4 pair', () => {
    const intent = resolveRecordingVideoExportTranscodeIntent({
        masterContainer: 'webm',
        deliveryContainer: 'mp4',
        transcodeRequested: true,
    });

    assert.equal(intent.requested, true);
    assert.equal(intent.supportedPair, true);
    assert.equal(intent.masterContainer, 'webm');
    assert.equal(intent.deliveryContainer, 'mp4');
});

test('recording-video-export transcode status reports unsupported pair explicitly', async () => {
    const status = await resolveRecordingVideoSaveCapabilityStatus(
        {
            masterContainer: 'mp4',
            deliveryContainer: 'webm',
            transcodeRequested: true,
        },
        () => Promise.resolve(createUnavailableNativeTranscodeCapability())
    );

    assert.equal(status.available, false);
    assert.equal(status.statusCode, 'unsupported_pair');
    assert.match(status.errorMessage || '', /mp4_to_webm/);
});

test('recording-video-export transcode status delegates to native capability probe for supported pair', async () => {
    const status = await resolveRecordingVideoSaveCapabilityStatus(
        {
            masterContainer: 'webm',
            deliveryContainer: 'mp4',
            transcodeRequested: true,
        },
        () => Promise.resolve({
            tool: 'ffmpeg',
            available: true,
            statusCode: 'ready',
            source: 'test-double',
            binaryPath: '/tmp/ffmpeg',
            command: '/tmp/ffmpeg',
            version: 'ffmpeg version test',
            errorCode: null,
            errorMessage: null,
            checkedAt: 0,
        })
    );

    assert.equal(status.available, true);
    assert.equal(status.statusCode, 'ready');
    assert.equal(status.source, 'test-double');
});

test('recording-video-export temp path keeps container extension for transcoder output format detection', () => {
    const sourcePath = path.join('tmp', 'export', 'clip.mp4');
    const tempPath = buildRecordingVideoTempPath(sourcePath, 'delivery');

    assert.equal(path.extname(tempPath), '.mp4');
    assert.equal(tempPath.includes('.tmp.mp4'), true);
});

test('recording-video-export job writes native mp4 delivery when transcode succeeds', async (t) => {
    const readyCapability = {
        tool: 'ffmpeg',
        available: true,
        statusCode: 'ready',
        source: 'test-double',
        command: 'test-ffmpeg',
    };
    const { job } = createVideoExportJobFixture(t, {
        resolveNativeTranscodeCapability: async () => readyCapability,
        executeNativeTranscode: async ({ sourcePath, targetPath }) => {
            await fs.promises.copyFile(sourcePath, targetPath);
            return { ok: true, transcodeFailureCode: null, message: null };
        },
    });
    const capability = await job.getCapabilityStatus({
        transcodeRequested: true,
        masterContainer: 'webm',
        deliveryContainer: 'mp4',
        forceRefresh: true,
    });
    assert.equal(capability.available, true);
    const result = await job.handle(createVideoExportRequestPayload(new Uint8Array([1, 2, 3, 4])));

    assert.equal(result.saved, true);
    assert.equal(result.code, 'RECORDING_SAVE_OK');
    assert.equal(result.transcodeApplied, true);
    assert.equal(result.deliveryContainer, 'mp4');
    assert.match(String(result.deliveryPath || ''), /\.mp4$/i);
    assert.equal(fs.existsSync(result.deliveryPath), true);
});

test('recording-video-export job degrades to master artifact when native transcode fails', async (t) => {
    const { job } = createVideoExportJobFixture(t, {
        resolveNativeTranscodeCapability: async () => ({
            tool: 'ffmpeg',
            available: true,
            statusCode: 'ready',
            source: 'test-double',
            command: 'test-ffmpeg',
        }),
        executeNativeTranscode: async () => ({
            ok: false,
            transcodeFailureCode: 'test_transcode_failure',
            message: 'deterministic test failure',
        }),
    });
    const capability = await job.getCapabilityStatus({
        transcodeRequested: true,
        masterContainer: 'webm',
        deliveryContainer: 'mp4',
        forceRefresh: true,
    });
    assert.equal(capability.available, true);

    const result = await job.handle(createVideoExportRequestPayload(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])));

    assert.equal(result.saved, true);
    assert.equal(result.code, 'RECORDING_SAVE_OK_MASTER_FALLBACK');
    assert.equal(result.transcodeApplied, false);
    assert.equal(result.deliveryContainer, 'webm');
    assert.match(String(result.masterPath || ''), /\.webm$/i);
    assert.equal(fs.existsSync(result.masterPath), true);
    assert.ok(
        Array.isArray(result.warnings)
        && result.warnings.includes('native_transcode_failed_master_retained')
    );
});


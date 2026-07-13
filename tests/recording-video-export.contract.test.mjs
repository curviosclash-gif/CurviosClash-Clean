import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createRecordingVideoExportRequest,
    RECORDING_EXPORT_PROFILE_VARIANTS,
    resolveRecordingExportProfileVariant,
} from '../src/core/recording/RecordingVideoExportContract.js';
import {
    RECORDING_CAPTURE_PROFILE,
    RECORDING_EXPORT_PRESET,
} from '../src/shared/contracts/RecordingCaptureContract.js';

test('recording-video-export request keeps master container separate from youtube-mp4 delivery preset', () => {
    const request = createRecordingVideoExportRequest({
        runtimeKind: 'desktop',
        captureProfile: RECORDING_CAPTURE_PROFILE.CINEMATIC,
        mimeType: 'video/webm;codecs=vp9',
        fileName: 'clip.webm',
    });

    assert.equal(request.captureProfile, RECORDING_CAPTURE_PROFILE.CINEMATIC);
    assert.equal(request.exportPreset, RECORDING_EXPORT_PRESET.YOUTUBE_MP4);
    assert.equal(request.masterContainer, 'webm');
    assert.equal(request.deliveryContainer, 'mp4');
    assert.equal(request.container, request.masterContainer);
    assert.equal(request.transcodeRequested, true);
    assert.equal(request.transcodeApplied, false);
});

test('recording-video-export request supports explicit master-only preset', () => {
    const request = createRecordingVideoExportRequest({
        runtimeKind: 'desktop',
        captureProfile: RECORDING_CAPTURE_PROFILE.STANDARD,
        exportPreset: RECORDING_EXPORT_PRESET.MASTER,
        masterContainer: 'webm',
        mimeType: 'video/webm',
        fileName: 'clip.webm',
    });

    assert.equal(request.exportPreset, RECORDING_EXPORT_PRESET.MASTER);
    assert.equal(request.masterContainer, 'webm');
    assert.equal(request.deliveryContainer, 'webm');
    assert.equal(request.transcodeRequested, false);
});

test('recording export profile variant resolves legacy cinematic alias to cinematic variant', () => {
    const variant = resolveRecordingExportProfileVariant(RECORDING_CAPTURE_PROFILE.CINEMATIC_MP4);
    assert.equal(variant, RECORDING_EXPORT_PROFILE_VARIANTS.CINEMATIC);
});

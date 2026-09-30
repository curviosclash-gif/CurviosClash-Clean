import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { RecordingCapturePipeline } from '../src/core/renderer/RecordingCapturePipeline.js';

test('recording stores bloom quality for its dedicated cinematic renderer', () => {
    const pipeline = new RecordingCapturePipeline({});
    pipeline.setBloomQuality(2);
    assert.equal(pipeline._bloomPreset.id, 'high');
    assert.equal(pipeline._bloomPreset.enabled, true);
    pipeline.dispose();
});

test('cinematic capture uses post-processing while shorts stays on its split direct path', () => {
    const source = readFileSync('src/core/renderer/RecordingCapturePipeline.js', 'utf8');
    assert.match(source, /renderCaptureView\(this, cinRenderer, camera, [^)]*this\._cinematicPostProcessingPipeline\)/);
    assert.match(
        readFileSync('src/core/renderer/RecordingCaptureViewOps.js', 'utf8'),
        /postProcessing\?\.render\?\.\(pipeline\.scene, camera\)/
    );
    assert.doesNotMatch(source, /_shortsPostProcessingPipeline/);
    assert.doesNotMatch(source, /renderCaptureView\(this, shortsRenderer, [^)]*PostProcessing/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('jitter benchmark can explicitly measure bloom instead of the default OFF path', () => {
    const source = readFileSync('scripts/perf-jitter-matrix.mjs', 'utf8');
    assert.match(source, /PERF_RUCKLER_BLOOM_QUALITY/);
    assert.match(source, /setBloomQuality\?\.\(bloomQuality\)/);
    assert.match(source, /bloomQuality: BLOOM_QUALITY/);
    assert.match(source, /PERF_RUCKLER_FORCE_HIGH_QUALITY/);
    assert.match(source, /setRecordingQualityLock\?\.\(forceHighQuality, 'perf-jitter'\)/);
});

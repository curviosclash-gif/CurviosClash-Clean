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

test('jitter benchmark exposes an opt-in failing acceptance gate', () => {
    const source = readFileSync('scripts/perf-jitter-matrix.mjs', 'utf8');
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    assert.match(source, /process\.argv\.includes\('--enforce'\)/);
    assert.match(source, /PERF_JITTER_ENFORCE/);
    assert.match(source, /ENFORCE_ACCEPTANCE && !summary\.benchmarkPass/);
    assert.equal(manifest.scripts['benchmark:jitter:gate'], 'node scripts/perf-jitter-matrix.mjs --enforce');
});

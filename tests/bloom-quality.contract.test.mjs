import assert from 'node:assert/strict';
import test from 'node:test';

import {
    BLOOM_QUALITY_LEVELS,
    DEFAULT_BLOOM_QUALITY,
    normalizeBloomQuality,
    resolveBloomQualityLabel,
    resolveBloomQualityPreset,
} from '../src/shared/contracts/BloomQualityContract.js';

test('bloom is opt-in and exposes stable off, low and high presets', () => {
    assert.equal(DEFAULT_BLOOM_QUALITY, BLOOM_QUALITY_LEVELS.OFF);
    assert.deepEqual(Object.values(BLOOM_QUALITY_LEVELS), [0, 1, 2]);

    const off = resolveBloomQualityPreset(BLOOM_QUALITY_LEVELS.OFF);
    const low = resolveBloomQualityPreset(BLOOM_QUALITY_LEVELS.LOW);
    const high = resolveBloomQualityPreset(BLOOM_QUALITY_LEVELS.HIGH);

    assert.equal(off.enabled, false);
    assert.equal(off.strength, 0);
    assert.equal(low.enabled, true);
    assert.ok(high.strength > low.strength);
    assert.ok(high.radius > low.radius);
    assert.ok(low.threshold >= 1, 'the bloom threshold must not wash out ordinary LDR materials');
    assert.ok(high.threshold >= 1, 'the bloom threshold must not wash out ordinary LDR materials');
});

test('bloom quality normalization and labels follow the shadow-quality contract shape', () => {
    assert.equal(normalizeBloomQuality('1'), BLOOM_QUALITY_LEVELS.LOW);
    assert.equal(normalizeBloomQuality(2.9), BLOOM_QUALITY_LEVELS.HIGH);
    assert.equal(normalizeBloomQuality('invalid'), DEFAULT_BLOOM_QUALITY);
    assert.equal(normalizeBloomQuality(99, BLOOM_QUALITY_LEVELS.LOW), BLOOM_QUALITY_LEVELS.LOW);
    assert.equal(resolveBloomQualityLabel(BLOOM_QUALITY_LEVELS.OFF), 'Aus');
    assert.equal(resolveBloomQualityLabel(BLOOM_QUALITY_LEVELS.HIGH), 'Hoch');
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_GRAPHICS_QUALITY_SETTING,
    GRAPHICS_AUTO_VERDICTS,
    normalizeGraphicsAutoProfile,
    normalizeGraphicsQualityLevel,
    normalizeGraphicsQualitySetting,
    resolveGraphicsQualitySettingLabel,
} from '../src/shared/contracts/GraphicsQualityContract.js';

test('graphics quality setting defaults to auto and accepts every level case-insensitively', () => {
    assert.equal(DEFAULT_GRAPHICS_QUALITY_SETTING, 'auto');
    assert.equal(normalizeGraphicsQualitySetting(undefined), 'auto');
    assert.equal(normalizeGraphicsQualitySetting('AUTO'), 'auto');
    assert.equal(normalizeGraphicsQualitySetting('ultra'), 'ULTRA');
    assert.equal(normalizeGraphicsQualitySetting(' low '), 'LOW');
    assert.equal(normalizeGraphicsQualitySetting('insane'), 'auto');
    assert.equal(resolveGraphicsQualitySettingLabel('ULTRA'), 'Sehr hoch');
    assert.equal(resolveGraphicsQualitySettingLabel('bogus'), 'Automatisch');
});

test('graphics quality level falls back to HIGH for unknown values', () => {
    assert.equal(normalizeGraphicsQualityLevel('medium'), 'MEDIUM');
    assert.equal(normalizeGraphicsQualityLevel('auto'), 'HIGH');
    assert.equal(normalizeGraphicsQualityLevel(null, 'LOW'), 'LOW');
    assert.equal(normalizeGraphicsQualityLevel(null, 'nope'), 'HIGH');
});

test('graphics auto profile survives corrupt storage records', () => {
    assert.deepEqual(normalizeGraphicsAutoProfile(null), {
        version: 1, gpuKey: '', verdict: GRAPHICS_AUTO_VERDICTS.UNKNOWN, downgrades: 0, supersample: false,
    });
    assert.deepEqual(normalizeGraphicsAutoProfile({
        gpuKey: ' ANGLE (NVIDIA, RTX 3070) ', verdict: 'ultra', downgrades: '1', supersample: true,
    }), {
        version: 1, gpuKey: 'ANGLE (NVIDIA, RTX 3070)', verdict: 'ultra', downgrades: 1, supersample: true,
    });
    const junk = normalizeGraphicsAutoProfile({ verdict: 'maybe', downgrades: -3, supersample: 'yes' });
    assert.equal(junk.verdict, 'unknown');
    assert.equal(junk.downgrades, 0);
    assert.equal(junk.supersample, false);
});

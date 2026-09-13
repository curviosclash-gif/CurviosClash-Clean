import { computeDailySeed } from '../src/shared/utils/ArcadeUtils.js';
import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeSettingsSnapshot } from '../src/core/settings/SettingsSanitizerOps.js';
import { createDefaultSettingsSnapshot } from '../src/core/settings/SettingsDefaultsFacade.js';
import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import {
    createDefaultArcadeRunSettings,
    normalizeArcadeRunSettings,
} from '../src/shared/contracts/ArcadeRunSettingsContract.js';

function sanitize(saved) {
    return sanitizeSettingsSnapshot(saved, createDefaultSettingsSnapshot);
}

function savedWithArcade(arcade) {
    const defaults = createDefaultSettingsSnapshot();
    return { ...defaults, arcade };
}

test('the default settings carry an arcade block', () => {
    const defaults = createDefaultSettingsSnapshot();
    assert.ok(defaults.arcade && typeof defaults.arcade === 'object', 'defaults declare settings.arcade');
    assert.equal(defaults.arcade.sectorCount, createDefaultArcadeRunSettings().sectorCount);
    assert.equal(defaults.arcade.dailyChallenge, false);
});

test('a saved arcade block survives sanitizing instead of being dropped', () => {
    const sanitized = sanitize(savedWithArcade({
        sectorCount: 8,
        dailyChallenge: true,
        seed: 4711,
        intermissionSeconds: 14,
    }));
    assert.ok(sanitized.arcade, 'the arcade block is still there');
    assert.equal(sanitized.arcade.sectorCount, 8);
    assert.equal(sanitized.arcade.dailyChallenge, true);
    assert.equal(sanitized.arcade.seed, 4711);
    assert.equal(sanitized.arcade.intermissionSeconds, 14);
});

test('a sanitized arcade block survives a second round trip unchanged', () => {
    const once = sanitize(savedWithArcade({ sectorCount: 12, dailyChallenge: true, seed: 99 }));
    const twice = sanitize(once);
    assert.deepEqual(twice.arcade, once.arcade);
});

test('out of range arcade values are clamped rather than discarded', () => {
    const sanitized = sanitize(savedWithArcade({ sectorCount: 999, intermissionSeconds: -5, maxMultiplier: 0 }));
    assert.equal(sanitized.arcade.sectorCount, 20, 'the sector count clamps to its upper bound');
    assert.equal(sanitized.arcade.intermissionSeconds, 1, 'the intermission clamps to its lower bound');
    assert.equal(sanitized.arcade.maxMultiplier, 1);
});

test('a broken arcade block falls back to the defaults instead of throwing', () => {
    for (const broken of [null, 'nonsense', 42, []]) {
        const sanitized = sanitize(savedWithArcade(broken));
        assert.deepEqual(sanitized.arcade, createDefaultArcadeRunSettings());
    }
});

test('the runtime honours a persisted sector count', () => {
    const settings = sanitize(savedWithArcade({ sectorCount: 8 }));
    settings.localSettings.modePath = 'arcade';
    const runtimeConfig = createRuntimeConfigSnapshot(settings);
    assert.equal(runtimeConfig.arcade.enabled, true);
    assert.equal(runtimeConfig.arcade.sectorCount, 8);
});

test('the runtime keeps the daily flag but resolves today without overwriting the saved seed', () => {
    const settings = sanitize(savedWithArcade({ dailyChallenge: true, seed: 20260810 }));
    settings.localSettings.modePath = 'arcade';
    const runtimeConfig = createRuntimeConfigSnapshot(settings);
    assert.equal(runtimeConfig.arcade.dailyChallenge, true);
    assert.equal(runtimeConfig.arcade.seed, computeDailySeed());
    assert.equal(settings.arcade.seed, 20260810);
});

test('the default seed keeps deriving from map, mode and bot count', () => {
    // The persisted block now always carries a seed, so its default 0 must not be
    // mistaken for a seed the player chose — otherwise every run shares one sequence.
    const base = sanitize(savedWithArcade(createDefaultArcadeRunSettings()));
    base.localSettings.modePath = 'arcade';
    assert.equal(base.arcade.seed, 0, 'the stored default seed is zero');

    const onMaze = createRuntimeConfigSnapshot({ ...base, mapKey: 'maze', numBots: 2 });
    const onStandard = createRuntimeConfigSnapshot({ ...base, mapKey: 'standard', numBots: 2 });
    const onMazeMoreBots = createRuntimeConfigSnapshot({ ...base, mapKey: 'maze', numBots: 4 });

    assert.notEqual(onMaze.arcade.seed, 0, 'a derived seed is used instead of the stored zero');
    assert.notEqual(onMaze.arcade.seed, onStandard.arcade.seed, 'the map still changes the sequence');
    assert.notEqual(onMaze.arcade.seed, onMazeMoreBots.arcade.seed, 'the bot count still changes it');
});

test('the contract normalizer is the single source for the arcade ranges', () => {
    const normalized = normalizeArcadeRunSettings({ sectorCount: 0, comboWindowMs: 1, replayHooksEnabled: false });
    assert.equal(normalized.sectorCount, 1);
    assert.equal(normalized.comboWindowMs, 800);
    assert.equal(normalized.replayHooksEnabled, false);
    assert.deepEqual(normalizeArcadeRunSettings(null), createDefaultArcadeRunSettings());
});

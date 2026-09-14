import assert from 'node:assert/strict';
import test from 'node:test';

import { SettingsManager } from '../src/core/SettingsManager.js';
import {
    collectPrimitiveLeafPaths,
    readPathValue,
    writePathValue,
} from '../src/core/settings/SettingsOverrideMergeOps.js';
import { SETTINGS_LIMITS } from '../src/shared/contracts/SettingsRuntimeContract.js';
import { GAMEPLAY_COCKPIT_CAMERA_ENABLED } from '../src/shared/contracts/CameraModeContract.js';
import { STORAGE_KEYS } from '../src/shared/storage/StorageKeys.js';

import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';

// The sanitizer copies every persisted field by hand. Fields that are forgotten there are
// silently dropped on the next save (see d14a69b "keep the arcade block when settings are
// saved" and 7eaedc9 "keep display theme outside session drafts"). These tests walk every
// primitive leaf of the default snapshot so a forgotten field fails the suite instead of
// only showing up as a lost setting in the running game.

/**
 * Leaves the sanitizer deliberately derives or forces, together with the value it forces.
 * Everything else has to survive a save/load roundtrip untouched.
 */
function createDerivedLeafExpectations(defaults) {
    return new Map([
        // The snapshot always carries the version stamp of the current defaults.
        ['settingsVersion', defaults.settingsVersion],
        // Cockpit camera is a build-wide switch, not a stored preference.
        ['cockpitCamera.PLAYER_1', GAMEPLAY_COCKPIT_CAMERA_ENABLED],
        ['cockpitCamera.PLAYER_2', GAMEPLAY_COCKPIT_CAMERA_ENABLED],
        // Portal beams are hard disabled in the sanitizer.
        ['gameplay.portalBeams', false],
        // Respawn follows localSettings.modePath ('fight' -> true) via the menu rules.
        ['hunt.respawnEnabled', true],
        // Developer mode is switched off while the feature flag or release preview says so.
        ['localSettings.developerModeEnabled', false],
        // The fixed preset lock needs a fixed preset id, which the defaults do not have.
        ['localSettings.fixedPresetLockEnabled', false],
    ]);
}

/**
 * Numeric leaves whose range lives in their own contract instead of SETTINGS_LIMITS.
 * Each value is valid and differs from the default, so it must survive unchanged.
 */
const ALTERNATIVE_NUMBERS = new Map([
    ['cameraPerspective.speedFovIntensity', 1.25],
    ['cameraPerspective.thrusterExhaustIntensity', 1.25],
    ['localSettings.viewDistance', 50],
    ['localSettings.shadowQuality', 1],
    ['localSettings.hud.scale', 1.2],
    ['localSettings.hud.opacity', 0.8],
    ['localSettings.mobileControls.tiltSensitivity', 1.5],
]);

/** String leaves with a known, valid alternative. */
const ALTERNATIVE_STRINGS = new Map([
    ['botDifficulty', 'EASY'],
    ['botPolicyStrategy', 'heuristic'],
    ['mapKey', 'maze'],
    ['vehicles.PLAYER_1', 'aircraft'],
    ['vehicles.PLAYER_2', 'drone'],
    ['localSettings.themeMode', 'hell'],
    ['controls.PLAYER_1.UP', 'KeyT'],
    ['controls.GLOBAL.CINEMATIC_TOGGLE', 'F7'],
]);

function resolveSettingsLimitRule(path) {
    if (path === 'numBots') return SETTINGS_LIMITS.session.numBots;
    if (path === 'winsNeeded') return SETTINGS_LIMITS.session.winsNeeded;
    if (path.startsWith('gameplay.')) return SETTINGS_LIMITS.gameplay[path.slice('gameplay.'.length)] || null;
    if (path.startsWith('botBridge.')) return SETTINGS_LIMITS.botBridge[path.slice('botBridge.'.length)] || null;
    return null;
}

function createAlternativeNumber(path, value) {
    if (ALTERNATIVE_NUMBERS.has(path)) return ALTERNATIVE_NUMBERS.get(path);

    const rule = resolveSettingsLimitRule(path);
    if (rule) {
        const step = rule.integer ? 1 : (rule.max - rule.min) / 8;
        let next = value + step;
        if (next > rule.max) next = value - step;
        if (next < rule.min) next = rule.min;
        return rule.integer ? Math.trunc(next) : Number(next.toFixed(4));
    }
    return Number.isInteger(value) ? value + 1 : Number((value + 0.01).toFixed(4));
}

/**
 * Builds a snapshot where every leaf with a known valid alternative carries a value that
 * differs from the default, plus the map of intended values for the assertions.
 */
function createFullyChangedSnapshot(defaults) {
    const changed = structuredClone(defaults);
    const intended = new Map();

    for (const path of collectPrimitiveLeafPaths(defaults)) {
        const value = readPathValue(defaults, path);
        if (typeof value === 'boolean') {
            writePathValue(changed, path, !value);
            intended.set(path, !value);
            continue;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
            const next = createAlternativeNumber(path, value);
            writePathValue(changed, path, next);
            intended.set(path, next);
            continue;
        }
        if (typeof value === 'string' && ALTERNATIVE_STRINGS.has(path)) {
            const next = ALTERNATIVE_STRINGS.get(path);
            writePathValue(changed, path, next);
            intended.set(path, next);
        }
    }

    return { changed, intended };
}

test('SettingsManager keeps every default leaf path through sanitize, save and load', () => {
    const storagePlatform = createMemoryStoragePlatform();
    const manager = new SettingsManager({ storagePlatform });
    const defaults = manager.createDefaultSettings();
    const leafPaths = collectPrimitiveLeafPaths(defaults);

    assert.ok(leafPaths.length >= 150, `expected a rich default snapshot, got ${leafPaths.length} leaves`);

    const sanitized = manager.sanitizeSettings(defaults);
    for (const path of leafPaths) {
        assert.deepEqual(
            readPathValue(sanitized, path),
            readPathValue(defaults, path),
            `sanitize lost or changed ${path}`
        );
    }

    const saveResult = manager.saveSettings(sanitized);
    const loaded = manager.loadSettings();

    assert.equal(saveResult.success, true);
    assert.deepEqual(collectPrimitiveLeafPaths(loaded), leafPaths);
    assert.deepEqual(loaded, sanitized);
    assert.deepEqual(storagePlatform.getRecord(STORAGE_KEYS.settings), sanitized);
});

test('SettingsManager keeps a fully changed snapshot through sanitize, save and load', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const defaults = manager.createDefaultSettings();
    const derivedLeaves = createDerivedLeafExpectations(defaults);
    const { changed, intended } = createFullyChangedSnapshot(defaults);

    assert.ok(intended.size >= 80, `expected a broad mutation set, got ${intended.size} leaves`);

    const sanitized = manager.sanitizeSettings(changed);
    for (const [path, expectedValue] of intended) {
        if (derivedLeaves.has(path)) {
            assert.deepEqual(
                readPathValue(sanitized, path),
                derivedLeaves.get(path),
                `derived leaf ${path} no longer carries its forced value`
            );
            continue;
        }
        assert.deepEqual(
            readPathValue(sanitized, path),
            expectedValue,
            `sanitize dropped the stored value of ${path}`
        );
    }

    const saveResult = manager.saveSettings(sanitized);
    const loaded = manager.loadSettings();

    assert.equal(saveResult.success, true);
    assert.deepEqual(loaded, sanitized);
    assert.deepEqual(collectPrimitiveLeafPaths(loaded), collectPrimitiveLeafPaths(defaults));
});

test('SettingsManager keeps the arcade block and hunt limits when settings are saved', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const defaults = manager.createDefaultSettings();

    const saved = manager.sanitizeSettings({
        ...structuredClone(defaults),
        arcade: {
            ...defaults.arcade,
            seed: 4242,
            sectorCount: 7,
            dailyChallenge: true,
        },
        hunt: {
            ...defaults.hunt,
            deathmatchKillLimit: 25,
            timeLimitEnabled: false,
        },
    });
    manager.saveSettings(saved);
    const loaded = manager.loadSettings();

    assert.equal(loaded.arcade.seed, 4242);
    assert.equal(loaded.arcade.sectorCount, 7);
    assert.equal(loaded.arcade.dailyChallenge, true);
    assert.equal(loaded.hunt.deathmatchKillLimit, 25);
    assert.equal(loaded.hunt.timeLimitEnabled, false);
});

test('SettingsManager clamps every gameplay field to its declared limit rule', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const belowMinimum = {};
    const aboveMaximum = {};
    for (const [field, rule] of Object.entries(SETTINGS_LIMITS.gameplay)) {
        belowMinimum[field] = rule.min - 1000;
        aboveMaximum[field] = rule.max + 1000;
    }

    const clampedLow = manager.sanitizeSettings({ gameplay: belowMinimum }).gameplay;
    const clampedHigh = manager.sanitizeSettings({ gameplay: aboveMaximum }).gameplay;

    for (const [field, rule] of Object.entries(SETTINGS_LIMITS.gameplay)) {
        assert.equal(clampedLow[field], rule.min, `${field} is not clamped to its minimum`);
        assert.equal(clampedHigh[field], rule.max, `${field} is not clamped to its maximum`);
    }
});

test('SettingsManager clamps the deathmatch kill limit to its contract range', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const defaults = manager.createDefaultSettings();
    const rule = SETTINGS_LIMITS.hunt.deathmatchKillLimit;
    const sanitizeKillLimit = (value) => (
        manager.sanitizeSettings({ hunt: { deathmatchKillLimit: value } }).hunt.deathmatchKillLimit
    );

    assert.equal(sanitizeKillLimit(rule.max + 150), rule.max);
    assert.equal(sanitizeKillLimit(rule.min - 6), rule.min);
    assert.equal(sanitizeKillLimit(0), rule.min);
    assert.equal(sanitizeKillLimit(12.7), 12);
    assert.equal(sanitizeKillLimit('broken'), defaults.hunt.deathmatchKillLimit);
    assert.equal(sanitizeKillLimit(undefined), defaults.hunt.deathmatchKillLimit);
});

test('SettingsManager sanitize is stable when it runs twice on its own output', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const defaults = manager.createDefaultSettings();
    const { changed } = createFullyChangedSnapshot(defaults);

    const once = manager.sanitizeSettings(changed);
    const twice = manager.sanitizeSettings(once);

    assert.deepEqual(twice, once);
});

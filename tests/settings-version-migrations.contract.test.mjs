import assert from 'node:assert/strict';
import test from 'node:test';

import { SettingsManager } from '../src/core/SettingsManager.js';
import {
    SETTINGS_VERSION_MIGRATION_IDS,
    migrateSettingsSnapshot,
} from '../src/core/settings/SettingsVersionMigrations.js';
import { collectPrimitiveLeafPaths } from '../src/core/settings/SettingsOverrideMergeOps.js';

import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';

function createManager() {
    return new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
}

test('settings migration lifts a version-less snapshot to the current version in one pass', () => {
    const manager = createManager();
    const defaults = manager.createDefaultSettings();

    const result = migrateSettingsSnapshot({ mode: '2p' }, defaults);

    assert.equal(result.fromVersion, 0);
    assert.equal(result.targetVersion, defaults.settingsVersion);
    assert.equal(result.reachedVersion, defaults.settingsVersion);
    assert.deepEqual(result.appliedMigrations, [
        SETTINGS_VERSION_MIGRATION_IDS.V0_TO_V1,
        SETTINGS_VERSION_MIGRATION_IDS.V1_TO_V2,
        SETTINGS_VERSION_MIGRATION_IDS.V2_TO_V3,
        SETTINGS_VERSION_MIGRATION_IDS.V3_TO_V4,
        SETTINGS_VERSION_MIGRATION_IDS.V4_TO_V5,
    ]);
    assert.equal(result.settings.settingsVersion, defaults.settingsVersion);
    assert.equal(result.settings.localSettings.sessionType, 'splitscreen');
    assert.equal(result.settings.localSettings.modePath, defaults.localSettings.modePath);
    assert.equal(result.settings.botPolicyStrategy, defaults.botPolicyStrategy);
    assert.equal(result.settings.localSettings.splitScreenVariant, 'standard');
    assert.equal(typeof result.settings.localSettings.fourPlayerPlanar, 'object');
});

test('settings migration derives the session type from the legacy mode field', () => {
    const manager = createManager();
    const defaults = manager.createDefaultSettings();

    const single = migrateSettingsSnapshot({ mode: '1p' }, defaults);
    const withoutMode = migrateSettingsSnapshot({}, defaults);

    assert.equal(single.settings.localSettings.sessionType, 'single');
    assert.equal(withoutMode.settings.localSettings.sessionType, defaults.localSettings.sessionType);
});

test('settings migration only runs the remaining steps for a partially migrated snapshot', () => {
    const manager = createManager();
    const defaults = manager.createDefaultSettings();

    const result = migrateSettingsSnapshot({
        settingsVersion: 1,
        mode: '1p',
        localSettings: { sessionType: 'single' },
    }, defaults);

    assert.deepEqual(result.appliedMigrations, [
        SETTINGS_VERSION_MIGRATION_IDS.V1_TO_V2,
        SETTINGS_VERSION_MIGRATION_IDS.V2_TO_V3,
        SETTINGS_VERSION_MIGRATION_IDS.V3_TO_V4,
        SETTINGS_VERSION_MIGRATION_IDS.V4_TO_V5,
    ]);
    assert.equal(result.settings.settingsVersion, defaults.settingsVersion);
});

test('settings migration treats an unreadable version stamp as version zero', () => {
    const manager = createManager();
    const defaults = manager.createDefaultSettings();

    const result = migrateSettingsSnapshot({ settingsVersion: 'broken', mode: '2p' }, defaults);

    assert.equal(result.fromVersion, 0);
    assert.equal(result.reachedVersion, defaults.settingsVersion);
    assert.equal(result.appliedMigrations.length, 5);
});

test('settings migration preserves custom version-three gameplay values', () => {
    const manager = createManager();
    const defaults = manager.createDefaultSettings();
    const saved = {
        settingsVersion: 3,
        numBots: 2,
        autoRoll: true,
        gameplay: {
            speed: 21,
            turnSensitivity: 2.7,
            itemAmount: 13,
        },
    };
    const result = migrateSettingsSnapshot(saved, defaults);

    assert.deepEqual(result.appliedMigrations, [
        SETTINGS_VERSION_MIGRATION_IDS.V3_TO_V4,
        SETTINGS_VERSION_MIGRATION_IDS.V4_TO_V5,
    ]);
    assert.equal(result.settings.settingsVersion, 5);
    assert.equal(result.settings.gameplay.speed, 21);
    assert.equal(result.settings.gameplay.turnSensitivity, 2.7);
    assert.equal(result.settings.gameplay.itemAmount, 13);
    assert.equal(result.settings.numBots, 2);
    assert.equal(result.settings.autoRoll, true);
    assert.equal(result.settings.botHeuristicTuning.balanced.aggression, 50);
    const sanitized = manager.sanitizeSettings(saved);
    assert.equal(sanitized.gameplay.speed, 21);
    assert.equal(sanitized.gameplay.turnSensitivity, 2.7);
    assert.equal(sanitized.gameplay.itemAmount, 13);
    assert.equal(sanitized.numBots, 2);
    assert.equal(sanitized.autoRoll, true);
});

test('settings migration updates only former gameplay defaults in version-three saves', () => {
    const manager = createManager();
    const defaults = manager.createDefaultSettings();
    const result = migrateSettingsSnapshot({
        settingsVersion: 3,
        numBots: 5,
        autoRoll: true,
        gameplay: { speed: 18, turnSensitivity: 2.2, itemAmount: 8 },
    }, defaults);

    assert.equal(result.settings.gameplay.speed, defaults.gameplay.speed);
    assert.equal(result.settings.gameplay.turnSensitivity, defaults.gameplay.turnSensitivity);
    assert.equal(result.settings.gameplay.itemAmount, defaults.gameplay.itemAmount);
    assert.equal(result.settings.numBots, defaults.numBots);
    assert.equal(result.settings.autoRoll, true);
});

test('settings migration fills missing version-three fields from current defaults', () => {
    const manager = createManager();
    const defaults = manager.createDefaultSettings();
    const result = migrateSettingsSnapshot({ settingsVersion: 3, gameplay: {} }, defaults);

    assert.equal(result.settings.gameplay.speed, defaults.gameplay.speed);
    assert.equal(result.settings.gameplay.turnSensitivity, defaults.gameplay.turnSensitivity);
    assert.equal(result.settings.gameplay.itemAmount, defaults.gameplay.itemAmount);
    assert.equal(result.settings.numBots, defaults.numBots);
    assert.equal(result.settings.autoRoll, defaults.autoRoll);
});

test('settings migration leaves a snapshot from a newer version untouched', () => {
    const manager = createManager();
    const defaults = manager.createDefaultSettings();

    const result = migrateSettingsSnapshot({ settingsVersion: 99, mode: '1p' }, defaults);

    assert.equal(result.fromVersion, 99);
    assert.equal(result.targetVersion, defaults.settingsVersion);
    assert.equal(result.reachedVersion, 99);
    assert.deepEqual(result.appliedMigrations, []);
    // No downgrade path exists, so the raw snapshot keeps its own version stamp here.
    assert.equal(result.settings.settingsVersion, 99);
});

test('SettingsManager still produces a complete snapshot for a newer settings version', () => {
    const storagePlatform = createMemoryStoragePlatform();
    const manager = new SettingsManager({ storagePlatform });
    const defaults = manager.createDefaultSettings();

    const sanitized = manager.sanitizeSettings({
        settingsVersion: 99,
        mode: '1p',
        gameplay: { speed: 21 },
    });
    manager.saveSettings(sanitized);
    const loaded = manager.loadSettings();

    // The sanitizer rebuilds from the defaults, so the future version stamp is replaced
    // instead of leaking into the persisted snapshot.
    assert.equal(sanitized.settingsVersion, defaults.settingsVersion);
    assert.equal(loaded.settingsVersion, defaults.settingsVersion);
    assert.deepEqual(collectPrimitiveLeafPaths(sanitized), collectPrimitiveLeafPaths(defaults));
    assert.equal(sanitized.gameplay.speed, 21);
});

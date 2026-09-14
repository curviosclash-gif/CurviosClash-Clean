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
    ]);
    assert.equal(result.settings.settingsVersion, defaults.settingsVersion);
});

test('settings migration treats an unreadable version stamp as version zero', () => {
    const manager = createManager();
    const defaults = manager.createDefaultSettings();

    const result = migrateSettingsSnapshot({ settingsVersion: 'broken', mode: '2p' }, defaults);

    assert.equal(result.fromVersion, 0);
    assert.equal(result.reachedVersion, defaults.settingsVersion);
    assert.equal(result.appliedMigrations.length, 3);
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

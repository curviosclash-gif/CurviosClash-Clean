import assert from 'node:assert/strict';
import test from 'node:test';

import { SettingsManager } from '../src/core/SettingsManager.js';
import {
    migrateSettingsSnapshot,
    SETTINGS_VERSION_MIGRATION_IDS,
} from '../src/core/settings/SettingsVersionMigrations.js';
import {
    SETTINGS_FIELD_DESCRIPTORS,
    SETTINGS_FIELD_NORMALIZERS,
    SETTINGS_PRESET_FIELD_DESCRIPTORS,
    readSettingsFieldValue,
} from '../src/ui/SettingsFieldRegistry.js';
import { isSettingsChangeKey } from '../src/ui/SettingsChangeKeys.js';
import { STORAGE_KEYS } from '../src/shared/storage/StorageKeys.js';

function createMemoryStoragePlatform(options = {}) {
    const records = new Map();
    return {
        driver: { storage: null },
        readJson(key, _legacyKeys = [], fallback = null) {
            return records.has(key) ? records.get(key) : fallback;
        },
        writeJson(key, value) {
            if (options.failWrites) {
                return { ok: false, reason: 'storage_unavailable', quotaExceeded: false };
            }
            records.set(key, value);
            return { ok: true, reason: 'ok', quotaExceeded: false };
        },
        getRecord(key) {
            return records.get(key);
        },
    };
}

test('settings field registry keeps paths unique and preset fields tied to defaults and change keys', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const defaults = manager.createDefaultSettings();
    const paths = SETTINGS_FIELD_DESCRIPTORS.map((descriptor) => descriptor.path);

    assert.equal(new Set(paths).size, paths.length);
    assert.ok(SETTINGS_PRESET_FIELD_DESCRIPTORS.length > 0);

    for (const descriptor of SETTINGS_PRESET_FIELD_DESCRIPTORS) {
        const defaultValue = readSettingsFieldValue(defaults, descriptor.defaultPath);
        assert.notEqual(defaultValue, undefined, descriptor.path);
        assert.ok(['boolean', 'number', 'string'].includes(typeof defaultValue), descriptor.path);
        assert.equal(isSettingsChangeKey(descriptor.changeKey), true, descriptor.path);
        assert.notEqual(descriptor.normalizer, SETTINGS_FIELD_NORMALIZERS.CONTRACT, descriptor.path);
    }
});

test('settings sanitizer is idempotent for malformed mixed input', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const once = manager.sanitizeSettings({
        mode: 'invalid',
        mapKey: '__proto__',
        numBots: 999,
        gameplay: {
            speed: Number.POSITIVE_INFINITY,
            planarMode: 'yes',
        },
        controls: {
            PLAYER_1: { UP: 'KeyW', SHOOT: 'KeyW' },
        },
        localSettings: {
            sessionType: 'lan',
            modePath: 'invalid',
            shadowQuality: 99,
            bloomQuality: 99,
        },
    });

    assert.deepEqual(manager.sanitizeSettings(once), once);
});

test('empty partial settings sanitize to the complete current defaults', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });

    assert.deepEqual(manager.sanitizeSettings({}), manager.createDefaultSettings());
});

test('successful save returns and reconciles the canonical snapshot without replacing the root object', () => {
    const storagePlatform = createMemoryStoragePlatform();
    const manager = new SettingsManager({ storagePlatform });
    const settings = {
        mapKey: '__proto__',
        gameplay: { speed: 999 },
        unknownRoot: true,
    };
    const rootReference = settings;

    const result = manager.saveSettings(settings);

    assert.equal(result.success, true);
    assert.equal(settings, rootReference);
    assert.deepEqual(settings, result.canonicalSettings);
    assert.deepEqual(storagePlatform.getRecord(STORAGE_KEYS.settings), result.canonicalSettings);
    assert.equal('unknownRoot' in settings, false);

    settings.gameplay.speed = 1;
    assert.notEqual(storagePlatform.getRecord(STORAGE_KEYS.settings).gameplay.speed, 1);
});

test('failed save returns the canonical preview without mutating live settings', () => {
    const manager = new SettingsManager({
        storagePlatform: createMemoryStoragePlatform({ failWrites: true }),
    });
    const settings = { gameplay: { speed: 999 }, unsavedMarker: true };
    const before = structuredClone(settings);

    const result = manager.saveSettings(settings);

    assert.equal(result.success, false);
    assert.deepEqual(settings, before);
    assert.notDeepEqual(result.canonicalSettings, before);
});

test('settings versions migrate through explicit ordered steps', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const defaults = manager.createDefaultSettings();

    const migration = migrateSettingsSnapshot({
        settingsVersion: 0,
        mode: '2p',
    }, defaults);

    assert.deepEqual(migration.appliedMigrations, [
        SETTINGS_VERSION_MIGRATION_IDS.V0_TO_V1,
        SETTINGS_VERSION_MIGRATION_IDS.V1_TO_V2,
        SETTINGS_VERSION_MIGRATION_IDS.V2_TO_V3,
    ]);
    assert.equal(migration.reachedVersion, defaults.settingsVersion);
    assert.equal(migration.settings.settingsVersion, defaults.settingsVersion);
    assert.equal(migration.settings.localSettings.sessionType, 'splitscreen');
    assert.equal(migration.settings.localSettings.modePath, defaults.localSettings.modePath);
    assert.equal(migration.settings.botPolicyStrategy, defaults.botPolicyStrategy);
    assert.equal(migration.settings.localSettings.splitScreenVariant, 'standard');
});

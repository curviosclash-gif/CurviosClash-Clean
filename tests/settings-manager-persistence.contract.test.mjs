import assert from 'node:assert/strict';
import test from 'node:test';

import { SETTINGS_CHANGE_KEYS } from '../src/composition/core-ui/CoreSettingsPorts.js';
import { SettingsManager } from '../src/core/SettingsManager.js';
import { createSettingsSessionDraftFacade } from '../src/core/settings/SettingsSessionDraftFacade.js';
import { SettingsStore } from '../src/ui/SettingsStore.js';
import { STORAGE_KEYS } from '../src/shared/storage/StorageKeys.js';
import {
    applyMenuConfigPayload,
    exportMenuConfigAsJson,
    parseMenuConfigImportInput,
} from '../src/ui/menu/MenuConfigShareOps.js';
import { diffSettingsSnapshots } from '../src/core/settings/SettingsDiffOps.js';
import { MenuDraftStore } from '../src/ui/menu/MenuDraftStore.js';
import { MENU_TEXT_CATALOG } from '../src/ui/menu/MenuTextCatalog.js';


import {
    createMemoryStoragePlatform,
    createOwnerAccessContext,
    createMemoryBrowserStorage,
    withMockLocalStorage,
    readProductiveSourceFiles,
} from './helpers/settings-manager-contract-test-utils.mjs';
test('V103 SettingsManager loadSettings rewrites persisted snapshots to canonical save shape', () => {
    const storagePlatform = createMemoryStoragePlatform({
        [STORAGE_KEYS.settings]: {
            mapKey: 'arena_simple',
            gameplay: {
                speed: 0.88,
            },
            localSettings: {
                sessionType: 'single',
            },
        },
    });
    const manager = new SettingsManager({ storagePlatform });

    const loadedSettings = manager.loadSettings();
    const persistedSettings = storagePlatform.getRecord(STORAGE_KEYS.settings);

    assert.deepEqual(persistedSettings, loadedSettings);
    assert.deepEqual(persistedSettings, manager.sanitizeSettings(persistedSettings));
});

test('SettingsManager repairs primitive persisted settings with the canonical default snapshot', () => {
    const storagePlatform = createMemoryStoragePlatform({
        [STORAGE_KEYS.settings]: 'corrupt-settings-record',
    });
    const manager = new SettingsManager({ storagePlatform });

    const loadedSettings = manager.loadSettings();

    assert.deepEqual(loadedSettings, manager.createDefaultSettings());
    assert.deepEqual(storagePlatform.getRecord(STORAGE_KEYS.settings), loadedSettings);
});

test('SettingsManager partial snapshots preserve current invert-pitch and vehicle defaults', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const defaults = manager.createDefaultSettings();

    const sanitized = manager.sanitizeSettings({
        settingsVersion: defaults.settingsVersion,
    });

    assert.deepEqual(sanitized.invertPitch, defaults.invertPitch);
    assert.deepEqual(sanitized.vehicles, defaults.vehicles);
});

test('SettingsManager rejects inherited object property names as map keys', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const defaults = manager.createDefaultSettings();

    const sanitized = manager.sanitizeSettings({ mapKey: '__proto__' });

    assert.equal(sanitized.mapKey, defaults.mapKey);
});

test('V103 SettingsManager saveSettings persists the same canonical snapshot returned by loadSettings', () => {
    const storagePlatform = createMemoryStoragePlatform();
    const manager = new SettingsManager({ storagePlatform });
    const rawSettings = {
        mapKey: 'arena_simple',
        numBots: 3,
        gameplay: {
            speed: 1.12,
        },
        localSettings: {
            sessionType: 'multiplayer',
            multiplayerTransport: 'lan',
        },
    };

    const persisted = manager.saveSettings(rawSettings);
    const storedSettings = storagePlatform.getRecord(STORAGE_KEYS.settings);
    const canonicalSettings = manager.sanitizeSettings(rawSettings);

    assert.equal(persisted.success, true);
    assert.equal(persisted.reason, 'ok');
    assert.equal(persisted.metadata?.key, STORAGE_KEYS.settings);
    assert.deepEqual(storedSettings, canonicalSettings);
    assert.deepEqual(manager.loadSettings(), canonicalSettings);
});

test('V103 SettingsManager sanitizeSettings applies runtime-specific limit overrides from runtimeGlobal', () => {
    const storagePlatform = createMemoryStoragePlatform();
    const runtimeGlobal = {
        settingsDefaultsContract: {
            getOverrideSnapshot() {
                return {
                    draft: {
                        schemaVersion: 'menu-defaults-override.v1',
                        limitOverrides: {
                            'baseSettings.gameplay.speed': { max: 12 },
                        },
                    },
                };
            },
        },
    };
    const manager = new SettingsManager({ storagePlatform, runtimeGlobal });

    const sanitized = manager.sanitizeSettings({
        gameplay: {
            speed: 20,
        },
    });

    assert.equal(sanitized.gameplay.speed, 12);
});

test('SettingsManager accepts up to 60 simultaneous items and clamps larger values', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });

    const maximum = manager.sanitizeSettings({
        gameplay: { itemAmount: 60 },
    });
    const clamped = manager.sanitizeSettings({
        gameplay: { itemAmount: 61 },
    });
    const runtimeConfig = manager.createRuntimeConfig(maximum);

    assert.equal(maximum.gameplay.itemAmount, 60);
    assert.equal(clamped.gameplay.itemAmount, 60);
    assert.equal(runtimeConfig.powerup.maxOnField, 60);
});

test('V96.7 SettingsManager exposes defaults port for runtime limit overrides', () => {
    const runtimeGlobal = {
        settingsDefaultsContract: {
            getOverrideSnapshot() {
                return {
                    draft: {
                        schemaVersion: 'menu-defaults-override.v1',
                        limitOverrides: {
                            'baseSettings.gameplay.itemAmount': {
                                min: 1,
                                max: 4,
                                step: 1,
                                integer: true,
                            },
                        },
                    },
                };
            },
        },
    };
    const manager = new SettingsManager({
        storagePlatform: createMemoryStoragePlatform(),
        runtimeGlobal,
    });

    const defaultsPort = manager.getSettingsDefaultsPort();
    const snapshot = manager.createRuntimeConfig({
        gameplay: { itemAmount: 12 },
    });

    assert.equal(typeof defaultsPort.getOverrideSnapshot, 'function');
    assert.equal(snapshot.powerup.maxOnField, 4);
});

test('V103 SettingsManager exposes a narrow record-store port for runtime consumers', () => {
    const storagePlatform = createMemoryStoragePlatform();
    const manager = new SettingsManager({ storagePlatform });
    const recordPort = manager.getSettingsRecordStorePort();

    assert.equal('store' in manager, false);
    assert.equal(typeof recordPort.loadJsonRecord, 'function');
    assert.equal(typeof recordPort.saveJsonRecord, 'function');
    assert.equal('loadSettings' in recordPort, false);
    assert.equal('saveSettings' in recordPort, false);

    assert.deepEqual(recordPort.saveJsonRecord('custom.record', { ok: true }), {
        success: true,
        reason: 'ok',
        metadata: {
            key: 'custom.record',
        },
    });
    assert.deepEqual(recordPort.loadJsonRecord('custom.record', null), { ok: true });
});

test('V103 SettingsManager exposes text overrides through a narrow read port', () => {
    withMockLocalStorage(() => {
        const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
        const textId = Object.keys(MENU_TEXT_CATALOG)[0];

        const port = manager.getMenuTextOverridePort();
        const result = manager.setMenuTextOverride(textId, 'Port override');

        assert.equal(Object.isFrozen(port), true);
        assert.equal(typeof port.getOverride, 'function');
        assert.equal(typeof port.listOverrides, 'function');
        assert.equal('setOverride' in port, false);
        assert.equal(result.success, true);
        assert.equal(port.getOverride(textId), 'Port override');
        assert.deepEqual(port.listOverrides(), { [textId]: 'Port override' });
    });
});

test('V103 SettingsManager routes sidecar stores through the injected storage platform', () => {
    const storagePlatform = createMemoryStoragePlatform();
    const manager = new SettingsManager({
        storagePlatform,
        telemetryHistoryStore: {
            getSummary() { return {}; },
        },
    });
    const settings = manager.createDefaultSettings();
    const accessContext = createOwnerAccessContext();
    const textId = Object.keys(MENU_TEXT_CATALOG)[0];

    const presetResult = manager.saveMenuPreset(settings, {
        kind: 'open',
        id: 'injected-store-preset',
        name: 'Injected Store Preset',
    }, accessContext);
    const draftResult = manager.saveSessionDraft(settings, 'single');
    const textResult = manager.setMenuTextOverride(textId, 'Injected text');
    const telemetrySnapshot = manager.recordMenuTelemetry(settings, 'quickstart', { mapKey: 'standard' });

    assert.equal(presetResult.success, true);
    assert.equal(draftResult.success, true);
    assert.equal(textResult.success, true);
    assert.equal(typeof telemetrySnapshot.quickStartCount, 'number');
    assert.equal(storagePlatform.getRecord(STORAGE_KEYS.menuPresets)?.schemaVersion, 'menu-preset-store.v1');
    assert.equal(storagePlatform.getRecord(STORAGE_KEYS.menuDrafts)?.schemaVersion, 'menu-draft-store.v1');
    assert.equal(storagePlatform.getRecord(STORAGE_KEYS.menuTextOverrides)?.schemaVersion, 'menu-text-overrides.v1');
    assert.equal(storagePlatform.getRecord(STORAGE_KEYS.menuTelemetry)?.schemaVersion, 'menu-telemetry.v1');
});

test('V103 SettingsManager persistence contract maps invalid_key, quota_exceeded and storage_failed reasons', () => {
    const quotaStoragePlatform = createMemoryStoragePlatform({}, {
        writeJson() {
            return {
                ok: false,
                reason: 'QuotaExceededError',
                quotaExceeded: true,
            };
        },
    });
    const quotaManager = new SettingsManager({ storagePlatform: quotaStoragePlatform });
    const quotaResult = quotaManager.saveSettings(quotaManager.createDefaultSettings());
    const quotaProfilesResult = quotaManager.getProfileStorePort().saveProfiles([]);

    assert.equal(quotaResult.success, false);
    assert.equal(quotaResult.reason, 'quota_exceeded');
    assert.equal(quotaResult.metadata?.storageReason, 'QuotaExceededError');
    assert.equal(quotaProfilesResult.success, false);
    assert.equal(quotaProfilesResult.reason, 'quota_exceeded');
    assert.equal(quotaProfilesResult.metadata?.key, STORAGE_KEYS.settingsProfiles);

    const failedStoragePlatform = createMemoryStoragePlatform({}, {
        writeJson() {
            return {
                ok: false,
                reason: 'storage_unavailable',
                quotaExceeded: false,
            };
        },
    });
    const failedManager = new SettingsManager({ storagePlatform: failedStoragePlatform });
    const failedResult = failedManager.saveSettings(failedManager.createDefaultSettings());
    const failedProfilesResult = failedManager.getProfileStorePort().saveProfiles([]);

    assert.equal(failedResult.success, false);
    assert.equal(failedResult.reason, 'storage_failed');
    assert.equal(failedResult.metadata?.storageReason, 'storage_unavailable');
    assert.equal(failedProfilesResult.success, false);
    assert.equal(failedProfilesResult.reason, 'storage_failed');
    assert.equal(failedProfilesResult.metadata?.key, STORAGE_KEYS.settingsProfiles);

    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const recordPort = manager.getSettingsRecordStorePort();
    const invalidKeyResult = recordPort.saveJsonRecord('   ', { ok: true });

    assert.equal(invalidKeyResult.success, false);
    assert.equal(invalidKeyResult.reason, 'invalid_key');
});

test('V103 SettingsStore canonical rewrite check ignores property order for semantically identical data', () => {
    const sourceSettings = {
        gameplay: { speed: 1, planarMode: true },
        localSettings: { sessionType: 'single', modePath: 'quick_action' },
    };
    const reorderedSettings = {
        localSettings: { modePath: 'quick_action', sessionType: 'single' },
        gameplay: { planarMode: true, speed: 1 },
    };
    let writeCount = 0;
    const storagePlatform = createMemoryStoragePlatform(
        { [STORAGE_KEYS.settings]: sourceSettings },
        {
            writeJson(key, value, records) {
                writeCount += 1;
                records.set(key, value);
                return { ok: true, reason: 'ok', quotaExceeded: false };
            },
        }
    );
    const store = new SettingsStore({
        storagePlatform,
        sanitizeSettings: () => reorderedSettings,
        createDefaultSettings: () => ({}),
    });

    const loaded = store.loadSettings();

    assert.equal(writeCount, 0);
    assert.deepEqual(loaded, reorderedSettings);
});

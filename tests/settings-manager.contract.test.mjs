import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { SETTINGS_CHANGE_KEYS } from '../src/composition/core-ui/CoreSettingsPorts.js';
import { SettingsManager } from '../src/core/SettingsManager.js';
import { createSettingsSessionDraftFacade } from '../src/core/settings/SettingsSessionDraftFacade.js';
import { SettingsStore } from '../src/ui/SettingsStore.js';
import { STORAGE_KEYS } from '../src/ui/StorageKeys.js';
import {
    applyMenuConfigPayload,
    exportMenuConfigAsJson,
    parseMenuConfigImportInput,
} from '../src/ui/menu/MenuConfigShareOps.js';
import { diffSettingsSnapshots } from '../src/core/settings/SettingsDiffOps.js';
import { MenuDraftStore } from '../src/ui/menu/MenuDraftStore.js';
import { MENU_TEXT_CATALOG } from '../src/ui/menu/MenuTextCatalog.js';

function createMemoryStoragePlatform(initialRecords = {}, options = {}) {
    const records = new Map(Object.entries(initialRecords));
    const writeJson = typeof options.writeJson === 'function'
        ? options.writeJson
        : (key, value) => {
            records.set(key, value);
            return { ok: true, reason: 'ok', quotaExceeded: false };
        };
    return {
        driver: { storage: null },
        readJson(key, legacyKeys = [], fallback = null) {
            const candidates = [key, ...(Array.isArray(legacyKeys) ? legacyKeys : [])];
            for (const candidate of candidates) {
                if (!records.has(candidate)) continue;
                return records.get(candidate);
            }
            return fallback;
        },
        writeJson(key, value) {
            return writeJson(key, value, records);
        },
        getRecord(key) {
            return records.get(key);
        },
    };
}

function createOwnerAccessContext(overrides = {}) {
    return {
        ownerId: 'owner',
        actorId: 'owner',
        isOwner: true,
        developerModeVisibility: 'owner_only',
        developerModeEnabled: true,
        releasePreviewEnabled: false,
        expertModeUnlocked: true,
        expertModeAvailable: true,
        expertModeAccessMode: 'owner_only',
        expertModeReason: '',
        expertModeProductSurfaceId: 'desktop-app',
        ...overrides,
    };
}

function createMemoryBrowserStorage(initialRecords = {}) {
    const records = new Map(
        Object.entries(initialRecords).map(([key, value]) => [key, String(value)])
    );
    return {
        getItem(key) {
            return records.has(key) ? records.get(key) : null;
        },
        setItem(key, value) {
            records.set(String(key), String(value));
        },
        removeItem(key) {
            records.delete(String(key));
        },
        clear() {
            records.clear();
        },
    };
}

function withMockLocalStorage(run) {
    const previous = globalThis.localStorage;
    globalThis.localStorage = createMemoryBrowserStorage();
    try {
        return run();
    } finally {
        if (typeof previous === 'undefined') {
            delete globalThis.localStorage;
        } else {
            globalThis.localStorage = previous;
        }
    }
}

function readProductiveSourceFiles(rootUrl, relativePath = '') {
    const directoryUrl = new URL(`../src/${relativePath}`, rootUrl);
    const entries = fs.readdirSync(directoryUrl, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            files.push(...readProductiveSourceFiles(rootUrl, entryPath));
            continue;
        }
        if (!entry.name.endsWith('.js')) continue;
        if (entryPath === 'core/SettingsManager.js') continue;
        files.push(entryPath);
    }
    return files;
}

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

test('V103 SettingsManager diffSettings reports changed paths and known change keys', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const before = manager.createDefaultSettings();
    const after = manager.sanitizeSettings({
        ...before,
        gameplay: {
            ...before.gameplay,
            speed: before.gameplay.speed + 1,
        },
        localSettings: {
            ...before.localSettings,
            sessionType: 'single',
        },
    });

    const diff = manager.diffSettings(before, after);

    assert.equal(diff.changed, true);
    assert.ok(diff.changedKeys.includes(SETTINGS_CHANGE_KEYS.GAMEPLAY_SPEED));
    assert.ok(diff.changedKeys.includes(SETTINGS_CHANGE_KEYS.SESSION_TYPE));
    assert.ok(diff.changes.some((change) => (
        change.path === 'gameplay.speed'
        && change.changeKey === SETTINGS_CHANGE_KEYS.GAMEPLAY_SPEED
    )));
    assert.equal(Object.isFrozen(manager.diagnosticsFacade), true);
});

test('V103 SettingsManager diffSettings uses central path contracts and leaves unknown paths unmapped', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const before = manager.createDefaultSettings();
    const after = {
        ...before,
        localSettings: {
            ...before.localSettings,
            developerThemeId: 'classic-blue',
        },
        customDiagnostics: {
            flag: true,
        },
    };

    const diff = manager.diffSettings(before, after);

    assert.ok(diff.changedKeys.includes(SETTINGS_CHANGE_KEYS.DEVELOPER_THEME_ID));
    assert.ok(diff.changes.some((change) => (
        change.path === 'localSettings.developerThemeId'
        && change.changeKey === SETTINGS_CHANGE_KEYS.DEVELOPER_THEME_ID
    )));
    assert.ok(diff.changes.some((change) => (
        change.path === 'customDiagnostics'
        && change.changeKey === null
    )));
});

test('V103 menu config import parsing is pure and apply owns mutation', () => {
    const settings = { mapKey: 'before', localSettings: { sessionType: 'single' } };
    const inputValue = JSON.stringify({
        contractVersion: 'menu-config-share.v1',
        payload: {
            mapKey: 'arena_simple',
            mode: '1p',
            gameMode: 'classic',
            sessionType: 'splitscreen',
        },
    });

    const parsed = parseMenuConfigImportInput(inputValue);

    assert.equal(parsed.success, true);
    assert.equal(parsed.reason, 'imported');
    assert.equal(settings.mapKey, 'before');
    assert.equal(settings.localSettings.sessionType, 'single');
    assert.equal(applyMenuConfigPayload(settings, parsed.payload), true);
    assert.equal(settings.mapKey, 'arena_simple');
    assert.equal(settings.localSettings.sessionType, 'splitscreen');
});

test('Menu config share preserves local and media runtime fields', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const source = manager.createDefaultSettings();
    source.localSettings.shadowQuality = 1;
    source.localSettings.startSetup.arcadeGhostDuelMode = 'self_longest_ghost';
    source.localSettings.startSetup.arcadeGhostTrailCollisionEnabled = true;
    source.recording.profile = 'youtube_short';
    source.recording.hudMode = 'with_hud';
    source.cameraPerspective.normal = 'cinematic_action';
    source.cameraPerspective.reduceMotion = false;
    source.cameraPerspective.speedFovIntensity = 0.4;

    const exported = JSON.parse(exportMenuConfigAsJson(source));
    const target = manager.createDefaultSettings();
    target.localSettings.shadowQuality = 3;
    target.localSettings.startSetup.arcadeGhostDuelMode = 'off';
    target.localSettings.startSetup.arcadeGhostTrailCollisionEnabled = false;
    target.recording.profile = 'standard';
    target.recording.hudMode = 'clean';
    target.cameraPerspective.normal = 'classic';
    target.cameraPerspective.reduceMotion = true;
    target.cameraPerspective.speedFovIntensity = 1;

    assert.equal(applyMenuConfigPayload(target, exported.payload), true);
    assert.equal(target.localSettings.shadowQuality, 1);
    assert.equal(target.localSettings.startSetup.arcadeGhostDuelMode, 'self_longest_ghost');
    assert.equal(target.localSettings.startSetup.arcadeGhostTrailCollisionEnabled, true);
    assert.equal(target.recording.profile, 'youtube_short');
    assert.equal(target.recording.hudMode, 'with_hud');
    assert.equal(target.cameraPerspective.normal, 'cinematic_action');
    assert.equal(target.cameraPerspective.reduceMotion, false);
    assert.equal(target.cameraPerspective.speedFovIntensity, 0.4);
});

test('V103 SettingsManager previewMenuConfigImport does not mutate source settings and returns changes', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const settings = manager.createDefaultSettings();
    const originalSnapshot = JSON.parse(JSON.stringify(settings));
    const inputValue = JSON.stringify({
        contractVersion: 'menu-config-share.v1',
        payload: {
            sessionType: 'single',
            modePath: 'normal',
            themeMode: 'hell',
            mode: '1p',
            gameMode: 'classic',
            mapKey: 'standard',
            numBots: settings.numBots,
            botDifficulty: settings.botDifficulty,
            winsNeeded: settings.winsNeeded,
            autoRoll: settings.autoRoll,
            portalsEnabled: settings.portalsEnabled,
            vehicles: settings.vehicles,
            hunt: settings.hunt,
            gameplay: {
                ...settings.gameplay,
                speed: settings.gameplay.speed + 2,
            },
            recording: settings.recording,
            cameraPerspective: settings.cameraPerspective,
        },
    });

    const preview = manager.previewMenuConfigImport(settings, inputValue, createOwnerAccessContext());

    assert.equal(preview.success, true);
    assert.equal(preview.reason, 'imported');
    assert.deepEqual(settings, originalSnapshot);
    assert.ok(preview.changedKeys.includes(SETTINGS_CHANGE_KEYS.GAMEPLAY_SPEED));
    assert.ok(preview.changedKeys.includes(SETTINGS_CHANGE_KEYS.MODE_PATH));
    assert.ok(Array.isArray(preview.changes));
    assert.ok(preview.changes.length > 0);
    assert.deepEqual(preview.blockedPaths, []);
    assert.equal(preview.usedLegacyFallback, false);
});

test('V103 SettingsManager health snapshot exposes narrow diagnostic fields only', () => {
    withMockLocalStorage(() => {
        const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
        const settings = manager.createDefaultSettings();
        settings.localSettings.sessionType = 'splitscreen';
        settings.matchSettings.activePresetId = 'fixed-classic';
        settings.matchSettings.activePresetKind = 'fixed';
        const textId = Object.keys(MENU_TEXT_CATALOG)[0];
        manager.setMenuTextOverride(textId, 'Health override');

        const health = manager.getSettingsHealthSnapshot(settings);

        assert.deepEqual(Object.keys(health).sort(), [
            'activePresetId',
            'activePresetKind',
            'hasMenuTextOverridePort',
            'hasProfileStorePort',
            'hasRecordStorePort',
            'lastPersistenceReason',
            'persistenceReasons',
            'persistenceStatus',
            'presetCount',
            'sessionType',
            'telemetryAvailable',
            'textOverrideCount',
        ].sort());
        assert.equal(health.hasRecordStorePort, true);
        assert.equal(health.hasProfileStorePort, true);
        assert.equal(health.hasMenuTextOverridePort, true);
        assert.equal(health.telemetryAvailable, true);
        assert.equal(health.activePresetId, 'fixed-classic');
        assert.equal(health.activePresetKind, 'fixed');
        assert.equal(health.sessionType, 'splitscreen');
        assert.equal(health.textOverrideCount, 1);
        assert.equal(typeof health.presetCount, 'number');
        assert.deepEqual(health.persistenceStatus, {
            settings: 'unknown',
            profiles: 'unknown',
            records: 'unknown',
            presets: 'unknown',
            drafts: 'unknown',
            textOverrides: 'ok',
            telemetry: 'unknown',
        });
        assert.deepEqual(health.persistenceReasons, {
            settings: '',
            profiles: '',
            records: '',
            presets: '',
            drafts: '',
            textOverrides: 'ok',
            telemetry: '',
        });
        assert.equal(health.lastPersistenceReason, '');
        assert.equal('settings' in health, false);
        assert.equal('store' in health, false);
        assert.equal('settingsStore' in health, false);
    });
});

test('V103 SettingsManager health snapshot includes narrow persistence status after writes', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });

    manager.saveSettings(manager.createDefaultSettings());
    const health = manager.getSettingsHealthSnapshot();

    assert.deepEqual(health.persistenceStatus, {
        settings: 'ok',
        profiles: 'unknown',
        records: 'unknown',
        presets: 'unknown',
        drafts: 'unknown',
        textOverrides: 'unknown',
        telemetry: 'unknown',
    });
    assert.deepEqual(health.persistenceReasons, {
        settings: 'ok',
        profiles: '',
        records: '',
        presets: '',
        drafts: '',
        textOverrides: '',
        telemetry: '',
    });
    assert.equal(health.lastPersistenceReason, 'ok');
    assert.equal('metadata' in health.persistenceStatus, false);
});

test('V103 SettingsManager productive consumers avoid direct settings store reach-throughs', () => {
    const productiveConsumers = readProductiveSourceFiles(import.meta.url);
    for (const filePath of productiveConsumers) {
        const source = fs.readFileSync(new URL(`../src/${filePath}`, import.meta.url), 'utf8');
        assert.equal(source.includes('settingsManager?.store'), false, filePath);
        assert.equal(source.includes('settingsManager.store'), false, filePath);
        assert.equal(source.includes('settingsManager?.menuTextOverrideStore'), false, filePath);
        assert.equal(source.includes('settingsManager.menuTextOverrideStore'), false, filePath);
    }
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

test('V103 SettingsManager profile store port is immutable', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const profilePort = manager.getProfileStorePort();

    assert.equal(Object.isFrozen(profilePort), true);
});

test('V103 SettingsManager mutation facades expose a shared result contract', () => {
    withMockLocalStorage(() => {
        const storagePlatform = createMemoryStoragePlatform();
        const manager = new SettingsManager({ storagePlatform });
        const settings = manager.createDefaultSettings();
        settings.localSettings.ownerId = 'owner';
        settings.localSettings.actorId = 'owner';
        const accessContext = createOwnerAccessContext();
        const textId = Object.keys(MENU_TEXT_CATALOG)[0];

        const developerResult = manager.setDeveloperTheme(settings, 'classic-blue', accessContext);
        const presetResult = manager.saveMenuPreset(settings, { kind: 'open', name: 'Contract Preset' }, accessContext);
        const sessionResult = manager.switchSessionType(settings, 'splitscreen');
        const textResult = manager.setMenuTextOverride(textId, 'Contract override');
        const botPolicyResult = manager.setBotPolicyStrategy(settings, 'heuristic');

        assert.equal(developerResult.success, true);
        assert.equal(developerResult.reason, 'updated');
        assert.deepEqual(developerResult.changedKeys, [SETTINGS_CHANGE_KEYS.DEVELOPER_THEME_ID]);
        assert.deepEqual(developerResult.metadata, { uiEffectOwner: 'ui' });

        assert.equal(presetResult.success, true);
        assert.equal(Array.isArray(presetResult.changedKeys), true);
        assert.ok(presetResult.changedKeys.includes(SETTINGS_CHANGE_KEYS.PRESET_LIST));
        assert.ok(presetResult.changedKeys.includes(SETTINGS_CHANGE_KEYS.PRESET_STATUS));
        assert.equal(typeof presetResult.metadata?.presetId, 'string');

        assert.equal(sessionResult.success, true);
        assert.equal(typeof sessionResult.reason, 'string');
        assert.equal(Array.isArray(sessionResult.changedKeys), true);
        assert.equal(sessionResult.metadata?.sessionType, 'splitscreen');

        assert.equal(textResult.success, true);
        assert.equal(textResult.reason, 'updated');
        assert.deepEqual(textResult.changedKeys, [SETTINGS_CHANGE_KEYS.DEVELOPER_TEXT_OVERRIDES]);
        assert.equal(textResult.metadata?.textId, textId);

        assert.equal(botPolicyResult.success, true);
        assert.equal(botPolicyResult.reason, 'updated');
        assert.deepEqual(botPolicyResult.changedKeys, [SETTINGS_CHANGE_KEYS.BOTS_POLICY_STRATEGY]);
        assert.equal(botPolicyResult.metadata?.botPolicyStrategy, 'heuristic');
    });
});

test('V103 SettingsManager controls bot policy strategy with normalization', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const settings = manager.createDefaultSettings();

    const heuristicResult = manager.setBotPolicyStrategy(settings, 'pure-heuristic');
    const invalidResult = manager.setBotPolicyStrategy(settings, 'not-a-policy');
    const unchangedResult = manager.setBotPolicyStrategy(settings, 'heuristic');

    assert.equal(heuristicResult.success, true);
    assert.equal(heuristicResult.reason, 'updated');
    assert.equal(settings.botPolicyStrategy, 'heuristic');
    assert.deepEqual(heuristicResult.changedKeys, [SETTINGS_CHANGE_KEYS.BOTS_POLICY_STRATEGY]);

    assert.equal(invalidResult.success, true);
    assert.equal(invalidResult.reason, 'unchanged');
    assert.equal(settings.botPolicyStrategy, 'heuristic');
    assert.deepEqual(invalidResult.changedKeys, []);

    assert.equal(unchangedResult.success, true);
    assert.equal(unchangedResult.reason, 'unchanged');
    assert.deepEqual(unchangedResult.changedKeys, []);
});

test('V103 SettingsManager mutation contracts preserve ownership and failure reasons', () => {
    const storagePlatform = createMemoryStoragePlatform();
    const manager = new SettingsManager({ storagePlatform });
    const settings = manager.createDefaultSettings();
    settings.localSettings.ownerId = 'owner';
    settings.localSettings.actorId = 'guest';
    const guestAccessContext = createOwnerAccessContext({
        actorId: 'guest',
        isOwner: false,
    });

    const developerResult = manager.setDeveloperVisibility(settings, 'open', guestAccessContext);
    const fixedPresetResult = manager.saveMenuPreset(settings, { kind: 'fixed', name: 'Locked Preset' }, guestAccessContext);
    const unknownTextResult = manager.setMenuTextOverride('missing.text.id', 'Nope');

    assert.equal(developerResult.success, false);
    assert.equal(developerResult.reason, 'owner_required');
    assert.deepEqual(developerResult.changedKeys, []);

    assert.equal(fixedPresetResult.success, false);
    assert.equal(fixedPresetResult.reason, 'owner_required');
    assert.deepEqual(fixedPresetResult.changedKeys, []);

    assert.equal(unknownTextResult.success, false);
    assert.equal(unknownTextResult.reason, 'unknown_text_id');
    assert.deepEqual(unknownTextResult.changedKeys, []);
});

test('V103 Settings session draft facade preserves store failure reasons', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const facade = createSettingsSessionDraftFacade({
        menuDraftStore: {
            saveDraft() {
                return { success: false, reason: 'quota_exceeded' };
            },
        },
    });

    const result = facade.saveSessionDraft(manager.createDefaultSettings(), 'single');

    assert.equal(result.success, false);
    assert.equal(result.reason, 'quota_exceeded');
    assert.deepEqual(result.changedKeys, []);
    assert.equal(result.metadata.persistedDraftState, false);
});

test('Menu session drafts preserve local, recording and camera runtime fields', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const settings = manager.createDefaultSettings();
    settings.localSettings.sessionType = 'single';
    settings.localSettings.shadowQuality = 1;
    settings.localSettings.startSetup.arcadeGhostDuelMode = 'self_longest_ghost';
    settings.localSettings.startSetup.arcadeGhostTrailCollisionEnabled = true;
    settings.gameplay.nextCheckpointGlowIntensity = 1.2;
    settings.recording.profile = 'youtube_short';
    settings.recording.hudMode = 'with_hud';
    settings.cameraPerspective.normal = 'cinematic_action';
    settings.cameraPerspective.reduceMotion = false;
    settings.cameraPerspective.speedFovIntensity = 0.35;

    const store = new MenuDraftStore({ storagePlatform: createMemoryStoragePlatform() });
    assert.equal(store.saveDraft('single', settings).success, true);

    settings.localSettings.shadowQuality = 3;
    settings.localSettings.startSetup.arcadeGhostDuelMode = 'off';
    settings.localSettings.startSetup.arcadeGhostTrailCollisionEnabled = false;
    settings.gameplay.nextCheckpointGlowIntensity = 0.5;
    settings.recording.profile = 'standard';
    settings.recording.hudMode = 'clean';
    settings.cameraPerspective.normal = 'classic';
    settings.cameraPerspective.reduceMotion = true;
    settings.cameraPerspective.speedFovIntensity = 1;

    const applyResult = store.applyDraft(settings, 'single');

    assert.equal(applyResult.success, true);
    assert.equal(settings.localSettings.shadowQuality, 1);
    assert.equal(settings.localSettings.startSetup.arcadeGhostDuelMode, 'self_longest_ghost');
    assert.equal(settings.localSettings.startSetup.arcadeGhostTrailCollisionEnabled, true);
    assert.equal(settings.gameplay.nextCheckpointGlowIntensity, 1.2);
    assert.equal(settings.recording.profile, 'youtube_short');
    assert.equal(settings.recording.hudMode, 'with_hud');
    assert.equal(settings.cameraPerspective.normal, 'cinematic_action');
    assert.equal(settings.cameraPerspective.reduceMotion, false);
    assert.equal(settings.cameraPerspective.speedFovIntensity, 0.35);
});

test('Menu presets capture and apply local, recording and camera runtime fields', () => {
    withMockLocalStorage(() => {
        const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
        const settings = manager.createDefaultSettings();
        const accessContext = createOwnerAccessContext();
        settings.localSettings.shadowQuality = 1;
        settings.localSettings.startSetup.arcadeGhostDuelMode = 'self_longest_ghost';
        settings.localSettings.startSetup.arcadeGhostTrailCollisionEnabled = true;
        settings.gameplay.nextCheckpointGlowIntensity = 1.25;
        settings.recording.profile = 'youtube_short';
        settings.recording.hudMode = 'with_hud';
        settings.cameraPerspective.normal = 'cinematic_action';
        settings.cameraPerspective.reduceMotion = false;
        settings.cameraPerspective.speedFovIntensity = 0.45;

        const saveResult = manager.saveMenuPreset(settings, {
            kind: 'open',
            id: 'media-runtime-preset',
            name: 'Media Runtime Preset',
            timestamp: '2026-05-07T00:00:00.000Z',
        }, accessContext);
        assert.equal(saveResult.success, true);

        settings.localSettings.shadowQuality = 3;
        settings.localSettings.startSetup.arcadeGhostDuelMode = 'off';
        settings.localSettings.startSetup.arcadeGhostTrailCollisionEnabled = false;
        settings.gameplay.nextCheckpointGlowIntensity = 0.75;
        settings.recording.profile = 'standard';
        settings.recording.hudMode = 'clean';
        settings.cameraPerspective.normal = 'classic';
        settings.cameraPerspective.reduceMotion = true;
        settings.cameraPerspective.speedFovIntensity = 1;

        const applyResult = manager.applyMenuPreset(settings, 'media-runtime-preset', accessContext);

        assert.equal(applyResult.success, true);
        assert.ok(applyResult.changedKeys.includes(SETTINGS_CHANGE_KEYS.LOCAL_SHADOW_QUALITY));
        assert.ok(applyResult.changedKeys.includes(SETTINGS_CHANGE_KEYS.ARCADE_GHOST_DUEL_MODE));
        assert.ok(applyResult.changedKeys.includes(SETTINGS_CHANGE_KEYS.GAMEPLAY_NEXT_CHECKPOINT_GLOW_INTENSITY));
        assert.ok(applyResult.changedKeys.includes(SETTINGS_CHANGE_KEYS.RECORDING_PROFILE));
        assert.ok(applyResult.changedKeys.includes(SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_NORMAL));
        assert.equal(settings.localSettings.shadowQuality, 1);
        assert.equal(settings.localSettings.startSetup.arcadeGhostDuelMode, 'self_longest_ghost');
        assert.equal(settings.localSettings.startSetup.arcadeGhostTrailCollisionEnabled, true);
        assert.equal(settings.gameplay.nextCheckpointGlowIntensity, 1.25);
        assert.equal(settings.recording.profile, 'youtube_short');
        assert.equal(settings.recording.hudMode, 'with_hud');
        assert.equal(settings.cameraPerspective.normal, 'cinematic_action');
        assert.equal(settings.cameraPerspective.reduceMotion, false);
        assert.equal(settings.cameraPerspective.speedFovIntensity, 0.45);
    });
});

test('Menu presets discard unknown setting paths before storage and application', () => {
    const pollutedProperty = '__settingsManagerPresetPolluted';
    const maliciousStoreRecord = JSON.parse(`{
        "schemaVersion": "menu-preset-store.v1",
        "presets": [{
            "id": "tampered-preset",
            "name": "Tampered Preset",
            "metadata": {
                "id": "tampered-preset",
                "kind": "open",
                "ownerId": "owner"
            },
            "values": {
                "gameplay.speed": 20,
                "localSettings.ownerId": "attacker",
                "__proto__.${pollutedProperty}": true
            }
        }]
    }`);
    const storagePlatform = createMemoryStoragePlatform({
        [STORAGE_KEYS.menuPresets]: maliciousStoreRecord,
    });
    const manager = new SettingsManager({ storagePlatform });
    const settings = manager.createDefaultSettings();
    const originalOwnerId = settings.localSettings.ownerId;

    delete Object.prototype[pollutedProperty];
    try {
        const result = manager.applyMenuPreset(settings, 'tampered-preset');
        const persistedPreset = manager.listMenuPresets()
            .find((preset) => preset.id === 'tampered-preset');

        assert.equal(result.success, true);
        assert.deepEqual(result.appliedPaths, ['gameplay.speed']);
        assert.equal(settings.localSettings.ownerId, originalOwnerId);
        assert.equal(Object.prototype[pollutedProperty], undefined);
        assert.deepEqual(persistedPreset?.values, { 'gameplay.speed': 20 });
    } finally {
        delete Object.prototype[pollutedProperty];
    }
});

test('Settings diff maps uppercase player slot paths to UI change keys', () => {
    const before = {
        invertPitch: { PLAYER_1: true, PLAYER_2: true },
        cockpitCamera: { PLAYER_1: true, PLAYER_2: true },
        vehicles: { PLAYER_1: 'ship5', PLAYER_2: 'ship8' },
    };
    const after = {
        invertPitch: { PLAYER_1: false, PLAYER_2: true },
        cockpitCamera: { PLAYER_1: true, PLAYER_2: false },
        vehicles: { PLAYER_1: 'ship7', PLAYER_2: 'ship9' },
    };

    const diff = diffSettingsSnapshots(before, after);

    assert.deepEqual(diff.changedKeys.sort(), [
        SETTINGS_CHANGE_KEYS.RULES_COCKPIT_P2,
        SETTINGS_CHANGE_KEYS.RULES_INVERT_P1,
        SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_1,
        SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_2,
    ].sort());
});

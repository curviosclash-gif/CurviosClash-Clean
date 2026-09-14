import assert from 'node:assert/strict';
import test from 'node:test';

import { SettingsManager } from '../src/core/SettingsManager.js';
import { SETTINGS_CHANGE_KEYS } from '../src/composition/core-ui/CoreSettingsPorts.js';

import {
    createMemoryStoragePlatform,
    createOwnerAccessContext,
} from './helpers/settings-manager-contract-test-utils.mjs';

// Public SettingsManager methods that had no test coverage at all. Each one gets a success
// case and a failure or edge case, so a later refactor of the facades cannot quietly change
// what the runtime gets back.

function createManager(options = {}) {
    return new SettingsManager({
        storagePlatform: createMemoryStoragePlatform(),
        ...options,
    });
}

function createPlayerContext() {
    return createOwnerAccessContext({
        actorId: 'player',
        isOwner: false,
        developerModeEnabled: false,
        expertModeUnlocked: false,
    });
}

test('SettingsManager cloneDefaultControls returns an independent control snapshot', () => {
    const manager = createManager();
    const defaults = manager.createDefaultSettings();

    const controls = manager.cloneDefaultControls();
    const secondControls = manager.cloneDefaultControls();
    controls.PLAYER_1.UP = 'KeyT';

    assert.deepEqual(secondControls, defaults.controls);
    assert.notEqual(secondControls.PLAYER_1.UP, 'KeyT');
    assert.equal(typeof controls.GLOBAL.CINEMATIC_TOGGLE, 'string');
});

test('SettingsManager deleteMenuPreset removes an own preset and reports the change keys', () => {
    const manager = createManager();
    const settings = manager.createDefaultSettings();
    const accessContext = createOwnerAccessContext();

    manager.saveMenuPreset(settings, { kind: 'open', id: 'surface-preset', name: 'Surface' }, accessContext);
    const beforeDelete = manager.listMenuPresets().some((preset) => preset.id === 'surface-preset');
    const result = manager.deleteMenuPreset('surface-preset', settings, accessContext);

    assert.equal(beforeDelete, true);
    assert.equal(result.success, true);
    assert.equal(result.reason, 'deleted');
    assert.ok(result.changedKeys.includes(SETTINGS_CHANGE_KEYS.PRESET_LIST));
    assert.equal(result.metadata?.presetId, 'surface-preset');
    assert.equal(manager.listMenuPresets().some((preset) => preset.id === 'surface-preset'), false);
});

test('SettingsManager deleteMenuPreset refuses unknown ids and catalog presets', () => {
    const manager = createManager();
    const settings = manager.createDefaultSettings();
    const accessContext = createOwnerAccessContext();
    const catalogPresetId = manager.listMenuPresets()[0]?.id;

    const unknown = manager.deleteMenuPreset('does-not-exist', settings, accessContext);
    const catalog = manager.deleteMenuPreset(catalogPresetId, settings, accessContext);
    const empty = manager.deleteMenuPreset('   ', settings, accessContext);

    assert.equal(typeof catalogPresetId, 'string');
    assert.equal(unknown.success, false);
    assert.equal(unknown.reason, 'preset_not_found');
    assert.deepEqual(unknown.changedKeys, []);
    assert.equal(unknown.metadata, null);
    assert.equal(catalog.success, false);
    assert.equal(catalog.reason, 'catalog_fixed_locked');
    assert.equal(empty.success, false);
    assert.equal(empty.reason, 'invalid_preset_id');
    assert.equal(manager.listMenuPresets().some((preset) => preset.id === catalogPresetId), true);
});

test('SettingsManager player record port follows the active profile manager', () => {
    const manager = createManager();
    const profilePort = Object.freeze({ loadJsonRecord: () => ({ profile: true }) });
    const profileManager = { getActiveRecordStorePort: () => profilePort };

    const fallbackPort = manager.getPlayerRecordStorePort();
    assert.equal(fallbackPort, manager.getSettingsRecordStorePort());

    const boundPort = manager.setPlayerProfileManager(profileManager);
    assert.equal(boundPort, profilePort);
    assert.equal(manager.getPlayerRecordStorePort(), profilePort);

    const resetPort = manager.setPlayerProfileManager(null);
    assert.equal(resetPort, manager.getSettingsRecordStorePort());
    assert.equal(manager.getPlayerRecordStorePort(), manager.getSettingsRecordStorePort());
});

test('SettingsManager player record port falls back when the profile manager has no port', () => {
    const manager = createManager();

    const port = manager.setPlayerProfileManager({ name: 'without-port' });

    assert.equal(port, manager.getSettingsRecordStorePort());
});

test('SettingsManager telemetry preferences default to enabled collection and persist a change', () => {
    const manager = createManager();

    const initialPreferences = manager.getTelemetryPreferences();
    const disableResult = manager.setTelemetryCollectionEnabled(false);
    const disabledPreferences = manager.getTelemetryPreferences();
    const enableResult = manager.setTelemetryCollectionEnabled(true);

    assert.equal(initialPreferences.collectionEnabled, true);
    assert.equal(disableResult.collectionEnabled, false);
    assert.equal(disableResult.saved, true);
    assert.equal(disabledPreferences.collectionEnabled, false);
    assert.equal(typeof disabledPreferences.updatedAt, 'string');
    assert.equal(enableResult.collectionEnabled, true);
    assert.equal(manager.getTelemetryPreferences().collectionEnabled, true);
});

test('SettingsManager telemetry collection treats non-boolean input as disabled', () => {
    const manager = createManager();

    const result = manager.setTelemetryCollectionEnabled('yes');

    assert.equal(result.collectionEnabled, false);
    assert.equal(manager.getTelemetryPreferences().collectionEnabled, false);
});

test('SettingsManager telemetry history summary is delegated to the history store', () => {
    const manager = createManager({
        telemetryHistoryStore: {
            getSummary: (filters) => ({ rounds: 3, filters }),
        },
    });

    const summary = manager.getTelemetryHistorySummary({ mapKey: 'maze' });

    assert.deepEqual(summary, { rounds: 3, filters: { mapKey: 'maze' } });
});

test('SettingsManager telemetry history summary is empty without a capable store', () => {
    const manager = createManager({ telemetryHistoryStore: {} });

    assert.deepEqual(manager.getTelemetryHistorySummary(), {});
    assert.deepEqual(manager.getTelemetryHistorySummary({ mapKey: 'maze' }), {});
});

test('SettingsManager telemetry export bundles preferences, history and authoring data', async () => {
    const historyEntries = [{ at: '2026-01-01T00:00:00.000Z', mapKey: 'maze' }];
    const manager = createManager({
        telemetryHistoryStore: {
            getEntries: async () => historyEntries,
            summarizeEntries: (entries) => ({ count: entries.length }),
        },
    });
    manager.setTelemetryCollectionEnabled(false);

    const snapshot = await manager.getTelemetryExportSnapshot({ mapKey: 'maze' });

    assert.equal(snapshot.schemaVersion, 'curviosclash-telemetry-export.v1');
    assert.equal(typeof snapshot.exportedAt, 'string');
    assert.deepEqual(snapshot.filters, { mapKey: 'maze' });
    assert.equal(snapshot.preferences.collectionEnabled, false);
    assert.deepEqual(snapshot.historyEntries, historyEntries);
    assert.deepEqual(snapshot.historySummary, { count: 1 });
    assert.equal(typeof snapshot.gameplay.quickStartCount, 'number');
});

test('SettingsManager telemetry export stays valid without a history store', async () => {
    const manager = createManager({ telemetryHistoryStore: {} });

    const snapshot = await manager.getTelemetryExportSnapshot();

    assert.deepEqual(snapshot.historyEntries, []);
    assert.deepEqual(snapshot.historySummary, {});
    assert.deepEqual(snapshot.filters, {});
});

test('SettingsManager setDeveloperActor requires the owner and falls back to the owner id', () => {
    const manager = createManager();
    const settings = manager.createDefaultSettings();

    const updated = manager.setDeveloperActor(settings, 'tester', createOwnerAccessContext());
    const actorAfterUpdate = settings.localSettings.actorId;
    const reset = manager.setDeveloperActor(settings, '   ', createOwnerAccessContext());
    const denied = manager.setDeveloperActor(settings, 'intruder', createPlayerContext());

    assert.equal(updated.success, true);
    assert.equal(updated.reason, 'updated');
    assert.deepEqual(updated.changedKeys, [SETTINGS_CHANGE_KEYS.DEVELOPER_ACTOR_ID]);
    assert.equal(actorAfterUpdate, 'tester');
    assert.equal(reset.success, true);
    assert.equal(settings.localSettings.actorId, settings.localSettings.ownerId);
    assert.equal(denied.success, false);
    assert.equal(denied.reason, 'owner_required');
    assert.equal(settings.localSettings.actorId, settings.localSettings.ownerId);
});

test('SettingsManager setDeveloperFixedPresetLock toggles the lock only for allowed actors', () => {
    const manager = createManager();
    const settings = manager.createDefaultSettings();

    const enabled = manager.setDeveloperFixedPresetLock(settings, true, createOwnerAccessContext());
    const lockAfterEnable = settings.localSettings.fixedPresetLockEnabled;
    const denied = manager.setDeveloperFixedPresetLock(settings, false, createPlayerContext());

    assert.equal(enabled.success, true);
    assert.equal(enabled.reason, 'updated');
    assert.deepEqual(enabled.changedKeys, [SETTINGS_CHANGE_KEYS.DEVELOPER_FIXED_PRESET_LOCK]);
    assert.equal(lockAfterEnable, true);
    assert.equal(denied.success, false);
    assert.equal(denied.reason, 'owner_required');
    assert.equal(settings.localSettings.fixedPresetLockEnabled, true);
});

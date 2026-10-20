import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { CONFIG } from '../src/core/Config.js';
import { SettingsManager } from '../src/core/SettingsManager.js';
import { PlayerProfileManager } from '../src/application/player-profile/PlayerProfileManager.js';
import { GAME_STATE_IDS } from '../src/shared/contracts/GameStateIds.js';
import { ProfileManager } from '../src/core/ProfileManager.js';
import { GameRuntimeMenuActionHandler } from '../src/core/runtime/GameRuntimeMenuActionHandler.js';
import { GameRuntimeSettingsHandler } from '../src/core/runtime/GameRuntimeSettingsHandler.js';
import { createSessionSettingsRestorePlan } from '../src/core/runtime/SessionSettingsRestorePlan.js';
import { STORAGE_KEYS } from '../src/shared/storage/StorageKeys.js';
import { ProfileUiController } from '../src/ui/ProfileUiController.js';

registerHooks({
    load(url, context, nextLoad) {
        if (url.endsWith('.css')) {
            return { format: 'module', source: 'export default "";', shortCircuit: true };
        }
        return nextLoad(url, context);
    },
});
const previousWindow = globalThis.window;
const previousDocument = globalThis.document;
globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { search: '' } };
globalThis.document = { readyState: 'loading', addEventListener() {} };
const { Game } = await import('../src/core/main.js');
if (previousWindow === undefined) delete globalThis.window;
else globalThis.window = previousWindow;
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

function createSaveHarness({
    rejectSettingsWrites = false,
    settingsWriteErrorName = 'QuotaExceededError',
    settingsWriteErrorMessage = 'quota exceeded',
} = {}) {
    const records = new Map();
    let rejectSettings = rejectSettingsWrites;
    let settingsWrites = 0;
    const storage = {
        getItem(key) {
            return records.get(key) ?? null;
        },
        setItem(key, value) {
            if (key === STORAGE_KEYS.settings) {
                settingsWrites += 1;
                if (rejectSettings) {
                    const error = new Error(settingsWriteErrorMessage);
                    error.name = settingsWriteErrorName;
                    throw error;
                }
            }
            records.set(String(key), String(value));
        },
        removeItem(key) {
            records.delete(key);
        },
    };
    const settingsManager = new SettingsManager({ storage });
    const toasts = [];
    const game = Object.create(Game.prototype);
    game.settingsManager = settingsManager;
    game.settings = settingsManager.loadSettings();
    game.settingsDirty = true;
    const settingsHandler = new GameRuntimeSettingsHandler({ facade: { game } });
    game.runtimeCoordinator = {
        getRuntimeFacade: () => ({ settingsHandler }),
        getUiManager: () => ({ showToast: (...args) => toasts.push(args) }),
        markSettingsDirty: (dirty) => { game.settingsDirty = dirty; },
    };
    const menuActionHandler = new GameRuntimeMenuActionHandler({ facade: { game } });
    return {
        game,
        menuActionHandler,
        records,
        settingsManager,
        settingsHandler,
        toasts,
        get settingsWrites() { return settingsWrites; },
        set rejectSettingsWrites(value) { rejectSettings = value; },
    };
}

function createBorrowedSettings(settingsManager) {
    const baseline = settingsManager.createDefaultSettings();
    const transient = structuredClone(baseline);
    const borrowedMapKey = Object.keys(CONFIG.MAPS).find((mapKey) => mapKey !== baseline.mapKey);
    assert.ok(borrowedMapKey, 'there is a valid map key for the temporary session snapshot');
    transient.mapKey = borrowedMapKey;
    return { baseline, transient, plan: createSessionSettingsRestorePlan(baseline, transient) };
}

test('explicit settings save keeps quota failures dirty, retries, and persists the restored snapshot', () => {
    const harness = createSaveHarness({ rejectSettingsWrites: true });
    const { baseline, transient, plan } = createBorrowedSettings(harness.settingsManager);
    harness.settingsHandler.holdSessionSettingsRestore(plan);
    harness.game.settings = transient;

    const failed = harness.menuActionHandler.saveKeys();
    assert.equal(failed.success, false);
    assert.equal(failed.reason, 'quota_exceeded');
    assert.equal(harness.game.settingsDirty, true);
    assert.equal(harness.toasts.some(([message, , tone]) => tone === 'error' && message.includes('Speicher')), true);
    assert.equal(harness.toasts.some(([message]) => message === 'Einstellungen gespeichert'), false);
    assert.equal(harness.settingsWrites, 1);

    harness.rejectSettingsWrites = false;
    const saved = harness.menuActionHandler.saveKeys();
    assert.equal(saved.success, true);
    assert.equal(harness.game.settingsDirty, false);
    assert.deepEqual(JSON.parse(harness.records.get(STORAGE_KEYS.settings)).mapKey, baseline.mapKey);
    assert.equal(harness.game.settings.mapKey, transient.mapKey,
        'persisting the player snapshot does not overwrite the temporary live map selection');
    assert.equal(harness.toasts.at(-1)[0], 'Einstellungen gespeichert');
    assert.equal(harness.toasts.at(-1)[2], 'info');
    assert.equal(harness.settingsWrites, 2);
});

test('a missing persistable snapshot stays dirty, reports failure, and does not write', () => {
    const harness = createSaveHarness();
    const { transient, plan } = createBorrowedSettings(harness.settingsManager);
    harness.settingsHandler.holdSessionSettingsRestore(plan);
    transient.unsupportedForPersistence = () => {};
    harness.game.settings = transient;
    assert.equal(harness.settingsHandler.createPersistableSettingsSnapshot(transient), null,
        'the real session snapshot path rejects data that structuredClone cannot persist');
    harness.game.settingsDirty = false;
    const writesBefore = harness.settingsWrites;

    const result = harness.menuActionHandler.saveKeys();
    assert.deepEqual(result, { success: false, reason: 'settings_snapshot_unavailable' });
    assert.equal(harness.game.settingsDirty, true);
    assert.equal(harness.settingsWrites, writesBefore);
    assert.equal(harness.toasts.some(([message, , tone]) => tone === 'error' && message.includes('gespeichert')), true);
    assert.equal(harness.toasts.some(([message]) => message === 'Einstellungen gespeichert'), false);
});

test('profile activation keeps a denied settings save visible and retries before reloading', async () => {
    const harness = createSaveHarness({
        rejectSettingsWrites: true,
        settingsWriteErrorName: 'SecurityError',
        settingsWriteErrorMessage: 'storage denied',
    });
    const profileManager = new ProfileManager(harness.settingsManager.getProfileStorePort());
    const profileSettings = harness.settingsManager.createDefaultSettings();
    const initialMapKey = profileSettings.mapKey;
    profileSettings.mapKey = Object.keys(CONFIG.MAPS).find((mapKey) => mapKey !== initialMapKey);
    assert.ok(profileSettings.mapKey);
    assert.equal(profileManager.saveProfile('Activation target', profileSettings, profileManager.getActiveProfileName()).success, true);

    let profileIdSequence = 40;
    const playerProfileManager = new PlayerProfileManager({
        recordStore: harness.settingsManager.getSettingsRecordStorePort(),
        getPreferredSettingsProfileName: () => profileManager.getActiveProfileName(),
        createId: () => `00000000-0000-4000-8000-${String(++profileIdSequence).padStart(12, '0')}`,
    });
    assert.equal(playerProfileManager.bootstrap().ok, true);
    const targetProfile = playerProfileManager.createProfile('Activation target').profile;
    harness.settingsManager.setPlayerProfileManager(playerProfileManager);
    harness.game.playerProfileManager = playerProfileManager;
    harness.game.profileManager = profileManager;
    harness.game.state = GAME_STATE_IDS.MENU;
    harness.game.runtimeCoordinator.onSettingsChanged = () => {};
    harness.game.profileUiController = new ProfileUiController({
        profileManager,
        settingsManager: harness.settingsManager,
        getUi: () => ({}),
        getUiManager: () => null,
        getSettings: () => harness.game.settings,
        setSettings: (settings) => { harness.game.settings = settings; },
        showStatusToast: (...args) => harness.game._showStatusToast(...args),
        onSettingsChanged: () => harness.game._onSettingsChanged(),
        markSettingsDirty: (dirty) => harness.game._markSettingsDirty(dirty),
        profileDataOps: profileManager.getProfileDataOps(),
        profileControlStateOps: profileManager.getProfileControlStateOps(),
        profileUiStateOps: profileManager.getProfileUiStateOps(),
    });

    const originalSetTimeout = globalThis.setTimeout;
    const originalLocation = globalThis.location;
    const reloadJobs = [];
    let reloadCount = 0;
    globalThis.setTimeout = (callback, delay) => {
        reloadJobs.push({ callback, delay });
        return reloadJobs.length;
    };
    globalThis.location = { reload: () => { reloadCount += 1; } };
    try {
        const failed = await harness.game._activatePlayerProfile(targetProfile.id);
        assert.equal(failed.ok, false);
        assert.equal(failed.reason, 'settings_persistence_failed');
        assert.equal(failed.activeProfileChanged, true);
        assert.equal(failed.profileId, targetProfile.id);
        assert.equal(failed.persistenceResult.success, false);
        assert.equal(failed.persistenceResult.reason, 'storage_failed');
        assert.equal(playerProfileManager.getActiveProfile().id, targetProfile.id,
            'the already-persisted active-profile change is reported, not rolled back');
        assert.equal(harness.game.settings.mapKey, profileSettings.mapKey,
            'the selected settings remain live and accessible after the failed save');
        assert.equal(harness.records.has(STORAGE_KEYS.settings), false,
            'the denied write leaves the prior persisted settings untouched');
        assert.equal(harness.game.settingsDirty, true);
        assert.equal(harness.toasts.at(-1)[2], 'error');
        assert.equal(harness.toasts.some(([message]) => message.startsWith('Spielerprofil wird geladen:')), false);
        assert.equal(reloadJobs.length, 0);
        assert.equal(reloadCount, 0);

        harness.rejectSettingsWrites = false;
        const saved = await harness.game._activatePlayerProfile(targetProfile.id);
        assert.equal(saved.ok, true);
        assert.equal(harness.game.settingsDirty, false);
        assert.equal(harness.game.settings.mapKey, profileSettings.mapKey);
        assert.equal(JSON.parse(harness.records.get(STORAGE_KEYS.settings)).mapKey, profileSettings.mapKey);
        assert.equal(harness.toasts.at(-1)[0], `Spielerprofil wird geladen: ${targetProfile.displayName}`);
        assert.equal(reloadJobs.length, 1);
        assert.equal(reloadJobs[0].delay, 40);
        reloadJobs[0].callback();
        assert.equal(reloadCount, 1);
    } finally {
        globalThis.setTimeout = originalSetTimeout;
        if (originalLocation === undefined) delete globalThis.location;
        else globalThis.location = originalLocation;
    }
});

test('explicit save preserves the legacy success result while a missing save hook fails closed', () => {
    const toasts = [];
    const handler = new GameRuntimeMenuActionHandler({ facade: { game: {
        _saveSettings: () => undefined,
        _showStatusToast: (...args) => toasts.push(args),
    } } });

    assert.equal(handler.saveKeys(), undefined);
    assert.deepEqual(toasts, [['Einstellungen gespeichert']]);

    const missingHandler = new GameRuntimeMenuActionHandler({ facade: { game: {
        _showStatusToast: (...args) => toasts.push(args),
    } } });
    assert.deepEqual(missingHandler.saveKeys(), { success: false, reason: 'settings_save_unavailable' });
    assert.equal(toasts.at(-1)[2], 'error');
});

test('a background autosave repeats a known save failure silently, an explicit save always reports it', async () => {
    const { persistGameSettings } = await import('../src/core/settings/SettingsSaveOps.js');
    const toasts = [];
    let result = { success: false, reason: 'quota_exceeded' };
    const settingsManager = { saveSettings: () => result };
    let dirty = false;
    const save = (explicit = false) => persistGameSettings({
        settings: { mapKey: 'standard' },
        settingsManager,
        markDirty: (value) => { dirty = value; },
        showToast: (message) => toasts.push(message),
        explicit,
    });

    save();
    save();
    assert.equal(toasts.length, 1, 'the same failure is not announced on every autosave');
    assert.equal(dirty, true, 'a silent repeat still keeps the settings dirty');
    save(true);
    assert.equal(toasts.length, 2, 'an explicit save always answers the player');
    result = { success: false, reason: 'storage_unavailable' };
    save();
    assert.equal(toasts.length, 3, 'a new failure reason is announced');
    result = { success: true };
    save();
    assert.equal(dirty, false);
    result = { success: false, reason: 'storage_unavailable' };
    save();
    assert.equal(toasts.length, 4, 'after a success the next failure is announced again');
});
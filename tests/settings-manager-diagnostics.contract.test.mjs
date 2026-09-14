import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { SETTINGS_CHANGE_KEYS } from '../src/composition/core-ui/CoreSettingsPorts.js';
import { SettingsManager } from '../src/core/SettingsManager.js';
import { createSettingsSessionDraftFacade } from '../src/core/settings/SettingsSessionDraftFacade.js';
import { SettingsStore } from '../src/shared/settings/SettingsStore.js';
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
    source.localSettings.bloomQuality = 2;
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
    target.localSettings.bloomQuality = 0;
    target.localSettings.startSetup.arcadeGhostDuelMode = 'off';
    target.localSettings.startSetup.arcadeGhostTrailCollisionEnabled = false;
    target.recording.profile = 'standard';
    target.recording.hudMode = 'clean';
    target.cameraPerspective.normal = 'classic';
    target.cameraPerspective.reduceMotion = true;
    target.cameraPerspective.speedFovIntensity = 1;

    assert.equal(applyMenuConfigPayload(target, exported.payload), true);
    assert.equal(target.localSettings.shadowQuality, 1);
    assert.equal(target.localSettings.bloomQuality, 2);
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

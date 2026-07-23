import assert from 'node:assert/strict';
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


import {
    createMemoryStoragePlatform,
    createOwnerAccessContext,
    createMemoryBrowserStorage,
    withMockLocalStorage,
    readProductiveSourceFiles,
} from './helpers/settings-manager-contract-test-utils.mjs';
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

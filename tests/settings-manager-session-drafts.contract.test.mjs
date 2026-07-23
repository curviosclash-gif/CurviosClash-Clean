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

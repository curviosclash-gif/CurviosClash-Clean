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

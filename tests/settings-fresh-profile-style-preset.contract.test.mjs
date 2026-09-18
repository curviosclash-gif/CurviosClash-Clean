import assert from 'node:assert/strict';
import test from 'node:test';

import { SettingsManager } from '../src/core/SettingsManager.js';
import { MENU_DEFAULT_EDITOR_CONFIG } from '../src/ui/menu/MenuDefaultsEditorConfig.js';
import { STORAGE_KEYS } from '../src/shared/storage/StorageKeys.js';

import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';

function findFixedPreset(presetId) {
    return MENU_DEFAULT_EDITOR_CONFIG.fixedPresets.find((preset) => preset.id === presetId);
}

test('a profile without stored settings starts with the defaults plus its style preset', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const defaults = manager.createDefaultSettings();
    const settings = manager.loadSettings();
    const preset = findFixedPreset('fight-standard');
    assert.equal(settings.localSettings.modePath, 'fight');
    assert.equal(settings.gameplay.speed, preset.values['gameplay.speed']);
    assert.equal(settings.gameplay.itemAmount, preset.values['gameplay.itemAmount']);
    assert.equal(settings.mapKey, preset.values.mapKey);
    // Values the preset does not carry stay on the defaults, bot difficulty stays the player's.
    assert.equal(settings.gameplay.planeScale, defaults.gameplay.planeScale);
    assert.equal(settings.botDifficulty, defaults.botDifficulty);
    // The style counts as seeded, so the first style click keeps these values (A1).
    assert.deepEqual(settings.localSettings.seededModePaths, ['fight']);
});

test('stored settings load as stored, without a preset on top', () => {
    const seed = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const stored = seed.createDefaultSettings();
    stored.gameplay.speed = 33;
    const manager = new SettingsManager({
        storagePlatform: createMemoryStoragePlatform({ [STORAGE_KEYS.settings]: stored }),
    });
    const settings = manager.loadSettings();
    assert.equal(settings.gameplay.speed, 33);
    assert.deepEqual(settings.localSettings.seededModePaths, []);
});

test('the defaults snapshot itself stays free of any preset', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    assert.notEqual(manager.createDefaultSettings().gameplay.speed, findFixedPreset('fight-standard').values['gameplay.speed']);
});

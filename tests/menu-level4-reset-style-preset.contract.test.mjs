import assert from 'node:assert/strict';
import test from 'node:test';

import { SETTINGS_CHANGE_KEYS } from '../src/shared/settings/SettingsChangeKeys.js';
import { handleLevel4ResetAction } from '../src/core/runtime/MenuRuntimeSessionService.js';
import { MENU_DEFAULT_EDITOR_CONFIG, createMenuSettingsDefaults as createDefaultSettings } from '../src/ui/menu/MenuDefaultsEditorConfig.js';

function findFixedPreset(presetId) {
    return MENU_DEFAULT_EDITOR_CONFIG.fixedPresets.find((preset) => preset.id === presetId);
}

function createGame(modePath) {
    const defaults = createDefaultSettings();
    const calls = { changed: [], toasts: [] };
    const game = {
        settings: {
            ...createDefaultSettings(),
            mapKey: 'complex',
            numBots: 6,
            gameplay: { ...defaults.gameplay, speed: 33, itemAmount: 44, planeScale: 1.7, fightPlayerHp: 250 },
            localSettings: { ...defaults.localSettings, modePath },
            matchSettings: { activePresetId: 'chaos', activePresetKind: 'fixed', activePresetSourceId: 'chaos' },
        },
        settingsManager: {
            createDefaultSettings,
            listMenuPresets: () => MENU_DEFAULT_EDITOR_CONFIG.fixedPresets,
        },
        _showStatusToast: (message) => calls.toasts.push(message),
    };
    return { game, calls, defaults };
}

function reset(game, calls) {
    handleLevel4ResetAction({ game, onSettingsChanged: (payload) => calls.changed.push(payload) });
}

test('resetting in fight gives the values of a fresh fight profile', () => {
    const { game, calls, defaults } = createGame('fight');
    reset(game, calls);
    const preset = findFixedPreset('fight-standard');
    assert.equal(game.settings.gameplay.speed, preset.values['gameplay.speed']);
    assert.equal(game.settings.gameplay.itemAmount, preset.values['gameplay.itemAmount']);
    assert.equal(game.settings.gameplay.fightMgDamage, preset.values['gameplay.fightMgDamage']);
    // Values the preset does not carry fall back to the defaults.
    assert.equal(game.settings.gameplay.planeScale, defaults.gameplay.planeScale);
    assert.equal(game.settings.gameplay.fightPlayerHp, defaults.gameplay.fightPlayerHp);
});

test('resetting follows the current game style', () => {
    const { game, calls } = createGame('arcade');
    reset(game, calls);
    assert.equal(game.settings.gameplay.speed, findFixedPreset('arcade').values['gameplay.speed']);
});

test('resetting leaves map and bots alone and clears the active preset', () => {
    const { game, calls } = createGame('fight');
    reset(game, calls);
    assert.equal(game.settings.mapKey, 'complex');
    assert.equal(game.settings.numBots, 6);
    assert.equal(game.settings.matchSettings.activePresetId, '');
    assert.equal(game.settings.matchSettings.activePresetKind, '');
    assert.ok(calls.changed[0].changedKeys.includes(SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_ID));
});

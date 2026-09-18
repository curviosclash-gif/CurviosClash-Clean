import assert from 'node:assert/strict';
import test from 'node:test';

import { handleModePathChangeAction, MODE_PATH_TO_PRESET_ID } from '../src/core/runtime/MenuRuntimeSessionService.js';
import { MENU_DEFAULT_EDITOR_CONFIG } from '../src/ui/menu/MenuDefaultsEditorConfig.js';
import { ensureMenuContractState } from '../src/ui/menu/MenuStateContracts.js';
import { PLATFORM_PRODUCT_SURFACE_IDS } from '../src/shared/contracts/PlatformCapabilityRegistry.js';

function findFixedPreset(presetId) {
    return MENU_DEFAULT_EDITOR_CONFIG.fixedPresets.find((preset) => preset.id === presetId) || null;
}

function createGame({ modePath, seededModePaths } = {}) {
    const calls = { settingsChanged: [], toasts: [], appliedPresets: [] };
    const localSettings = { sessionType: 'single', modePath };
    if (seededModePaths) localSettings.seededModePaths = seededModePaths;
    const game = {
        settings: {
            mode: '1p',
            gameMode: modePath === 'fight' ? 'HUNT' : 'CLASSIC',
            mapKey: 'standard',
            numBots: 2,
            botDifficulty: 'NORMAL',
            winsNeeded: 5,
            hunt: { respawnEnabled: modePath === 'fight' },
            gameplay: { speed: 33, itemAmount: 44, fightPlayerHp: 250 },
            localSettings,
        },
        settingsManager: {
            // Mirrors the production facade: a preset writes its values onto settings.
            applyMenuPreset(settings, presetId) {
                const preset = findFixedPreset(presetId);
                if (!preset) return { success: false, reason: 'preset_not_found', changedKeys: [] };
                calls.appliedPresets.push(presetId);
                for (const [key, value] of Object.entries(preset.values)) {
                    const [head, tail] = key.split('.');
                    if (tail) {
                        settings[head] = { ...(settings[head] || {}), [tail]: value };
                    } else {
                        settings[key] = value;
                    }
                }
                return { success: true, reason: 'applied', changedKeys: [] };
            },
        },
        uiManager: {
            _runtimeFeatureFlags: {
                surfacePolicy: { productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP },
            },
            menuNavigationRuntime: { showPanel() {} },
        },
        _showStatusToast(message, duration, tone) { calls.toasts.push({ message, duration, tone }); },
    };
    return { game, calls };
}

function clickModePath(game, calls, modePath) {
    handleModePathChangeAction({
        game,
        event: { modePath },
        onSettingsChanged: (payload) => calls.settingsChanged.push(payload),
        resolveMenuAccessContext: () => ({ isOwner: true }),
    });
}

test('the fight preset would overwrite the tuned speed and item amount', () => {
    // Premise of the tests below: applying the preset changes these values.
    const preset = findFixedPreset(MODE_PATH_TO_PRESET_ID.fight);
    assert.notEqual(preset.values['gameplay.speed'], 33);
    assert.notEqual(preset.values['gameplay.itemAmount'], 44);
});

test('clicking the current game style keeps the tuned values', () => {
    const { game, calls } = createGame({ modePath: 'fight' });
    clickModePath(game, calls, 'fight');
    assert.deepEqual(calls.appliedPresets, []);
    assert.equal(game.settings.gameplay.speed, 33);
    assert.equal(game.settings.gameplay.itemAmount, 44);
    assert.equal(game.settings.gameMode, 'HUNT');
});

test('switching to an unused game style applies its preset and remembers it', () => {
    const { game, calls } = createGame({ modePath: 'normal' });
    clickModePath(game, calls, 'fight');
    assert.deepEqual(calls.appliedPresets, ['fight-standard']);
    assert.equal(game.settings.gameplay.speed, findFixedPreset('fight-standard').values['gameplay.speed']);
    assert.deepEqual(game.settings.localSettings.seededModePaths, ['fight']);
});

test('returning to a game style that already has own values keeps them and points to the preset', () => {
    const { game, calls } = createGame({ modePath: 'arcade', seededModePaths: ['fight', 'arcade'] });
    clickModePath(game, calls, 'fight');
    assert.deepEqual(calls.appliedPresets, []);
    assert.equal(game.settings.gameplay.speed, 33);
    assert.equal(game.settings.localSettings.modePath, 'fight');
    assert.equal(game.settings.gameMode, 'HUNT');
    assert.match(calls.toasts.at(-1).message, /Vorlage/);
});

test('the seeded game styles survive settings normalization', () => {
    const settings = ensureMenuContractState({
        localSettings: { modePath: 'fight', seededModePaths: ['fight', 'bogus', 'arcade', 'fight'] },
    });
    assert.deepEqual(settings.localSettings.seededModePaths, ['fight', 'arcade']);
    assert.deepEqual(ensureMenuContractState({}).localSettings.seededModePaths, []);
});

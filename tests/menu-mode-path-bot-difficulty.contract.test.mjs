import assert from 'node:assert/strict';
import test from 'node:test';

import { handleModePathChangeAction, MODE_PATH_TO_PRESET_ID } from '../src/core/runtime/MenuRuntimeSessionService.js';
import { MENU_DEFAULT_EDITOR_CONFIG } from '../src/ui/menu/MenuDefaultsEditorConfig.js';
import { PLATFORM_PRODUCT_SURFACE_IDS } from '../src/shared/contracts/PlatformCapabilityRegistry.js';

function findFixedPreset(presetId) {
    return MENU_DEFAULT_EDITOR_CONFIG.fixedPresets.find((preset) => preset.id === presetId) || null;
}

function createModePathGame(botDifficulty) {
    const calls = { settingsChanged: [], toasts: [], panels: [] };
    const game = {
        settings: {
            mode: '1p',
            gameMode: 'CLASSIC',
            mapKey: 'standard',
            numBots: 2,
            botDifficulty,
            botPolicyStrategy: 'rule-based',
            winsNeeded: 5,
            hunt: { respawnEnabled: false },
            localSettings: {
                sessionType: 'single',
                modePath: 'normal',
            },
        },
        settingsManager: {
            // Mirrors the production facade: a preset writes its scalar values onto settings.
            applyMenuPreset(settings, presetId) {
                const preset = findFixedPreset(presetId);
                if (!preset) return { success: false, reason: 'preset_not_found', changedKeys: [] };
                for (const [key, value] of Object.entries(preset.values)) {
                    if (key.includes('.')) continue;
                    settings[key] = value;
                }
                return { success: true, reason: 'applied', changedKeys: [] };
            },
        },
        uiManager: {
            _runtimeFeatureFlags: {
                surfacePolicy: { productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP },
            },
            menuNavigationRuntime: {
                showPanel(panelId, options) { calls.panels.push({ panelId, options }); },
            },
        },
        _showStatusToast(message, duration, tone) { calls.toasts.push({ message, duration, tone }); },
    };
    return { game, calls };
}

function runModePathChange(game, calls, modePath) {
    handleModePathChangeAction({
        game,
        event: { modePath },
        onSettingsChanged: (payload) => calls.settingsChanged.push(payload),
        resolveMenuAccessContext: () => ({ isOwner: true }),
    });
}

test('the mode path preset carries a bot difficulty that could overwrite the player choice', () => {
    // Guards the premise of the test below: without protection the preset would win.
    for (const [modePath, presetId] of Object.entries(MODE_PATH_TO_PRESET_ID)) {
        const preset = findFixedPreset(presetId);
        assert.ok(preset, `fixed preset ${presetId} for mode path ${modePath} exists`);
        assert.ok(
            typeof preset.values.botDifficulty === 'string',
            `preset ${presetId} declares a bot difficulty`,
        );
    }
});

test('choosing a game style keeps the saved bot difficulty', () => {
    for (const modePath of Object.keys(MODE_PATH_TO_PRESET_ID)) {
        const { game, calls } = createModePathGame('HARD');
        runModePathChange(game, calls, modePath);
        assert.equal(
            game.settings.botDifficulty,
            'HARD',
            `mode path ${modePath} must not reset the saved bot difficulty`,
        );
    }
});

test('choosing a game style still applies the rest of its preset', () => {
    const { game, calls } = createModePathGame('HARD');
    runModePathChange(game, calls, 'fight');
    const preset = findFixedPreset(MODE_PATH_TO_PRESET_ID.fight);
    assert.equal(game.settings.numBots, preset.values.numBots);
    assert.equal(game.settings.winsNeeded, preset.values.winsNeeded);
    assert.equal(game.settings.gameMode, 'HUNT');
});

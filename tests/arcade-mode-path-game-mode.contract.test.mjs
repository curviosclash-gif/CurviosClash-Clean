import assert from 'node:assert/strict';
import test from 'node:test';

import { handleModePathChangeAction, MODE_PATH_TO_PRESET_ID } from '../src/core/runtime/MenuRuntimeSessionService.js';
import { resolveMatchStartValidationIssue } from '../src/core/runtime/MatchStartValidationService.js';
import { MENU_DEFAULT_EDITOR_CONFIG } from '../src/ui/menu/MenuDefaultsEditorConfig.js';
import { PLATFORM_PRODUCT_SURFACE_IDS } from '../src/shared/contracts/PlatformCapabilityRegistry.js';
import { createGameModeStrategy } from '../src/modes/GameModeRegistry.js';
import { applyMenuCompatibilityRules } from '../src/ui/menu/MenuCompatibilityRules.js';
import { GAME_MODE_TYPES } from '../src/hunt/HuntMode.js';

function findFixedPreset(presetId) {
    return MENU_DEFAULT_EDITOR_CONFIG.fixedPresets.find((preset) => preset.id === presetId) || null;
}

function createModePathGame() {
    const calls = { settingsChanged: [], toasts: [], panels: [] };
    const game = {
        settings: {
            mode: '1p',
            gameMode: 'CLASSIC',
            mapKey: 'standard',
            numBots: 2,
            botDifficulty: 'NORMAL',
            winsNeeded: 5,
            hunt: { respawnEnabled: false },
            localSettings: {
                sessionType: 'single',
                modePath: 'normal',
            },
        },
        settingsManager: {
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
            menuNavigationRuntime: { showPanel(panelId, options) { calls.panels.push({ panelId, options }); } },
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

test('the arcade mode path selects the arcade game mode', () => {
    const { game, calls } = createModePathGame();
    runModePathChange(game, calls, 'arcade');
    assert.equal(game.settings.localSettings.modePath, 'arcade');
    assert.equal(game.settings.gameMode, GAME_MODE_TYPES.ARCADE);
});

test('the arcade preset itself carries the arcade game mode', () => {
    // The preset is applied inside the mode path handler; a CLASSIC value here would
    // silently win over the handler for anyone applying the preset directly.
    const preset = findFixedPreset(MODE_PATH_TO_PRESET_ID.arcade);
    assert.ok(preset, 'fixed preset for the arcade mode path exists');
    assert.equal(preset.values.gameMode, GAME_MODE_TYPES.ARCADE);
});

test('the normal mode path keeps the classic game mode', () => {
    const { game, calls } = createModePathGame();
    runModePathChange(game, calls, 'normal');
    assert.equal(game.settings.gameMode, GAME_MODE_TYPES.CLASSIC);
});

test('the compatibility rules keep the arcade game mode on the arcade path', () => {
    // This rule runs after every settings change and is the last word on the pairing.
    const settings = {
        gameMode: GAME_MODE_TYPES.ARCADE,
        mapKey: 'parcours_rift',
        hunt: { respawnEnabled: false },
        localSettings: { sessionType: 'single', modePath: 'arcade' },
    };
    applyMenuCompatibilityRules(settings, {});
    assert.equal(settings.gameMode, GAME_MODE_TYPES.ARCADE);
    assert.equal(settings.hunt.respawnEnabled, false);
});

test('the compatibility rules repair a mismatched arcade game mode', () => {
    const settings = {
        gameMode: GAME_MODE_TYPES.HUNT,
        mapKey: 'parcours_rift',
        hunt: { respawnEnabled: true },
        localSettings: { sessionType: 'single', modePath: 'arcade' },
    };
    applyMenuCompatibilityRules(settings, {});
    assert.equal(settings.gameMode, GAME_MODE_TYPES.ARCADE);
});

function createStartSettings(gameMode) {
    return {
        gameMode,
        mapKey: 'parcours_rift',
        vehicles: { PLAYER_1: 'ship5' },
        localSettings: { sessionType: 'single', modePath: 'arcade', themeMode: 'dunkel' },
    };
}

test('match start accepts arcade on the arcade game mode', () => {
    const issue = resolveMatchStartValidationIssue({
        settings: createStartSettings(GAME_MODE_TYPES.ARCADE),
        maps: { parcours_rift: { parcours: { enabled: true } } },
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });
    assert.equal(issue, null);
});

test('match start rejects arcade running on classic', () => {
    const issue = resolveMatchStartValidationIssue({
        settings: createStartSettings(GAME_MODE_TYPES.CLASSIC),
        maps: { parcours_rift: { parcours: { enabled: true } } },
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });
    assert.ok(issue, 'a classic game mode under the arcade path is a start conflict');
    assert.equal(issue.fieldKey, 'match');
});

test('the arcade game mode resolves to the arcade strategy with a health pool', () => {
    const strategy = createGameModeStrategy(GAME_MODE_TYPES.ARCADE);
    assert.equal(strategy.modeType, GAME_MODE_TYPES.ARCADE);
    const player = { hasShield: false };
    strategy.resetPlayerHealth(player);
    assert.ok(player.maxHp > 1, 'arcade players carry a health pool instead of a single hit point');
});

// ============================================
// MenuRuntimeSessionService.js - session/mode/quickstart/level actions
// ============================================

import { CONFIG } from '../Config.js';
import {
    createMenuLevel3ResetDefaults,
    HANGAR_SELECTION_PLAYER_SLOTS,
    LEVEL4_SECTION_IDS,
    writeHangarMapSelection,
    writeHangarVehicleSelection,
} from '../../composition/core-ui/CoreUiMenuPorts.js';
import { SETTINGS_CHANGE_KEYS } from '../../shared/settings/SettingsChangeKeys.js';
import {
    isMapEligibleForModePath,
    resolveModePathFallbackMapKey,
} from '../../shared/contracts/MapModeContract.js';
import { createSurfacePolicyPort } from '../../shared/runtime/SurfacePolicyPort.js';
import { syncMenuSelectionWriteback } from './MenuRuntimePresetConfigService.js';
import { LEVEL4_RESET_SCOPES, applyLevel4Reset, isLevel4ResetSection } from '../../shared/settings/Level4ResetScopes.js';
import { appendMutationChangedKeys } from './RuntimeSettingsChangeKeys.js';
import { resolvePresetFailureMessage } from './MenuRuntimeQuickStartService.js';
import { MODE_PATH_TO_PRESET_ID } from '../settings/FreshProfileSettingsOps.js';
import {
    SESSION_SWITCH_CHANGED_KEYS,
    handleSessionTypeChangeAction,
    resolveProductiveMultiplayerTransport,
} from './MenuRuntimeSessionSwitchService.js';

// Re-exported so existing call sites keep a stable MenuRuntimeSessionService entry point.
export {
    handleQuickStartEventPlaylistStartAction,
    handleQuickStartLastStartAction,
    handleQuickStartRandomStartAction,
} from './MenuRuntimeQuickStartService.js';

export { SESSION_SWITCH_CHANGED_KEYS, MODE_PATH_TO_PRESET_ID };
export { handleSessionTypeChangeAction, resolveProductiveMultiplayerTransport };

function getSurfacePort(game) {
    return createSurfacePolicyPort({
        getProductSurfaceId: () => resolveProductSurfaceId(game),
        getSettings: () => game?.settings
    });
}

function resolveProductSurfaceId(game) {
    const productSurfaceId = String(
        game?.uiManager?._runtimeFeatureFlags?.surfacePolicy?.productSurfaceId || ''
    ).trim().toLowerCase();
    return productSurfaceId;
}

export function handleModePathChangeAction(ctx) {
    const { game, event, onSettingsChanged, resolveMenuAccessContext } = ctx;
    const huntFeatureEnabled = CONFIG.HUNT?.ENABLED !== false;
    const requestedModePath = String(event?.modePath || '').trim().toLowerCase();
    let modePath = requestedModePath === 'arcade' || requestedModePath === 'fight' || requestedModePath === 'normal'
        ? requestedModePath
        : 'normal';
    if (!getSurfacePort(game).isModePathAllowed(modePath)) {
        modePath = getSurfacePort(game).resolveFallbackModePath();
    }
    if (modePath === 'fight' && !huntFeatureEnabled) {
        modePath = 'normal';
    }
    const previousModePath = String(game.settings.localSettings.modePath || '').trim().toLowerCase();
    game.settings.localSettings.modePath = modePath;

    const changedKeys = [SETTINGS_CHANGE_KEYS.MODE_PATH];
    const presetId = MODE_PATH_TO_PRESET_ID[modePath];
    const seededModePaths = Array.isArray(game.settings.localSettings.seededModePaths)
        ? game.settings.localSettings.seededModePaths
        : [];
    // A style preset seeds a style once. Re-clicking the current style or returning to a
    // style with own values is navigation and must not throw the player's tuning away.
    const keepsOwnValues = modePath === previousModePath || seededModePaths.includes(modePath);
    if (presetId && !keepsOwnValues) {
        // Bot difficulty is a player preference, not part of the curated style setup.
        // Choosing a style is navigation, so its preset must not silently overwrite it.
        const savedBotDifficulty = game.settings.botDifficulty;
        const presetResult = game.settingsManager.applyMenuPreset(
            game.settings,
            presetId,
            resolveMenuAccessContext()
        );
        if (presetResult.success) {
            game.settings.botDifficulty = savedBotDifficulty;
            game.settings.localSettings.seededModePaths = [...seededModePaths, modePath];
            appendMutationChangedKeys(changedKeys, presetResult);
        } else {
            game._showStatusToast(resolvePresetFailureMessage(presetResult, 'Vorlage konnte nicht angewendet werden.'), 1700, 'error');
            return;
        }
    }
    const currentMapKey = String(game.settings?.mapKey || '').trim();
    if (currentMapKey !== 'custom') {
        const currentMapDefinition = CONFIG?.MAPS?.[currentMapKey];
        const curatedFallbackMapKey = getSurfacePort(game).listAllowedMapKeysForModePath(modePath)
            .find((mapKey) => CONFIG?.MAPS?.[mapKey] && isMapEligibleForModePath(CONFIG.MAPS[mapKey], modePath));
        if (!isMapEligibleForModePath(currentMapDefinition, modePath)
            || !getSurfacePort(game).isMapAllowed(currentMapKey, modePath)) {
            game.settings.mapKey = curatedFallbackMapKey || resolveModePathFallbackMapKey(CONFIG?.MAPS, modePath, currentMapKey);
            changedKeys.push(SETTINGS_CHANGE_KEYS.MAP_KEY);
        }
    }

    syncMenuSelectionWriteback(game.settings, modePath);

    if (modePath === 'fight') {
        game.settings.gameMode = 'HUNT';
        if (!game.settings.hunt || typeof game.settings.hunt !== 'object') {
            game.settings.hunt = {};
        }
        game.settings.hunt.respawnEnabled = true;
        changedKeys.push(SETTINGS_CHANGE_KEYS.GAME_MODE, SETTINGS_CHANGE_KEYS.HUNT_RESPAWN_ENABLED);
    } else if (modePath === 'normal' || modePath === 'arcade') {
        // Arcade runs on its own strategy: it is the survival gauntlet with a health pool,
        // scoring and upgrade bonuses. Classic stays the instant-kill mode.
        game.settings.gameMode = modePath === 'arcade' ? 'ARCADE' : 'CLASSIC';
        if (!game.settings.hunt || typeof game.settings.hunt !== 'object') {
            game.settings.hunt = {};
        }
        game.settings.hunt.respawnEnabled = false;
        changedKeys.push(SETTINGS_CHANGE_KEYS.GAME_MODE, SETTINGS_CHANGE_KEYS.HUNT_RESPAWN_ENABLED);
    }

    onSettingsChanged({ changedKeys: Array.from(new Set(changedKeys)) });
    // Switching the variant inside free play keeps the player on the screen they are on.
    if (event?.stayOnPanel !== true) {
        game.uiManager?.menuNavigationRuntime?.showPanel?.('submenu-game', {
            trigger: 'mode_path_selected',
            modePath,
        });
    }

    const label = modePath === 'fight' ? 'Kampf' : (modePath === 'arcade' ? 'Arcade' : 'Klassisch');
    if (requestedModePath && requestedModePath !== modePath && !getSurfacePort(game).isModePathAllowed(requestedModePath)) {
        const feedback = getSurfacePort(game).resolveBlockedFeatureFeedback('Dieser Modus');
        game._showStatusToast(feedback.message, feedback.durationMs, feedback.tone);
    } else if (requestedModePath === 'fight' && !huntFeatureEnabled) {
        game._showStatusToast('Kampf ist deaktiviert. Klassisch wurde gesetzt.', 1500, 'warning');
    } else {
        game._showStatusToast(`Gewählt: ${event?.label || label}`, 1200, 'info');
    }
}

export function handleLevel3ResetAction(ctx) {
    const { game, onSettingsChanged } = ctx;
    const sessionType = String(game?.settings?.localSettings?.sessionType || 'single').toLowerCase();
    const modePath = String(game?.settings?.localSettings?.modePath || 'normal').toLowerCase();
    const defaults = createMenuLevel3ResetDefaults();
    writeHangarMapSelection(game.settings, defaults.mapKey, defaults.mapKey, { modePath });
    writeHangarVehicleSelection(
        game.settings,
        HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_1,
        defaults.vehicles.PLAYER_1,
        defaults.vehicles.PLAYER_1,
        { modePath }
    );
    if (sessionType === 'splitscreen') {
        for (const slot of [HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_2, HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_3]) {
            writeHangarVehicleSelection(game.settings, slot, defaults.vehicles[slot], defaults.vehicles[slot], { modePath });
        }
    }
    onSettingsChanged({
        changedKeys: [
            SETTINGS_CHANGE_KEYS.MAP_KEY,
            SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_1,
            SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_2,
        ],
    });
    game._showStatusToast('Karte und Flugzeug zurückgesetzt', 1200, 'info');
}

export function handleLevel4OpenAction(ctx) {
    const { game, event } = ctx;
    const requestedSectionId = String(event?.sectionId || '').trim();
    const returnTarget = String(event?.returnTarget || '').trim().toLowerCase();
    const requestedReturnTarget = ['main', 'lobby'].includes(returnTarget) ? returnTarget : 'game';
    const validSectionIds = new Set(Object.values(LEVEL4_SECTION_IDS));
    if (!game.settings.localSettings.toolsState || typeof game.settings.localSettings.toolsState !== 'object') {
        game.settings.localSettings.toolsState = {};
    }
    game.settings.localSettings.toolsState.level4ReturnTarget = requestedReturnTarget;
    game.ui?.level4Drawer?.setAttribute?.('data-level4-return-target', requestedReturnTarget);
    // Opened from the start screen the drawer lies over the start screen itself, not over free play.
    if (requestedReturnTarget !== 'main') {
        game.uiManager?.menuNavigationRuntime?.showPanel?.(requestedReturnTarget === 'lobby' ? 'submenu-multiplayer' : 'submenu-game', { trigger: 'open_level4' });
    }
    if (validSectionIds.has(requestedSectionId)) {
        game.settings.localSettings.toolsState.activeSection = requestedSectionId;
        game.uiManager?.setLevel4Section?.(requestedSectionId, { persist: true, focus: false });
    }
    game.settings.localSettings.toolsState.level4Open = true;
    game.uiManager?.setLevel4Open?.(true);
}

export function handleLevel4CloseAction(ctx) {
    const { game } = ctx;
    if (!game.settings.localSettings.toolsState || typeof game.settings.localSettings.toolsState !== 'object') {
        game.settings.localSettings.toolsState = {};
    }
    delete game.settings.localSettings.toolsState.level4ReturnTarget;
    game.settings.localSettings.toolsState.level4Open = false;
    game.uiManager?.setLevel4Open?.(false);
    // Store the closed state now: otherwise a stale stored flag reopens the window after a restart.
    game._saveSettings?.();
}

// The reset button of the settings drawer puts back one tab only (see Level4ResetScopes).
export function handleLevel4ResetAction(ctx) {
    const { game, event, onSettingsChanged } = ctx;
    const sectionId = String(event?.sectionId || '').trim();
    if (!isLevel4ResetSection(sectionId)) return;
    const changedKeys = applyLevel4Reset(game.settings, game.settingsManager.createDefaultSettings(), sectionId);
    onSettingsChanged({ changedKeys });
    game._showStatusToast(`${LEVEL4_RESET_SCOPES[sectionId].label} zurückgesetzt`, 1600, 'info');
}

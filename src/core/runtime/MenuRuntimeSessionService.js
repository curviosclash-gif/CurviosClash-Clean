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
import {
    MULTIPLAYER_TRANSPORTS,
    isLegacyMultiplayerTransport,
    normalizeMultiplayerTransport,
} from '../../shared/contracts/RuntimeSessionContract.js';
import { hasConfiguredOnlineSignalingUrl } from '../../shared/contracts/OnlineSignalingConfig.js';
import { appendMutationChangedKeys, resolveMutationChangedKeys } from './RuntimeSettingsChangeKeys.js';
import { resolvePresetFailureMessage } from './MenuRuntimeQuickStartService.js';
import { MODE_PATH_TO_PRESET_ID } from '../settings/FreshProfileSettingsOps.js';

// Re-exported so existing call sites keep a stable MenuRuntimeSessionService entry point.
export {
    handleQuickStartEventPlaylistStartAction,
    handleQuickStartLastStartAction,
    handleQuickStartRandomStartAction,
} from './MenuRuntimeQuickStartService.js';

const SESSION_SWITCH_CHANGED_KEYS = Object.freeze([
    SETTINGS_CHANGE_KEYS.SESSION_TYPE,
    SETTINGS_CHANGE_KEYS.MODE,
    SETTINGS_CHANGE_KEYS.MODE_PATH,
    SETTINGS_CHANGE_KEYS.MAP_KEY,
    SETTINGS_CHANGE_KEYS.GAME_MODE,
    SETTINGS_CHANGE_KEYS.BOTS_COUNT,
    SETTINGS_CHANGE_KEYS.BOTS_DIFFICULTY,
    SETTINGS_CHANGE_KEYS.RULES_WINS_NEEDED,
    SETTINGS_CHANGE_KEYS.RULES_AUTO_ROLL,
    SETTINGS_CHANGE_KEYS.RULES_PORTALS_ENABLED,
    SETTINGS_CHANGE_KEYS.HUNT_RESPAWN_ENABLED,
    SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_1,
    SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_2,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_SPEED,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_TURN_SENSITIVITY,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_PLANE_SCALE,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_TRAIL_WIDTH,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_GAP_SIZE,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_GAP_FREQUENCY,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_ITEM_AMOUNT,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_FIRE_RATE,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_LOCK_ON_ANGLE,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_MG_TRAIL_AIM_RADIUS,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_FIGHT_PLAYER_HP,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_FIGHT_MG_DAMAGE,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_PLANAR_MODE,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_PLANAR_LEVEL_COUNT,
    SETTINGS_CHANGE_KEYS.LOCAL_THEME_MODE,
]);

export { SESSION_SWITCH_CHANGED_KEYS, MODE_PATH_TO_PRESET_ID };

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

export function resolveProductiveMultiplayerTransport(game, requestedTransport = '') {
    const surfacePolicy = getSurfacePort(game).resolvePolicy();
    const onlineConfigured = hasConfiguredOnlineSignalingUrl({
        runtimeGlobal: typeof globalThis !== 'undefined' ? globalThis : null,
    });
    const allowedTransports = Array.isArray(surfacePolicy?.allowedMultiplayerTransports)
        ? surfacePolicy.allowedMultiplayerTransports.filter((transport) => (
            !isLegacyMultiplayerTransport(transport)
            && (transport !== MULTIPLAYER_TRANSPORTS.ONLINE || onlineConfigured)
        ))
        : [];
    const candidates = [
        normalizeMultiplayerTransport(requestedTransport, ''),
        normalizeMultiplayerTransport(game?.settings?.localSettings?.multiplayerTransport, ''),
        normalizeMultiplayerTransport(surfacePolicy?.defaultMultiplayerTransport, ''),
        allowedTransports[0] || '',
        MULTIPLAYER_TRANSPORTS.LAN,
    ];
    const fallbackTransport = allowedTransports[0] || MULTIPLAYER_TRANSPORTS.LAN;
    return candidates.find((transport) => allowedTransports.includes(transport))
        || fallbackTransport;
}

function applyProductiveMultiplayerTransport(game, requestedTransport = '') {
    if (!game?.settings) {
        return {
            changed: false,
            transport: MULTIPLAYER_TRANSPORTS.LAN,
        };
    }
    if (!game.settings.localSettings || typeof game.settings.localSettings !== 'object') {
        game.settings.localSettings = {};
    }
    const nextTransport = resolveProductiveMultiplayerTransport(game, requestedTransport);
    const previousTransport = normalizeMultiplayerTransport(game.settings.localSettings.multiplayerTransport, '');
    game.settings.localSettings.multiplayerTransport = nextTransport;
    return {
        changed: previousTransport !== nextTransport,
        transport: nextTransport,
    };
}

export function handleSessionTypeChangeAction(ctx) {
    const { game, event, onSettingsChanged } = ctx;
    const requestedSessionType = String(event?.sessionType || '').trim().toLowerCase();
    if (!requestedSessionType) return;
    const requestedAllowed = getSurfacePort(game).isSessionTypeAllowed(requestedSessionType);
    const targetSessionType = requestedAllowed
        ? requestedSessionType
        : getSurfacePort(game).resolveFallbackSessionType();

    const result = game.settingsManager.switchSessionType(game.settings, targetSessionType);
    if (!result.success) {
        game._showStatusToast('Session-Typ konnte nicht gewechselt werden.', 1700, 'error');
        return;
    }

    const changedKeys = resolveMutationChangedKeys(result, SESSION_SWITCH_CHANGED_KEYS);
    let selectedMultiplayerTransport = '';
    if (result.targetSessionType === 'multiplayer') {
        const transportResult = applyProductiveMultiplayerTransport(game);
        selectedMultiplayerTransport = transportResult.transport;
        if (transportResult.changed) {
            changedKeys.push(SETTINGS_CHANGE_KEYS.MULTIPLAYER_TRANSPORT);
        }
    }

    onSettingsChanged({ changedKeys: Array.from(new Set(changedKeys)) });
    const surfaceEntryCopy = getSurfacePort(game).resolveEntryCopy(result.targetSessionType);
    const label = surfaceEntryCopy.sessionLabels[result.targetSessionType]
        || (result.targetSessionType === 'splitscreen'
            ? 'Splitscreen'
            : (result.targetSessionType === 'multiplayer' ? 'Multiplayer' : 'Single Player'));
    const transportLabel = selectedMultiplayerTransport === MULTIPLAYER_TRANSPORTS.ONLINE
        ? ' | Transport: Online'
        : (result.targetSessionType === 'multiplayer' ? ' | Transport: LAN' : '');
    if (!requestedAllowed && requestedSessionType !== targetSessionType) {
        const blockedLabel = requestedSessionType === 'splitscreen'
            ? 'Splitscreen'
            : 'Dieser Einstieg';
        const feedback = getSurfacePort(game).resolveBlockedFeatureFeedback(blockedLabel);
        game._showStatusToast(`${feedback.message} ${label} wurde gesetzt.`, 1700, feedback.tone);
        return;
    }
    game._showStatusToast(
        result.loadedDraft
            ? `Session gewechselt: ${label}${transportLabel} (Draft geladen)`
            : `Session gewechselt: ${label}${transportLabel}`,
        1200,
        'info'
    );
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
    game.uiManager?.menuNavigationRuntime?.showPanel?.('submenu-game', {
        trigger: 'mode_path_selected',
        modePath,
    });

    const label = modePath === 'fight' ? 'Kampf' : (modePath === 'arcade' ? 'Arcade' : 'Klassisch');
    if (requestedModePath && requestedModePath !== modePath && !getSurfacePort(game).isModePathAllowed(requestedModePath)) {
        const feedback = getSurfacePort(game).resolveBlockedFeatureFeedback('Dieser Modus');
        game._showStatusToast(feedback.message, feedback.durationMs, feedback.tone);
    } else if (requestedModePath === 'fight' && !huntFeatureEnabled) {
        game._showStatusToast('Kampf ist deaktiviert. Klassisch wurde gesetzt.', 1500, 'warning');
    } else if (presetId && keepsOwnValues && modePath !== previousModePath) {
        game._showStatusToast(
            `Modus gewählt: ${label} – deine Werte bleiben. Vorlage unter „Vorlagen“ anwenden.`,
            2200,
            'info'
        );
    } else {
        game._showStatusToast(`Modus gewaehlt: ${label}`, 1200, 'info');
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
        writeHangarVehicleSelection(
            game.settings,
            HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_2,
            defaults.vehicles.PLAYER_2,
            defaults.vehicles.PLAYER_2,
            { modePath }
        );
    }
    if (!game.settings.localSettings || typeof game.settings.localSettings !== 'object') {
        game.settings.localSettings = {};
    }
    game.settings.localSettings.themeMode = defaults.themeMode;

    onSettingsChanged({
        changedKeys: [
            SETTINGS_CHANGE_KEYS.MAP_KEY,
            SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_1,
            SETTINGS_CHANGE_KEYS.VEHICLES_PLAYER_2,
            SETTINGS_CHANGE_KEYS.LOCAL_THEME_MODE,
        ],
    });
    game._showStatusToast('Auswahl zurückgesetzt', 1200, 'info');
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
    game.uiManager?.menuNavigationRuntime?.showPanel?.(requestedReturnTarget === 'lobby' ? 'submenu-multiplayer' : 'submenu-game', { trigger: 'open_level4' });
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

// A fresh profile plays its style with the style preset on top of the defaults, so the
// reset hands back the same gameplay values. Map, bots and rules stay outside its scope.
function resolveStylePresetGameplayValues(game) {
    const modePath = String(game?.settings?.localSettings?.modePath || 'normal').trim().toLowerCase();
    const presetId = MODE_PATH_TO_PRESET_ID[modePath];
    const presets = game?.settingsManager?.listMenuPresets?.();
    const preset = Array.isArray(presets) ? presets.find((entry) => entry?.id === presetId) : null;
    const gameplay = {};
    for (const [path, value] of Object.entries(preset?.values || {})) {
        if (path.startsWith('gameplay.')) gameplay[path.slice('gameplay.'.length)] = value;
    }
    return gameplay;
}

export function handleLevel4ResetAction(ctx) {
    const { game, onSettingsChanged } = ctx;
    const defaults = game.settingsManager.createDefaultSettings();
    game.settings.gameplay = { ...defaults.gameplay, ...resolveStylePresetGameplayValues(game) };
    game.settings.matchSettings = {
        ...(game.settings.matchSettings || {}),
        activePresetId: '',
        activePresetKind: '',
        activePresetSourceId: '',
    };
    if (!game.settings.localSettings || typeof game.settings.localSettings !== 'object') {
        game.settings.localSettings = {};
    }
    game.settings.localSettings.shadowQuality = defaults.localSettings.shadowQuality;
    game.settings.localSettings.bloomQuality = defaults.localSettings.bloomQuality;
    game.settings.localSettings.mapBrightness = defaults.localSettings.mapBrightness;
    game.settings.localSettings.viewDistance = defaults.localSettings.viewDistance;
    game.settings.autoRoll = defaults.autoRoll;
    game.settings.invertPitch = { ...defaults.invertPitch };
    game.settings.cockpitCamera = { ...defaults.cockpitCamera };
    game.settings.cameraPerspective = { ...defaults.cameraPerspective };
    game.settings.recording = { ...defaults.recording };

    onSettingsChanged({
        changedKeys: [
            SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_ID,
            SETTINGS_CHANGE_KEYS.PRESET_ACTIVE_KIND,
            SETTINGS_CHANGE_KEYS.RULES_AUTO_ROLL,
            SETTINGS_CHANGE_KEYS.RULES_INVERT_P1,
            SETTINGS_CHANGE_KEYS.RULES_INVERT_P2,
            SETTINGS_CHANGE_KEYS.RULES_COCKPIT_P1,
            SETTINGS_CHANGE_KEYS.RULES_COCKPIT_P2,
            SETTINGS_CHANGE_KEYS.GAMEPLAY_SPEED,
            SETTINGS_CHANGE_KEYS.GAMEPLAY_TURN_SENSITIVITY,
            SETTINGS_CHANGE_KEYS.GAMEPLAY_PLANE_SCALE,
            SETTINGS_CHANGE_KEYS.GAMEPLAY_TRAIL_WIDTH,
            SETTINGS_CHANGE_KEYS.GAMEPLAY_GAP_SIZE,
            SETTINGS_CHANGE_KEYS.GAMEPLAY_GAP_FREQUENCY,
            SETTINGS_CHANGE_KEYS.GAMEPLAY_ITEM_AMOUNT,
            SETTINGS_CHANGE_KEYS.GAMEPLAY_FIRE_RATE,
            SETTINGS_CHANGE_KEYS.GAMEPLAY_LOCK_ON_ANGLE,
            SETTINGS_CHANGE_KEYS.GAMEPLAY_NEXT_CHECKPOINT_GLOW_INTENSITY,
            SETTINGS_CHANGE_KEYS.GAMEPLAY_MG_TRAIL_AIM_RADIUS,
            SETTINGS_CHANGE_KEYS.GAMEPLAY_FIGHT_PLAYER_HP,
            SETTINGS_CHANGE_KEYS.GAMEPLAY_FIGHT_MG_DAMAGE,
            SETTINGS_CHANGE_KEYS.LOCAL_SHADOW_QUALITY,
            SETTINGS_CHANGE_KEYS.LOCAL_BLOOM_QUALITY,
            SETTINGS_CHANGE_KEYS.LOCAL_MAP_BRIGHTNESS,
            SETTINGS_CHANGE_KEYS.LOCAL_VIEW_DISTANCE,
            SETTINGS_CHANGE_KEYS.RECORDING_PROFILE,
            SETTINGS_CHANGE_KEYS.RECORDING_HUD_MODE,
            SETTINGS_CHANGE_KEYS.RECORDING_ORIENTATION,
            SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_NORMAL,
            SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_REDUCE_MOTION,
            SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_SPEED_FOV_ENABLED,
            SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_SPEED_FOV_INTENSITY,
            SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_THRUSTER_EXHAUST_ENABLED,
            SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_THRUSTER_EXHAUST_INTENSITY,
        ],
    });
    game._showStatusToast('Spieloptionen zurückgesetzt', 1600, 'info');
}

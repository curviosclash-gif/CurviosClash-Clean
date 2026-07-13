// ============================================
// MenuRuntimeSessionService.js - session/mode/quickstart/level actions
// ============================================

import { CONFIG } from '../Config.js';
import {
    createMenuLevel3ResetDefaults,
    getNextEventPlaylistEntry,
    LEVEL4_SECTION_IDS,
    SETTINGS_CHANGE_KEYS,
} from '../../composition/core-ui/CoreUiMenuPorts.js';
import {
    isMapEligibleForModePath,
    listEligibleMapKeysForModePath,
    resolveModePathFallbackMapKey,
} from '../../shared/contracts/MapModeContract.js';
import {
    PLATFORM_SURFACE_QUICK_START_ACTION_IDS,
} from '../../shared/contracts/PlatformCapabilityRegistry.js';
import { createSurfacePolicyPort } from '../../shared/runtime/SurfacePolicyPort.js';
import {
    MULTIPLAYER_TRANSPORTS,
    isLegacyMultiplayerTransport,
    normalizeMultiplayerTransport,
} from '../../shared/contracts/RuntimeSessionContract.js';
import { hasConfiguredOnlineSignalingUrl } from '../../shared/contracts/OnlineSignalingConfig.js';
import { createRuntimeRng } from '../../shared/contracts/RuntimeRngContract.js';
import {
    appendMutationChangedKeys,
    resolveMutationChangedKeys,
} from './RuntimeSettingsChangeKeys.js';

const MODE_PATH_TO_PRESET_ID = Object.freeze({
    arcade: 'arcade',
    fight: 'fight-standard',
    normal: 'normal-standard',
});

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
    SETTINGS_CHANGE_KEYS.GAMEPLAY_PORTAL_COUNT,
    SETTINGS_CHANGE_KEYS.GAMEPLAY_PLANAR_LEVEL_COUNT,
    SETTINGS_CHANGE_KEYS.LOCAL_THEME_MODE,
]);

export { SESSION_SWITCH_CHANGED_KEYS, MODE_PATH_TO_PRESET_ID };

function resolvePresetFailureMessage(result, fallbackMessage) {
    switch (result?.reason) {
    case 'invalid_preset_id':
        return 'Preset-ID ist ungueltig.';
    case 'preset_not_found':
        return 'Preset wurde nicht gefunden.';
    case 'owner_required':
        return 'Nur der Host darf dieses Preset anwenden.';
    default:
        return fallbackMessage;
    }
}

function cloneJsonSnapshot(value) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return null;
    }
}

function buildEventPlaylistPersistedSettings(baseSettingsSnapshot, runtimeSettings) {
    const baseSettings = baseSettingsSnapshot && typeof baseSettingsSnapshot === 'object'
        ? baseSettingsSnapshot
        : cloneJsonSnapshot(runtimeSettings);
    if (!baseSettings || typeof baseSettings !== 'object') return null;
    if (!baseSettings.localSettings || typeof baseSettings.localSettings !== 'object') {
        baseSettings.localSettings = {};
    }
    baseSettings.localSettings.eventPlaylistState = {
        ...(runtimeSettings?.localSettings?.eventPlaylistState || {}),
    };
    return baseSettings;
}

function resolveQuickStartRng(game, event = null) {
    const runtimeRng = game?.runtimeRng && typeof game.runtimeRng.next === 'function'
        ? game.runtimeRng
        : createRuntimeRng({
            random: typeof game?.random === 'function' ? game.random : Math.random,
        });
    const hasSeed = Number.isFinite(Number(event?.seed));
    if (!hasSeed) {
        return runtimeRng;
    }
    return createRuntimeRng({ seed: Number(event.seed) });
}


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
    const productSurfaceId = resolveProductSurfaceId(game);
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
    const productSurfaceId = resolveProductSurfaceId(game);
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
    game.settings.localSettings.modePath = modePath;

    const changedKeys = [SETTINGS_CHANGE_KEYS.MODE_PATH];
    const presetId = MODE_PATH_TO_PRESET_ID[modePath];
    if (presetId) {
        const presetResult = game.settingsManager.applyMenuPreset(
            game.settings,
            presetId,
            resolveMenuAccessContext()
        );
        if (presetResult.success) {
            appendMutationChangedKeys(changedKeys, presetResult);
        } else {
            game._showStatusToast(resolvePresetFailureMessage(presetResult, 'Preset konnte nicht angewendet werden.'), 1700, 'error');
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

    if (modePath === 'fight') {
        game.settings.gameMode = 'HUNT';
        if (!game.settings.hunt || typeof game.settings.hunt !== 'object') {
            game.settings.hunt = {};
        }
        game.settings.hunt.respawnEnabled = true;
        changedKeys.push(SETTINGS_CHANGE_KEYS.GAME_MODE, SETTINGS_CHANGE_KEYS.HUNT_RESPAWN_ENABLED);
    } else if (modePath === 'normal' || modePath === 'arcade') {
        game.settings.gameMode = 'CLASSIC';
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

    const label = modePath === 'fight' ? 'Fight' : (modePath === 'arcade' ? 'Arcade' : 'Normal');
    if (requestedModePath && requestedModePath !== modePath && !getSurfacePort(game).isModePathAllowed(requestedModePath)) {
        const feedback = getSurfacePort(game).resolveBlockedFeatureFeedback('Dieser Modus');
        game._showStatusToast(feedback.message, feedback.durationMs, feedback.tone);
    } else if (requestedModePath === 'fight' && !huntFeatureEnabled) {
        game._showStatusToast('Fight ist deaktiviert. Normal wurde gesetzt.', 1500, 'warning');
    } else {
        game._showStatusToast(`Modus gewaehlt: ${label}`, 1200, 'info');
    }
}

export function handleQuickStartLastStartAction(ctx) {
    const { game, onSettingsChanged, recordMenuTelemetry, startMatch } = ctx;
    const productSurfaceId = resolveProductSurfaceId(game);
    if (!getSurfacePort(game).isQuickStartAllowed(PLATFORM_SURFACE_QUICK_START_ACTION_IDS.LAST_SETTINGS)) {
        const feedback = getSurfacePort(game).resolveBlockedFeatureFeedback('Direktstart');
        game._showStatusToast(feedback.message, feedback.durationMs, feedback.tone);
        return;
    }
    game.settings.localSettings.modePath = 'quick_action';
    onSettingsChanged({ changedKeys: [SETTINGS_CHANGE_KEYS.MODE_PATH] });
    recordMenuTelemetry('quickstart', {
        variant: 'last_settings',
        sessionType: game?.settings?.localSettings?.sessionType || 'single',
    });
    game._showStatusToast('Schnellstart: letzte Einstellungen', 1000, 'info');
    startMatch();
}

export async function handleQuickStartEventPlaylistStartAction(ctx) {
    const { game, onSettingsChanged, resolveMenuAccessContext, recordMenuTelemetry, startMatch } = ctx;
    const productSurfaceId = resolveProductSurfaceId(game);
    if (!getSurfacePort(game).isQuickStartAllowed(PLATFORM_SURFACE_QUICK_START_ACTION_IDS.EVENT_PLAYLIST)) {
        const feedback = getSurfacePort(game).resolveBlockedFeatureFeedback('Event-Playlist');
        game._showStatusToast(feedback.message, feedback.durationMs, feedback.tone);
        return;
    }
    const playlistStep = getNextEventPlaylistEntry(game?.settings?.localSettings?.eventPlaylistState);
    const presetId = String(playlistStep?.entry?.presetId || '').trim();
    if (!presetId) {
        game._showStatusToast('Event-Playlist ist nicht verfuegbar.', 1500, 'error');
        return;
    }
    const baselineSettingsSnapshot = cloneJsonSnapshot(game.settings);

    const presetResult = game.settingsManager.applyMenuPreset(
        game.settings,
        presetId,
        resolveMenuAccessContext()
    );
    if (!presetResult.success) {
        game._showStatusToast(resolvePresetFailureMessage(presetResult, 'Event-Playlist konnte nicht vorbereitet werden.'), 1600, 'error');
        return;
    }

    game.settings.localSettings.modePath = 'quick_action';
    game.settings.localSettings.eventPlaylistState = {
        ...playlistStep.persistedState,
    };

    const changedKeys = [
        SETTINGS_CHANGE_KEYS.MODE_PATH,
    ];
    appendMutationChangedKeys(changedKeys, presetResult);
    onSettingsChanged({ changedKeys: Array.from(new Set(changedKeys)) });

    const presetName = String(playlistStep?.preset?.name || presetId).trim() || presetId;
    let started = false;
    try {
        started = await Promise.resolve(startMatch());
    } catch {
        started = false;
    }
    if (started) {
        recordMenuTelemetry('quickstart', {
            variant: 'event_playlist',
            playlistId: playlistStep?.playlist?.id || '',
            presetId,
            stepIndex: playlistStep.currentIndex,
            displayIndex: playlistStep.displayIndex,
            totalSteps: playlistStep.totalSteps,
            sessionType: game?.settings?.localSettings?.sessionType || 'single',
        });
        // Event-Playlist darf nur den Cursor persistieren, nicht still die komplette Runtime-Konfiguration als neue Baseline speichern.
        const persistedSettings = buildEventPlaylistPersistedSettings(baselineSettingsSnapshot, game.settings);
        if (persistedSettings) {
            game.settingsManager.saveSettings(persistedSettings);
        }
        game._showStatusToast(
            `Event-Playlist: ${presetName} (${playlistStep.displayIndex}/${playlistStep.totalSteps})`,
            1300,
            'info'
        );
    }
}

export function handleQuickStartRandomStartAction(ctx) {
    const { game, event, onSettingsChanged, recordMenuTelemetry, startMatch } = ctx;
    const productSurfaceId = resolveProductSurfaceId(game);
    if (!getSurfacePort(game).isQuickStartAllowed(PLATFORM_SURFACE_QUICK_START_ACTION_IDS.RANDOM_MAP)) {
        const feedback = getSurfacePort(game).resolveBlockedFeatureFeedback('Random-Start');
        game._showStatusToast(feedback.message, feedback.durationMs, feedback.tone);
        return;
    }
    const mapKeys = listEligibleMapKeysForModePath(CONFIG?.MAPS, 'quick_action', { includeCustom: false });
    if (mapKeys.length > 0) {
        const rng = resolveQuickStartRng(game, event);
        const randomIndex = rng.int(mapKeys.length);
        game.settings.mapKey = mapKeys[randomIndex];
    }
    game.settings.localSettings.modePath = 'quick_action';
    onSettingsChanged({
        changedKeys: [
            SETTINGS_CHANGE_KEYS.MODE_PATH,
            SETTINGS_CHANGE_KEYS.MAP_KEY,
        ],
    });
    recordMenuTelemetry('quickstart', {
        variant: 'random_map',
        mapKey: game.settings.mapKey,
        sessionType: game?.settings?.localSettings?.sessionType || 'single',
    });
    game._showStatusToast('Schnellstart: Random Map', 1000, 'info');
    startMatch();
}

export function handleLevel3ResetAction(ctx) {
    const { game, onSettingsChanged } = ctx;
    const sessionType = String(game?.settings?.localSettings?.sessionType || 'single').toLowerCase();
    const defaults = createMenuLevel3ResetDefaults();
    game.settings.mapKey = defaults.mapKey;
    game.settings.vehicles.PLAYER_1 = defaults.vehicles.PLAYER_1;
    if (sessionType === 'splitscreen') {
        game.settings.vehicles.PLAYER_2 = defaults.vehicles.PLAYER_2;
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
    game._showStatusToast('Ebene 3 zurueckgesetzt', 1200, 'info');
}

export function handleLevel4OpenAction(ctx) {
    const { game, event } = ctx;
    const requestedSectionId = String(event?.sectionId || '').trim();
    const validSectionIds = new Set(Object.values(LEVEL4_SECTION_IDS));
    game.uiManager?.menuNavigationRuntime?.showPanel?.('submenu-game', { trigger: 'open_level4' });
    if (!game.settings.localSettings.toolsState || typeof game.settings.localSettings.toolsState !== 'object') {
        game.settings.localSettings.toolsState = {};
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
    game.settings.localSettings.toolsState.level4Open = false;
    game.uiManager?.setLevel4Open?.(false);
}

export function handleLevel4ResetAction(ctx) {
    const { game, onSettingsChanged } = ctx;
    const defaults = game.settingsManager.createDefaultSettings();
    game.settings.gameplay = { ...defaults.gameplay };
    game.settings.controls = JSON.parse(JSON.stringify(defaults.controls));
    if (!game.settings.localSettings || typeof game.settings.localSettings !== 'object') {
        game.settings.localSettings = {};
    }
    game.settings.localSettings.shadowQuality = defaults.localSettings.shadowQuality;
    game.settings.portalsEnabled = defaults.portalsEnabled;
    game.settings.autoRoll = defaults.autoRoll;
    game.settings.invertPitch = { ...defaults.invertPitch };
    game.settings.cockpitCamera = { ...defaults.cockpitCamera };
    game.settings.numBots = defaults.numBots;
    game.settings.botDifficulty = defaults.botDifficulty;
    game.settings.winsNeeded = defaults.winsNeeded;
    game.settings.hunt = { ...defaults.hunt };
    game.settings.cameraPerspective = { ...defaults.cameraPerspective };

    onSettingsChanged({
        changedKeys: [
            SETTINGS_CHANGE_KEYS.BOTS_COUNT,
            SETTINGS_CHANGE_KEYS.BOTS_DIFFICULTY,
            SETTINGS_CHANGE_KEYS.RULES_WINS_NEEDED,
            SETTINGS_CHANGE_KEYS.RULES_AUTO_ROLL,
            SETTINGS_CHANGE_KEYS.RULES_INVERT_P1,
            SETTINGS_CHANGE_KEYS.RULES_INVERT_P2,
            SETTINGS_CHANGE_KEYS.RULES_COCKPIT_P1,
            SETTINGS_CHANGE_KEYS.RULES_COCKPIT_P2,
            SETTINGS_CHANGE_KEYS.RULES_PORTALS_ENABLED,
            SETTINGS_CHANGE_KEYS.HUNT_RESPAWN_ENABLED,
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
            SETTINGS_CHANGE_KEYS.LOCAL_SHADOW_QUALITY,
            SETTINGS_CHANGE_KEYS.GAMEPLAY_PLANAR_MODE,
            SETTINGS_CHANGE_KEYS.GAMEPLAY_PORTAL_COUNT,
            SETTINGS_CHANGE_KEYS.GAMEPLAY_PLANAR_LEVEL_COUNT,
            SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_NORMAL,
            SETTINGS_CHANGE_KEYS.CAMERA_PERSPECTIVE_REDUCE_MOTION,
        ],
    });
    game._showStatusToast('Ebene 4 zurueckgesetzt', 1200, 'info');
}

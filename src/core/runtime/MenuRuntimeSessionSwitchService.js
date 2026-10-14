// ============================================
// MenuRuntimeSessionSwitchService.js - switching between single, split screen and multiplayer
// ============================================

import { SETTINGS_CHANGE_KEYS } from '../../shared/settings/SettingsChangeKeys.js';
import { createSurfacePolicyPort } from '../../shared/runtime/SurfacePolicyPort.js';
import {
    MULTIPLAYER_TRANSPORTS,
    isLegacyMultiplayerTransport,
    normalizeMultiplayerTransport,
} from '../../shared/contracts/RuntimeSessionContract.js';
import { hasConfiguredOnlineSignalingUrl } from '../../shared/contracts/OnlineSignalingConfig.js';
import { resolveMutationChangedKeys } from './RuntimeSettingsChangeKeys.js';

export const SESSION_SWITCH_CHANGED_KEYS = Object.freeze([
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
    SETTINGS_CHANGE_KEYS.GAMEPLAY_GRAVITY_STRENGTH,
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
]);

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
        game._showStatusToast('Sitzung konnte nicht gewechselt werden. Die aktuellen Einstellungen konnten nicht gespeichert werden.', 2400, 'error');
        return result;
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
        ? ' · Verbindung: Online'
        : (result.targetSessionType === 'multiplayer' ? ' · Verbindung: LAN' : '');
    if (!requestedAllowed && requestedSessionType !== targetSessionType) {
        const blockedLabel = requestedSessionType === 'splitscreen'
            ? 'Splitscreen'
            : 'Dieser Einstieg';
        const feedback = getSurfacePort(game).resolveBlockedFeatureFeedback(blockedLabel);
        game._showStatusToast(`${feedback.message} ${label} wurde gesetzt.`, 1700, feedback.tone);
        return result;
    }
    game._showStatusToast(
        result.loadedDraft
            ? `Gewählt: ${label}${transportLabel} (letzte Auswahl geladen)`
            : `Gewählt: ${label}${transportLabel}`,
        1200,
        'info'
    );
    return result;
}

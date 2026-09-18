// ============================================
// MenuRuntimeMultiplayerService.js - multiplayer lobby/runtime helpers
// ============================================

import {
    createMenuLobbyService,
    matchesMenuLobbyServiceTransport,
    resolveMenuLobbyServiceTransport,
} from '../../application/session-runtime/MenuLobbyServiceFactory.js';
import { MATCH_LIFECYCLE_CONTRACT_VERSION } from '../../shared/contracts/MatchLifecycleContract.js';
import { PLATFORM_PRODUCT_SURFACE_IDS, resolveDefaultLobbyTransport, resolveLobbyProviderKind, resolveSurfacePolicy } from '../../shared/contracts/PlatformCapabilityRegistry.js';
import { resolveSurfaceMultiplayerGateAccess } from '../../shared/contracts/PlatformSurfacePolicyOps.js';
import {
    isNetworkLobbyServiceTransport,
    normalizeLobbyServiceTransport,
} from '../../shared/contracts/LobbyServiceContract.js';
import { SESSION_RUNTIME_EVENT_TYPES } from '../../shared/contracts/SessionRuntimeEventContract.js';
import {
    MULTIPLAYER_TRANSPORTS,
    RUNTIME_SESSION_TYPES,
    normalizeMultiplayerTransport as normalizeRuntimeMultiplayerTransport,
} from '../../shared/contracts/RuntimeSessionContract.js';
import { hasConfiguredOnlineSignalingUrl } from '../../shared/contracts/OnlineSignalingConfig.js';
import { MULTIPLAYER_PROTOCOL_VERSION } from '../../shared/contracts/SignalingSessionContract.js';
import { recordSessionRuntimeEvent } from '../../shared/runtime/SessionRuntimeObservability.js';
import { tryCloneJsonValue } from '../../shared/utils/JsonClone.js';
import { createLobbyPlatformBindings } from '../../platform/LobbyPlatformBindings.js';
import { normalizeString } from '../../shared/contracts/ContractNormalizeUtils.js';
import { loadRememberedLobbyName } from './MultiplayerLobbyNameOps.js';
import {
    beginMultiplayerAction,
    clearMultiplayerFieldError,
    markMultiplayerFieldError,
    setMultiplayerStatus,
} from './MenuRuntimeMultiplayerUiFeedback.js';

const ONLINE_MENU_TRANSPORT_UNAVAILABLE_MESSAGE = 'Online ist derzeit nicht eingerichtet. Bitte LAN verwenden.';

/* global __APP_TARGET__ */

// Surface-/Capability-Resolver brauchen den Adapter-Snapshot, damit die
// Desktop-App nicht als Browser-Demo eingestuft wird (Raw-Global-Sniffing
// ist auf die Electron-Plattformadapter beschraenkt).
function resolveSurfaceResolverOptions() {
    const runtimeGlobal = typeof globalThis !== 'undefined' ? globalThis : null;
    const platformBindings = createLobbyPlatformBindings(runtimeGlobal);
    return {
        appTarget: typeof __APP_TARGET__ !== 'undefined' ? String(__APP_TARGET__).trim().toLowerCase() : '',
        runtimeGlobal,
        platformRuntimeSnapshot: platformBindings.runtimeSnapshot,
    };
}

function deepClone(value) {
    return tryCloneJsonValue(value, null);
}

// NOTE: 'multiplayer' is a menu-layer coordination type, not a real network transport.
// The legacy browser fallback uses a Storage-Bridge (localStorage + BroadcastChannel) for
// lobby coordination within the same browser. At match start, each tab runs a
// LocalSessionAdapter independently — no real-time state sync occurs across tabs.
// The selected transport is stored via localSettings.multiplayerTransport; LAN is productive,
// while online remains gated until a signaling endpoint is configured.
function ensureMultiplayerSessionType(game, menuLobbyService = null) {
    if (!game?.settings || typeof game.settings !== 'object') return;
    if (!game.settings.localSettings || typeof game.settings.localSettings !== 'object') {
        game.settings.localSettings = {};
    }
    game.settings.localSettings.sessionType = RUNTIME_SESSION_TYPES.MULTIPLAYER;
    const activeTransport = normalizeLobbyServiceTransport(menuLobbyService, '');
    if (activeTransport) {
        game.settings.localSettings.multiplayerTransport = activeTransport;
        return;
    }
    const currentTransport = normalizeLobbyServiceTransport(game.settings.localSettings.multiplayerTransport, '');
    if (currentTransport === MULTIPLAYER_TRANSPORTS.LAN || currentTransport === MULTIPLAYER_TRANSPORTS.ONLINE) {
        game.settings.localSettings.multiplayerTransport = currentTransport;
        return;
    }
    game.settings.localSettings.multiplayerTransport = resolveDefaultLobbyTransport(resolveSurfaceResolverOptions());
}

function observeCapabilityFallback(runtimeSource, menuMultiplayerBridge, action, lobbyCode = '') {
    if (!runtimeSource || isNetworkLobbyServiceTransport(menuMultiplayerBridge)) {
        return;
    }
    const transport = normalizeLobbyServiceTransport(menuMultiplayerBridge, MULTIPLAYER_TRANSPORTS.LAN);
    recordSessionRuntimeEvent(runtimeSource, {
        type: SESSION_RUNTIME_EVENT_TYPES.CAPABILITY_FALLBACK_USED,
        source: 'menu_runtime_multiplayer_service',
        payload: {
            capabilityId: action === 'host' ? 'host' : 'discovery',
            providerKind: normalizeString(
                menuMultiplayerBridge?.serviceDescriptor?.providerKind,
                resolveLobbyProviderKind(transport)
            ),
            reason: 'desktop_capability_unavailable',
            action: normalizeString(action, 'unknown'),
            lobbyCode: normalizeString(lobbyCode, ''),
        },
    });
}

export function createMenuMultiplayerBridge(options = {}) {
    const {
        existingBridge = null,
        contractVersion = MATCH_LIFECYCLE_CONTRACT_VERSION,
        onEvent = null,
        onStatus = null,
        onStateChanged = null,
        onMatchStart = null,
        now,
        runtime,
        storage,
        sessionStorage,
        peerId,
    } = options;

    const runtimeGlobal = options.runtime?.global || (typeof globalThis !== 'undefined' ? globalThis : null);
    const platformBindings = options.platformBindings || createLobbyPlatformBindings(runtimeGlobal);
    const productSurfaceId = resolveSurfacePolicy(resolveSurfaceResolverOptions()).productSurfaceId;
    const isMobileApp = productSurfaceId === PLATFORM_PRODUCT_SURFACE_IDS.MOBILE_APP;
    const resolvedTransport = resolveMenuLobbyServiceTransport({
        runtime,
        transport: options.transport,
        serviceFactories: options.serviceFactories,
        platformBindings,
    });
    if (existingBridge) {
        existingBridge.contractVersion = contractVersion;
        existingBridge.onEvent = typeof onEvent === 'function' ? onEvent : null;
        existingBridge.onStatus = typeof onStatus === 'function' ? onStatus : null;
        existingBridge.onStateChanged = typeof onStateChanged === 'function' ? onStateChanged : null;
        existingBridge.onMatchStart = typeof onMatchStart === 'function' ? onMatchStart : null;
        if (matchesMenuLobbyServiceTransport(existingBridge, resolvedTransport)) {
            return existingBridge;
        }
        existingBridge.dispose?.();
    }

    return createMenuLobbyService({
        transport: resolvedTransport,
        contractVersion,
        onEvent,
        onStatus,
        onStateChanged,
        onMatchStart,
        now,
        runtime,
        storage,
        sessionStorage,
        peerId,
        platformBindings,
        productSurfaceId,
        supportsDiscovery: !isMobileApp,
        ...(isMobileApp ? { discoveryPort: null } : {}),
        participantMetadata: isMobileApp ? {
            productSurfaceId,
            protocolVersion: MULTIPLAYER_PROTOCOL_VERSION,
        } : null,
    });
}

export function didHostChangeMatchSettings(changedKeys, matchSettingChangeKeySet) {
    if (!Array.isArray(changedKeys) || changedKeys.length === 0) return false;
    return changedKeys.some((key) => matchSettingChangeKeySet?.has(key));
}

export function createMultiplayerMatchSettingsSnapshot(settings = {}) {
    return deepClone({
        mode: '1p',
        gameMode: settings?.gameMode || 'CLASSIC',
        mapKey: settings?.mapKey || 'standard',
        numBots: settings?.numBots ?? 1,
        botDifficulty: settings?.botDifficulty || 'NORMAL',
        winsNeeded: settings?.winsNeeded ?? 5,
        autoRoll: settings?.autoRoll === true,
        portalsEnabled: settings?.portalsEnabled !== false,
        hunt: settings?.hunt ? { ...settings.hunt } : { respawnEnabled: false },
        arcade: settings?.arcade ? { ...settings.arcade } : {},
        gameplay: settings?.gameplay ? { ...settings.gameplay } : {},
        vehicles: settings?.vehicles ? { ...settings.vehicles } : {},
        matchSettings: settings?.matchSettings ? { ...settings.matchSettings } : {},
        playerLoadout: settings?.playerLoadout ? { ...settings.playerLoadout } : {},
        localSettings: {
            sessionType: RUNTIME_SESSION_TYPES.MULTIPLAYER,
            // 'storage-bridge' = localStorage + BroadcastChannel (in-browser only, no real network sync).
            // Produktive Surface-Defaults kommen ueber die zentrale Surface-Policy.
            multiplayerTransport: settings?.localSettings?.multiplayerTransport
                || resolveDefaultLobbyTransport(resolveSurfaceResolverOptions()),
            modePath: settings?.localSettings?.modePath || 'normal',
        },
    });
}

export function applyMultiplayerMatchSettingsSnapshot(targetSettings, snapshot = null) {
    if (!targetSettings || typeof targetSettings !== 'object' || !snapshot || typeof snapshot !== 'object') {
        return targetSettings;
    }

    targetSettings.mode = '1p';
    targetSettings.gameMode = snapshot.gameMode || targetSettings.gameMode;
    if (snapshot.arcade && typeof snapshot.arcade === 'object') {
        targetSettings.arcade = { ...targetSettings.arcade, ...snapshot.arcade };
    }
    targetSettings.mapKey = snapshot.mapKey || targetSettings.mapKey;
    targetSettings.numBots = Number.isFinite(Number(snapshot.numBots))
        ? Number(snapshot.numBots)
        : targetSettings.numBots;
    targetSettings.botDifficulty = snapshot.botDifficulty || targetSettings.botDifficulty;
    targetSettings.winsNeeded = Number.isFinite(Number(snapshot.winsNeeded))
        ? Number(snapshot.winsNeeded)
        : targetSettings.winsNeeded;
    targetSettings.autoRoll = typeof snapshot.autoRoll === 'boolean' ? snapshot.autoRoll : targetSettings.autoRoll;
    targetSettings.portalsEnabled = typeof snapshot.portalsEnabled === 'boolean'
        ? snapshot.portalsEnabled
        : targetSettings.portalsEnabled;

    if (!targetSettings.hunt || typeof targetSettings.hunt !== 'object') {
        targetSettings.hunt = { respawnEnabled: false };
    }
    if (!targetSettings.gameplay || typeof targetSettings.gameplay !== 'object') {
        targetSettings.gameplay = {};
    }
    if (!targetSettings.vehicles || typeof targetSettings.vehicles !== 'object') {
        targetSettings.vehicles = {};
    }
    if (!targetSettings.matchSettings || typeof targetSettings.matchSettings !== 'object') {
        targetSettings.matchSettings = {};
    }
    if (!targetSettings.playerLoadout || typeof targetSettings.playerLoadout !== 'object') {
        targetSettings.playerLoadout = {};
    }
    if (!targetSettings.localSettings || typeof targetSettings.localSettings !== 'object') {
        targetSettings.localSettings = {};
    }

    targetSettings.hunt = {
        ...targetSettings.hunt,
        ...(snapshot.hunt && typeof snapshot.hunt === 'object' ? snapshot.hunt : {}),
    };
    targetSettings.gameplay = {
        ...targetSettings.gameplay,
        ...(snapshot.gameplay && typeof snapshot.gameplay === 'object' ? snapshot.gameplay : {}),
    };
    targetSettings.vehicles = {
        ...targetSettings.vehicles,
        ...(snapshot.vehicles && typeof snapshot.vehicles === 'object' ? snapshot.vehicles : {}),
    };
    targetSettings.matchSettings = {
        ...targetSettings.matchSettings,
        ...(snapshot.matchSettings && typeof snapshot.matchSettings === 'object' ? snapshot.matchSettings : {}),
    };
    targetSettings.playerLoadout = {
        ...targetSettings.playerLoadout,
        ...(snapshot.playerLoadout && typeof snapshot.playerLoadout === 'object' ? snapshot.playerLoadout : {}),
    };
    targetSettings.localSettings.sessionType = RUNTIME_SESSION_TYPES.MULTIPLAYER;
    targetSettings.localSettings.multiplayerTransport = snapshot?.localSettings?.multiplayerTransport
        || targetSettings.localSettings.multiplayerTransport
        || resolveDefaultLobbyTransport(resolveSurfaceResolverOptions());
    if (typeof snapshot?.localSettings?.modePath === 'string' && snapshot.localSettings.modePath.trim()) {
        targetSettings.localSettings.modePath = snapshot.localSettings.modePath.trim();
    }

    return targetSettings;
}

export function invalidateMultiplayerReadyIfHostChangedSettings({
    changedKeys,
    matchSettingChangeKeySet,
    resolveMenuAccessContext,
    menuMultiplayerBridge,
    game,
    onSettingsChanged,
    settingsChangeKeys,
}) {
    if (!didHostChangeMatchSettings(changedKeys, matchSettingChangeKeySet)) return;
    const accessContext = resolveMenuAccessContext?.();
    if (!accessContext?.isOwner) return;
    if (menuMultiplayerBridge?.handlesSettingsReadiness === true) return;

    const invalidationResult = menuMultiplayerBridge?.invalidateReadyForAll('host_settings_changed');
    if (!invalidationResult) return null;

    return Promise.resolve(invalidationResult).then((resolvedResult) => {
        if (!resolvedResult?.event) return null;
        onSettingsChanged?.({
            changedKeys: [settingsChangeKeys.MULTIPLAYER_STATUS],
        });
        return resolvedResult;
    }).catch(() => null);
}

// The menu's lobby table (ui.openLobbyTable) draws the rows; the runtime only hands over data.
const lobbyListRefreshesInFlight = new WeakSet();

export async function handleMultiplayerLobbyListRefreshAction({
    game,
    event = null,
    menuMultiplayerBridge,
}) {
    if (!game) return null;
    if (event?.auto === true) {
        // A background refresh stays silent and never overlaps a running search.
        if (lobbyListRefreshesInFlight.has(game) || typeof menuMultiplayerBridge?.listOpenLobbies !== 'function') return null;
        lobbyListRefreshesInFlight.add(game);
        try {
            const lobbies = await Promise.resolve(menuMultiplayerBridge.listOpenLobbies());
            game.ui?.openLobbyTable?.update?.(lobbies);
            return { ok: true, lobbies };
        } catch {
            return { ok: false };
        } finally {
            lobbyListRefreshesInFlight.delete(game);
        }
    }
    const selectedTransport = normalizeRuntimeMultiplayerTransport(
        game?.settings?.localSettings?.multiplayerTransport,
        MULTIPLAYER_TRANSPORTS.LAN
    );
    if (typeof menuMultiplayerBridge?.listOpenLobbies !== 'function') {
        return { ok: false, message: 'Die Lobby-Suche ist nicht verfuegbar.' };
    }

    const refreshButton = game.ui?.multiplayerOpenLobbiesRefreshButton;
    const wasDisabled = refreshButton?.disabled === true;
    if (refreshButton) refreshButton.disabled = true;
    const transportLabel = selectedTransport === MULTIPLAYER_TRANSPORTS.ONLINE ? 'Online' : 'LAN';
    setMultiplayerStatus(game, `${transportLabel}-Lobbys werden gesucht …`);
    lobbyListRefreshesInFlight.add(game);
    try {
        const lobbies = await Promise.resolve(menuMultiplayerBridge.listOpenLobbies());
        game.ui?.openLobbyTable?.update?.(lobbies);
        setMultiplayerStatus(game, lobbies.length === 1
            ? `1 offene ${transportLabel}-Lobby gefunden.`
            : `${lobbies.length} offene ${transportLabel}-Lobbys gefunden.`);
        return { ok: true, lobbies };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Lobby-Suche fehlgeschlagen.';
        game.ui?.openLobbyTable?.update?.([]);
        setMultiplayerStatus(game, `Lobby-Suche fehlgeschlagen: ${message}`);
        game._showStatusToast?.(message, 1800, 'error');
        return { ok: false, message };
    } finally {
        lobbyListRefreshesInFlight.delete(game);
        if (refreshButton) refreshButton.disabled = wasDisabled;
    }
}

export async function handleMultiplayerHostAction({
    game,
    event,
    resolveMenuAccessContext,
    menuMultiplayerBridge,
    syncUiState,
    captureSettingsSnapshot,
    runtimeSource,
}) {
    if (!game) return null;
    clearMultiplayerFieldError(game.ui?.multiplayerLobbyCodeInput);
    const finishPendingAction = beginMultiplayerAction(game, 'Lobby wird erstellt …');
    const selectedTransport = normalizeRuntimeMultiplayerTransport(
        game?.settings?.localSettings?.multiplayerTransport,
        MULTIPLAYER_TRANSPORTS.LAN
    );
    const onlineConfigured = hasConfiguredOnlineSignalingUrl({
        runtimeGlobal: typeof globalThis !== 'undefined' ? globalThis : null,
    });
    if (selectedTransport === MULTIPLAYER_TRANSPORTS.ONLINE && !onlineConfigured) {
        finishPendingAction();
        setMultiplayerStatus(game, ONLINE_MENU_TRANSPORT_UNAVAILABLE_MESSAGE);
        game._showStatusToast(ONLINE_MENU_TRANSPORT_UNAVAILABLE_MESSAGE, 1800, 'warning');
        return { ok: false, message: ONLINE_MENU_TRANSPORT_UNAVAILABLE_MESSAGE, reason: 'online_signaling_unconfigured' };
    }
    const hostGate = resolveSurfaceMultiplayerGateAccess('host', resolveSurfaceResolverOptions());
    if (!hostGate.allowed) {
        finishPendingAction();
        setMultiplayerStatus(game, hostGate.message || 'Hosting ist nicht verfuegbar.');
        game._showStatusToast(hostGate.message || 'Hosting ist nicht verfuegbar.', hostGate.durationMs || 1800, 'error');
        return { ok: false, message: hostGate.message, reason: hostGate.reason };
    }
    const accessContext = resolveMenuAccessContext?.(); const profile = game?.playerProfileManager?.getActiveProfile?.(); const settingsSnapshot = captureSettingsSnapshot?.();
    observeCapabilityFallback(runtimeSource, menuMultiplayerBridge, 'host', event?.lobbyCode);
    let result = null;
    try {
        result = await Promise.resolve(menuMultiplayerBridge?.host({
            actorId: profile?.id || accessContext?.actorId, name: String(profile?.displayName || accessContext?.actorId || 'Host'),
            lobbyCode: String(event?.lobbyCode || '').trim(), lobbyName: loadRememberedLobbyName(game),
            settingsSnapshot,
        }));
    } catch (error) {
        result = {
            ok: false,
            message: error instanceof Error ? error.message : 'Lobby konnte nicht erstellt werden.',
        };
    }
    if (!result?.ok) {
        finishPendingAction();
        const message = result?.message || 'Lobby konnte nicht erstellt werden.';
        setMultiplayerStatus(game, `Erstellen fehlgeschlagen: ${message}`);
        game._showStatusToast(message, 1800, 'error');
        return result;
    }

    ensureMultiplayerSessionType(game, menuMultiplayerBridge);
    if (game.ui?.multiplayerLobbyCodeInput) {
        game.ui.multiplayerLobbyCodeInput.value = result.lobbyCode || '';
    }
    menuMultiplayerBridge?.publishHostSettings?.(settingsSnapshot);
    finishPendingAction();
    syncUiState?.();
    return result;
}

export async function handleMultiplayerJoinAction({
    game,
    event,
    resolveMenuAccessContext,
    menuMultiplayerBridge,
    syncUiState,
    runtimeSource,
}) {
    if (!game) return null;
    clearMultiplayerFieldError(game.ui?.multiplayerLobbyCodeInput);
    clearMultiplayerFieldError(game.ui?.multiplayerHostAddressInput);
    const finishPendingAction = beginMultiplayerAction(game, 'Lobby wird gesucht …');
    const selectedTransport = normalizeRuntimeMultiplayerTransport(
        game?.settings?.localSettings?.multiplayerTransport,
        MULTIPLAYER_TRANSPORTS.LAN
    );
    const onlineConfigured = hasConfiguredOnlineSignalingUrl({
        runtimeGlobal: typeof globalThis !== 'undefined' ? globalThis : null,
    });
    if (selectedTransport === MULTIPLAYER_TRANSPORTS.ONLINE && !onlineConfigured) {
        finishPendingAction();
        setMultiplayerStatus(game, ONLINE_MENU_TRANSPORT_UNAVAILABLE_MESSAGE);
        game._showStatusToast(ONLINE_MENU_TRANSPORT_UNAVAILABLE_MESSAGE, 1800, 'warning');
        return { ok: false, message: ONLINE_MENU_TRANSPORT_UNAVAILABLE_MESSAGE, reason: 'online_signaling_unconfigured' };
    }
    const accessContext = resolveMenuAccessContext?.(); const profile = game?.playerProfileManager?.getActiveProfile?.();
    observeCapabilityFallback(runtimeSource, menuMultiplayerBridge, 'join', event?.lobbyCode);
    const manualSignalingUrl = selectedTransport === MULTIPLAYER_TRANSPORTS.LAN
        ? normalizeString(event?.signalingUrl, '')
        : '';
    let result = null;
    try {
        result = await Promise.resolve(menuMultiplayerBridge?.join({
            actorId: profile?.id || accessContext?.actorId, name: String(profile?.displayName || accessContext?.actorId || 'Spieler'),
            lobbyCode: String(event?.lobbyCode || '').trim(), lobbyName: loadRememberedLobbyName(game),
            signalingUrl: manualSignalingUrl,
        }));
    } catch (error) {
        result = {
            ok: false,
            message: error instanceof Error ? error.message : 'Lobby konnte nicht beigetreten werden.',
        };
    }
    if (!result?.ok) {
        const message = result?.message || 'Lobby konnte nicht beigetreten werden.';
        finishPendingAction();
        setMultiplayerStatus(game, `Join fehlgeschlagen: ${message}`);
        if (result?.code === 'manual_signaling_url_invalid') {
            markMultiplayerFieldError(game.ui?.multiplayerHostAddressInput);
        } else if (result?.code === 'missing_lobby_code' || result?.code === 'lobby_not_found') {
            markMultiplayerFieldError(game.ui?.multiplayerLobbyCodeInput);
        }
        game._showStatusToast(message, 1800, 'error');
        return result;
    }

    ensureMultiplayerSessionType(game, menuMultiplayerBridge);
    if (game.ui?.multiplayerLobbyCodeInput) {
        game.ui.multiplayerLobbyCodeInput.value = result.lobbyCode || '';
    }
    finishPendingAction();
    syncUiState?.();
    return result;
}

export function handleMultiplayerLeaveAction({
    game,
    menuMultiplayerBridge,
    syncUiState,
}) {
    if (!game) return null;
    let result = null;
    try {
        result = menuMultiplayerBridge?.leave?.() || { ok: false, message: 'Keine aktive Lobby.' };
    } catch (error) {
        result = {
            ok: false,
            message: error instanceof Error ? error.message : 'Lobby konnte nicht verlassen werden.',
        };
    }
    if (game?.ui?.multiplayerLobbyCodeInput) {
        game.ui.multiplayerLobbyCodeInput.value = '';
    }
    syncUiState?.();
    if (result?.previousState?.lobbyCode) {
        game._showStatusToast?.(`Lobby verlassen: ${result.previousState.lobbyCode}`, 1500, 'info');
    }
    return result;
}

export async function handleMultiplayerReadyToggleAction({
    game,
    event,
    resolveMenuAccessContext,
    menuMultiplayerBridge,
    syncUiState,
}) {
    ensureMultiplayerSessionType(game, menuMultiplayerBridge);
    let result = null;
    try {
        result = await Promise.resolve(menuMultiplayerBridge?.toggleReady({
            actorId: game?.playerProfileManager?.getActiveProfile?.()?.id || resolveMenuAccessContext?.()?.actorId,
            ready: !!event?.ready,
        }));
    } catch (error) {
        result = {
            ok: false,
            message: error instanceof Error ? error.message : 'Ready-Status konnte nicht gesetzt werden.',
        };
    }
    if (!result?.ok) {
        game?._showStatusToast?.(result?.message || 'Ready-Status konnte nicht gesetzt werden.', 1700, 'error');
        if (game?.ui?.multiplayerReadyToggle) {
            game.ui.multiplayerReadyToggle.checked = false;
        }
        return result;
    }
    syncUiState?.();
    return result;
}

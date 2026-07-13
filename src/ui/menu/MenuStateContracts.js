import { DEFAULT_SHADOW_QUALITY, normalizeShadowQuality } from '../../shared/contracts/ShadowQualityContract.js';
import { MATCH_LIFECYCLE_CONTRACT_VERSION } from '../../shared/contracts/MatchLifecycleContract.js';
import { MULTIPLAYER_TRANSPORTS } from '../../shared/contracts/RuntimeSessionContract.js';
import {
    ARCADE_GHOST_DUEL_MODES,
    normalizeArcadeGhostDuelMode,
    normalizeArcadeGhostTrailCollisionEnabled,
} from '../../shared/contracts/ArcadeGhostDuelContract.js';
import { normalizeMobileClassicControlSettings } from '../../shared/contracts/MobileClassicControlsContract.js';
import {
    createMenuEventPlaylistStateDefaults,
    createMenuLocalSettingsDefaults,
    createMenuStartSetupDefaults,
    createMenuTelemetryStateDefaults,
    createMenuToolsStateDefaults,
} from './MenuDefaultsEditorConfig.js';

export const MENU_STATE_SCHEMA_VERSION = 'menu-state.v1';
export const MATCH_SETTINGS_SCHEMA_VERSION = 'match-settings.v1';
export const PLAYER_LOADOUT_SCHEMA_VERSION = 'player-loadout.v1';
export const LOCAL_SETTINGS_SCHEMA_VERSION = 'local-settings.v1';
export const MENU_LIFECYCLE_EVENT_CONTRACT_VERSION = MATCH_LIFECYCLE_CONTRACT_VERSION;

export const DEFAULT_MENU_FEATURE_FLAGS = Object.freeze({
    menuV26Enabled: true,
    multiplayerStubEnabled: true,
    developerModeEnabled: true,
    allowOpenPresetEditing: true,
    canHost: false,
});

export const MENU_DEVELOPER_ACCESS_MODES = Object.freeze({
    HIDDEN_FOR_PLAYERS: 'hidden_for_players',
    OWNER_ONLY: 'owner_only',
    OPEN: 'open',
});

export const MENU_SESSION_TYPES = Object.freeze({
    SINGLE: 'single',
    MULTIPLAYER: 'multiplayer',
    SPLITSCREEN: 'splitscreen',
    LAN: 'lan',
    ONLINE: 'online',
});

export const MENU_MODE_PATHS = Object.freeze({
    QUICK_ACTION: 'quick_action',
    ARCADE: 'arcade',
    FIGHT: 'fight',
    NORMAL: 'normal',
});

/** @type {Set<string>} */
const VALID_DEVELOPER_ACCESS_MODE_SET = new Set(Object.values(MENU_DEVELOPER_ACCESS_MODES));
/** @type {Set<string>} */
const VALID_SESSION_TYPE_SET = new Set(Object.values(MENU_SESSION_TYPES));
/** @type {Set<string>} */
const VALID_MODE_PATH_SET = new Set(Object.values(MENU_MODE_PATHS));
/** @type {Set<string>} */
const VALID_MULTIPLAYER_TRANSPORT_SET = new Set(Object.values(MULTIPLAYER_TRANSPORTS));
export const LEVEL4_SECTION_IDS = Object.freeze({
    CONTROLS: 'controls',
    MOBILE_CONTROLS: 'mobile_controls',
    GAMEPLAY: 'gameplay',
    ADVANCED_MAP: 'advanced_map',
    TOOLS: 'tools',
});
/** @type {Set<string>} */
const VALID_LEVEL4_SECTION_SET = new Set(Object.values(LEVEL4_SECTION_IDS));

function normalizeBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

function normalizeString(value, fallback) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function normalizeSessionType(value, fallback = MENU_SESSION_TYPES.SINGLE) {
    const requested = normalizeString(value, fallback).toLowerCase();
    if (requested === MENU_SESSION_TYPES.LAN) {
        return MENU_SESSION_TYPES.MULTIPLAYER;
    }
    if (requested === MENU_SESSION_TYPES.ONLINE) {
        return MENU_SESSION_TYPES.MULTIPLAYER;
    }
    return VALID_SESSION_TYPE_SET.has(requested) ? requested : fallback;
}

function normalizeModePath(value, fallback = MENU_MODE_PATHS.NORMAL) {
    const requested = normalizeString(value, fallback).toLowerCase();
    return VALID_MODE_PATH_SET.has(requested) ? requested : fallback;
}

function deriveLegacyMultiplayerTransport(sessionType) {
    const normalizedSessionType = normalizeString(sessionType, '').toLowerCase();
    if (normalizedSessionType === MENU_SESSION_TYPES.LAN) {
        return MULTIPLAYER_TRANSPORTS.LAN;
    }
    if (normalizedSessionType === MENU_SESSION_TYPES.ONLINE) {
        return MULTIPLAYER_TRANSPORTS.ONLINE;
    }
    return '';
}

function normalizeMultiplayerTransport(value, fallback = '') {
    const requested = normalizeString(value, fallback).toLowerCase();
    return VALID_MULTIPLAYER_TRANSPORT_SET.has(requested) ? requested : fallback;
}

function cloneObject(value, fallback = {}) {
    if (!value || typeof value !== 'object') return { ...fallback };
    return JSON.parse(JSON.stringify(value));
}

function normalizeEventPlaylistState(eventPlaylistState = null) {
    const source = eventPlaylistState && typeof eventPlaylistState === 'object' ? eventPlaylistState : {};
    const defaults = createMenuEventPlaylistStateDefaults();
    const activePlaylistId = normalizeString(source.activePlaylistId, defaults.activePlaylistId);
    const nextIndex = Number.isFinite(Number(source.nextIndex)) ? Math.max(0, Math.floor(Number(source.nextIndex))) : 0;
    return {
        activePlaylistId,
        nextIndex,
        lastPresetId: normalizeString(source.lastPresetId, defaults.lastPresetId),
    };
}

function normalizeStartSetupState(startSetup = null) {
    const defaults = createMenuStartSetupDefaults();
    const nextState = cloneObject(startSetup, defaults);
    nextState.arcadeGhostDuelMode = normalizeArcadeGhostDuelMode(
        nextState.arcadeGhostDuelMode,
        defaults.arcadeGhostDuelMode || ARCADE_GHOST_DUEL_MODES.OFF
    );
    nextState.arcadeGhostTrailCollisionEnabled = normalizeArcadeGhostTrailCollisionEnabled(
        nextState.arcadeGhostTrailCollisionEnabled,
        defaults.arcadeGhostTrailCollisionEnabled === true
    );
    return nextState;
}

export function createMenuFeatureFlags(flags = null) {
    const source = flags && typeof flags === 'object' ? flags : {};
    return {
        menuV26Enabled: normalizeBoolean(source.menuV26Enabled, DEFAULT_MENU_FEATURE_FLAGS.menuV26Enabled),
        multiplayerStubEnabled: normalizeBoolean(source.multiplayerStubEnabled, DEFAULT_MENU_FEATURE_FLAGS.multiplayerStubEnabled),
        developerModeEnabled: normalizeBoolean(source.developerModeEnabled, DEFAULT_MENU_FEATURE_FLAGS.developerModeEnabled),
        allowOpenPresetEditing: normalizeBoolean(source.allowOpenPresetEditing, DEFAULT_MENU_FEATURE_FLAGS.allowOpenPresetEditing),
        canHost: normalizeBoolean(source.canHost, DEFAULT_MENU_FEATURE_FLAGS.canHost),
    };
}

export function createMenuContractState(contractState = null) {
    const source = contractState && typeof contractState === 'object' ? contractState : {};
    return {
        schemaVersion: MENU_STATE_SCHEMA_VERSION,
        matchSettingsSchemaVersion: normalizeString(source.matchSettingsSchemaVersion, MATCH_SETTINGS_SCHEMA_VERSION),
        playerLoadoutSchemaVersion: normalizeString(source.playerLoadoutSchemaVersion, PLAYER_LOADOUT_SCHEMA_VERSION),
        localSettingsSchemaVersion: normalizeString(source.localSettingsSchemaVersion, LOCAL_SETTINGS_SCHEMA_VERSION),
        lifecycleContractVersion: normalizeString(source.lifecycleContractVersion, MENU_LIFECYCLE_EVENT_CONTRACT_VERSION),
    };
}

function normalizeLocalSettingsState(localSettings = null) {
    const source = localSettings && typeof localSettings === 'object' ? localSettings : {};
    const defaults = createMenuLocalSettingsDefaults();
    const ownerId = normalizeString(source.ownerId, defaults.ownerId);
    const actorId = normalizeString(source.actorId, ownerId);
    const requestedAccessMode = normalizeString(source.developerModeVisibility, defaults.developerModeVisibility);
    const developerModeVisibility = VALID_DEVELOPER_ACCESS_MODE_SET.has(requestedAccessMode)
        ? requestedAccessMode
        : defaults.developerModeVisibility;
    const rawSessionType = normalizeString(source.sessionType, defaults.sessionType);
    const sessionType = normalizeSessionType(rawSessionType, defaults.sessionType);
    const legacyMultiplayerTransport = deriveLegacyMultiplayerTransport(rawSessionType);
    const multiplayerTransport = sessionType === MENU_SESSION_TYPES.MULTIPLAYER
        ? normalizeMultiplayerTransport(source.multiplayerTransport, legacyMultiplayerTransport)
        : '';
    const modePath = normalizeModePath(source.modePath, defaults.modePath);
    const startSetup = normalizeStartSetupState(source.startSetup);
    const toolsState = cloneObject(source.toolsState, createMenuToolsStateDefaults());
    const mobileControls = normalizeMobileClassicControlSettings(source.mobileControls);
    toolsState.activeSection = VALID_LEVEL4_SECTION_SET.has(String(toolsState.activeSection || '').trim())
        ? String(toolsState.activeSection || '').trim()
        : LEVEL4_SECTION_IDS.CONTROLS;
    const draftStateBySessionType = cloneObject(source.draftStateBySessionType, {});
    const telemetryState = cloneObject(source.telemetryState, createMenuTelemetryStateDefaults());
    const eventPlaylistState = normalizeEventPlaylistState(source.eventPlaylistState);

    return {
        schemaVersion: LOCAL_SETTINGS_SCHEMA_VERSION,
        ownerId,
        actorId,
        developerModeVisibility,
        developerModeEnabled: normalizeBoolean(source.developerModeEnabled, defaults.developerModeEnabled),
        developerThemeId: normalizeString(source.developerThemeId, defaults.developerThemeId),
        releasePreviewEnabled: normalizeBoolean(source.releasePreviewEnabled, defaults.releasePreviewEnabled),
        fixedPresetId: normalizeString(source.fixedPresetId, defaults.fixedPresetId),
        fixedPresetLockEnabled: normalizeBoolean(source.fixedPresetLockEnabled, defaults.fixedPresetLockEnabled),
        sessionType,
        multiplayerTransport,
        modePath,
        themeMode: normalizeString(source.themeMode, defaults.themeMode).toLowerCase() === 'hell' ? 'hell' : 'dunkel',
        shadowQuality: normalizeShadowQuality(source.shadowQuality, defaults.shadowQuality || DEFAULT_SHADOW_QUALITY),
        startSetup,
        toolsState,
        mobileControls,
        draftStateBySessionType,
        telemetryState,
        eventPlaylistState,
    };
}

function normalizeMatchSettingsContract(matchSettings = null) {
    const source = matchSettings && typeof matchSettings === 'object' ? matchSettings : {};
    return {
        schemaVersion: MATCH_SETTINGS_SCHEMA_VERSION,
        activePresetId: normalizeString(source.activePresetId, ''),
        activePresetKind: normalizeString(source.activePresetKind, ''),
        activePresetSourceId: normalizeString(source.activePresetSourceId, ''),
    };
}

function normalizePlayerLoadoutContract(playerLoadout = null) {
    const source = playerLoadout && typeof playerLoadout === 'object' ? playerLoadout : {};
    return {
        schemaVersion: PLAYER_LOADOUT_SCHEMA_VERSION,
        presetId: normalizeString(source.presetId, ''),
        presetKind: normalizeString(source.presetKind, ''),
    };
}

export function ensureMenuContractState(settings) {
    if (!settings || typeof settings !== 'object') return settings;

    settings.menuFeatureFlags = createMenuFeatureFlags(settings.menuFeatureFlags);
    settings.menuContracts = createMenuContractState(settings.menuContracts);
    settings.matchSettings = normalizeMatchSettingsContract(settings.matchSettings);
    settings.playerLoadout = normalizePlayerLoadoutContract(settings.playerLoadout);
    settings.localSettings = normalizeLocalSettingsState(settings.localSettings);
    return settings;
}

export function createSettingsDomainSnapshot(settings) {
    const source = settings && typeof settings === 'object' ? settings : {};
    ensureMenuContractState(source);

    return {
        matchSettings: {
            schemaVersion: MATCH_SETTINGS_SCHEMA_VERSION,
            mode: source.mode,
            gameMode: source.gameMode,
            mapKey: source.mapKey,
            numBots: source.numBots,
            botDifficulty: source.botDifficulty,
            botPolicyStrategy: source.botPolicyStrategy,
            winsNeeded: source.winsNeeded,
            autoRoll: source.autoRoll,
            portalsEnabled: source.portalsEnabled,
            hunt: source.hunt ? { ...source.hunt } : { respawnEnabled: false },
            gameplay: source.gameplay ? { ...source.gameplay } : {},
            recording: source.recording ? { ...source.recording } : {},
            preset: { ...source.matchSettings },
        },
        playerLoadout: {
            schemaVersion: PLAYER_LOADOUT_SCHEMA_VERSION,
            vehicles: source.vehicles ? { ...source.vehicles } : {},
            invertPitch: source.invertPitch ? { ...source.invertPitch } : {},
            cockpitCamera: source.cockpitCamera ? { ...source.cockpitCamera } : {},
            preset: { ...source.playerLoadout },
        },
        localSettings: {
            schemaVersion: LOCAL_SETTINGS_SCHEMA_VERSION,
            controls: source.controls ? { ...source.controls } : {},
            menuFeatureFlags: { ...source.menuFeatureFlags },
            state: { ...source.localSettings },
        },
    };
}

export function buildMenuLifecycleEventPayload(eventType, payload = null) {
    const sourcePayload = payload && typeof payload === 'object' ? payload : {};
    return {
        contractVersion: MENU_LIFECYCLE_EVENT_CONTRACT_VERSION,
        eventType: normalizeString(eventType, 'unknown'),
        ...sourcePayload,
    };
}

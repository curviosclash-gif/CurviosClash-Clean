import { normalizeString } from './ContractNormalizeUtils.js';

export { MULTIPLAYER_SESSION_ROLES } from './RuntimeSessionContract.js';

export const SIGNALING_SESSION_CONTRACT_VERSION = 'signaling-session.v1';
export const MULTIPLAYER_PROTOCOL_VERSION = 'curvios-multiplayer.v1';
export const MOBILE_LAN_PARTICIPANT_SURFACE_ID = 'mobile-app';
export const MOBILE_LAN_CROSSPLAY_MAP_KEYS = Object.freeze(['standard', 'maze']);

export const SIGNALING_COMMAND_TYPES = Object.freeze({
    LIST_LOBBIES: 'list_lobbies',
    CREATE_LOBBY: 'create_lobby',
    JOIN_LOBBY: 'join_lobby',
    RESUME_CONNECTION: 'resume_connection',
    ATTACH_TRANSPORT: 'attach_transport',
    READY: 'ready',
    INVALIDATE_READY: 'invalidate_ready',
    UPDATE_LOBBY_METADATA: 'update_lobby_metadata',
    START_MATCH: 'start_match',
    LEAVE: 'leave',
    OFFER: 'offer',
    ANSWER: 'answer',
    ICE: 'ice',
});

export const SIGNALING_EVENT_TYPES = Object.freeze({
    LOBBY_LIST: 'lobby_list',
    LOBBY_CREATED: 'lobby_created',
    LOBBY_JOINED: 'lobby_joined',
    CONNECTION_RESUMED: 'connection_resumed',
    TRANSPORT_ATTACHED: 'transport_attached',
    PLAYER_TRANSPORT_ATTACHED: 'player_transport_attached',
    PLAYER_JOINED: 'player_joined',
    PLAYER_LEFT: 'player_left',
    PLAYER_RECONNECTED: 'player_reconnected',
    PLAYER_READY: 'player_ready',
    LOBBY_METADATA_UPDATED: 'lobby_metadata_updated',
    MATCH_START: 'match_start',
    ERROR: 'error',
});

export const SIGNALING_HTTP_ROUTES = Object.freeze({
    LOBBY_CREATE: '/lobby/create',
    LOBBY_JOIN: '/lobby/join',
    LOBBY_REJOIN: '/lobby/rejoin',
    LOBBY_READY: '/lobby/ready',
    LOBBY_LEAVE: '/lobby/leave',
    LOBBY_ACK_PENDING: '/lobby/ack-pending',
    LOBBY_MATCH_START: '/lobby/match-start',
    LOBBY_INVALIDATE_READY: '/lobby/invalidate-ready',
    LOBBY_METADATA: '/lobby/metadata',
    LOBBY_STATUS: '/lobby/status',
    SIGNALING_OFFER: '/signaling/offer',
    SIGNALING_ANSWER: '/signaling/answer',
    SIGNALING_ICE: '/signaling/ice',
    DISCOVERY_INFO: '/discovery/info',
});

export function normalizePublicLobbyMetadata(value = null, fallbackHostName = 'Host') {
    const source = value && typeof value === 'object' ? value : {};
    return {
        hostName: normalizeString(source.hostName, fallbackHostName).slice(0, 48),
        mapKey: normalizeString(source.mapKey, 'standard').slice(0, 48),
        gameMode: normalizeString(source.gameMode, 'CLASSIC').slice(0, 32),
        modePath: normalizeString(source.modePath, 'normal').slice(0, 32),
        winsNeeded: Math.max(1, Math.min(99, Math.floor(Number(source.winsNeeded) || 5))),
        protocolVersion: normalizeString(source.protocolVersion, MULTIPLAYER_PROTOCOL_VERSION).slice(0, 48),
    };
}

export function normalizeSignalingParticipantMetadata(value = null) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        productSurfaceId: normalizeString(source.productSurfaceId, '').toLowerCase().slice(0, 32),
        protocolVersion: normalizeString(source.protocolVersion, '').slice(0, 48),
    };
}

export function isMobileLanParticipantMetadata(value = null) {
    return normalizeSignalingParticipantMetadata(value).productSurfaceId === MOBILE_LAN_PARTICIPANT_SURFACE_ID;
}

function createMobileLanCompatibilityResult(code = '') {
    return Object.freeze({ compatible: code === '', code });
}

export function validateMobileLanParticipantMetadata(value = null) {
    const metadata = normalizeSignalingParticipantMetadata(value);
    if (metadata.productSurfaceId !== MOBILE_LAN_PARTICIPANT_SURFACE_ID
        || metadata.protocolVersion !== MULTIPLAYER_PROTOCOL_VERSION) {
        return createMobileLanCompatibilityResult('mobile_protocol_incompatible');
    }
    return createMobileLanCompatibilityResult();
}

export function validateMobileLanLobbyMetadata(value = null) {
    const metadata = normalizePublicLobbyMetadata(value);
    if (metadata.protocolVersion !== MULTIPLAYER_PROTOCOL_VERSION) {
        return createMobileLanCompatibilityResult('mobile_protocol_incompatible');
    }
    if (metadata.modePath.toLowerCase() !== 'normal' || metadata.gameMode.toUpperCase() !== 'CLASSIC') {
        return createMobileLanCompatibilityResult('mobile_mode_incompatible');
    }
    if (!MOBILE_LAN_CROSSPLAY_MAP_KEYS.includes(metadata.mapKey)) {
        return createMobileLanCompatibilityResult('mobile_map_incompatible');
    }
    return createMobileLanCompatibilityResult();
}

export function validateMobileLanMatchSettingsSnapshot(value = null) {
    const snapshot = value && typeof value === 'object' ? value : {};
    const localSettings = snapshot.localSettings && typeof snapshot.localSettings === 'object'
        ? snapshot.localSettings
        : {};
    if (String(localSettings.sessionType || '').trim().toLowerCase() !== 'multiplayer'
        || String(localSettings.multiplayerTransport || '').trim().toLowerCase() !== 'lan'
        || String(localSettings.modePath || '').trim().toLowerCase() !== 'normal'
        || String(snapshot.gameMode || '').trim().toUpperCase() !== 'CLASSIC') {
        return createMobileLanCompatibilityResult('mobile_mode_incompatible');
    }
    if (!MOBILE_LAN_CROSSPLAY_MAP_KEYS.includes(String(snapshot.mapKey || '').trim())) {
        return createMobileLanCompatibilityResult('mobile_map_incompatible');
    }
    return createMobileLanCompatibilityResult();
}

export function validateMobileLanLobbyMatchConsistency(metadataValue = null, snapshotValue = null) {
    const metadata = normalizePublicLobbyMetadata(metadataValue);
    const snapshot = snapshotValue && typeof snapshotValue === 'object' ? snapshotValue : {};
    const localSettings = snapshot.localSettings && typeof snapshot.localSettings === 'object'
        ? snapshot.localSettings
        : {};
    if (metadata.mapKey !== String(snapshot.mapKey || '').trim()
        || metadata.gameMode.toUpperCase() !== String(snapshot.gameMode || '').trim().toUpperCase()
        || metadata.modePath.toLowerCase() !== String(localSettings.modePath || '').trim().toLowerCase()) {
        return createMobileLanCompatibilityResult('mobile_settings_mismatch');
    }
    return createMobileLanCompatibilityResult();
}

/**
 * Maps each signaling command to the session role that sends it.
 *
 * 'host'   — only the lobby host sends this command
 * 'client' — only a joining client sends this command
 * 'both'   — both host and client may send this command
 *
 * WebRTC topology assumed: star (one host, multiple clients).
 * The host sends OFFER to clients; clients reply with ANSWER.
 * ICE candidates are exchanged in both directions.
 */
export const SIGNALING_COMMAND_ROLE_MAP = Object.freeze({
    [SIGNALING_COMMAND_TYPES.LIST_LOBBIES]: 'both',
    [SIGNALING_COMMAND_TYPES.CREATE_LOBBY]: 'host',
    [SIGNALING_COMMAND_TYPES.JOIN_LOBBY]: 'client',
    [SIGNALING_COMMAND_TYPES.RESUME_CONNECTION]: 'both',
    [SIGNALING_COMMAND_TYPES.ATTACH_TRANSPORT]: 'both',
    [SIGNALING_COMMAND_TYPES.READY]: 'both',
    [SIGNALING_COMMAND_TYPES.INVALIDATE_READY]: 'host',
    [SIGNALING_COMMAND_TYPES.UPDATE_LOBBY_METADATA]: 'host',
    [SIGNALING_COMMAND_TYPES.START_MATCH]: 'host',
    [SIGNALING_COMMAND_TYPES.LEAVE]: 'both',
    [SIGNALING_COMMAND_TYPES.OFFER]: 'host',
    [SIGNALING_COMMAND_TYPES.ANSWER]: 'client',
    [SIGNALING_COMMAND_TYPES.ICE]: 'both',
});

/**
 * Returns the session role that sends a given signaling command.
 * Returns 'both', 'host', 'client', or null if the command is unknown.
 *
 * @param {string} commandType
 * @returns {'host'|'client'|'both'|null}
 */
export function resolveSignalingCommandRole(commandType) {
    const normalized = typeof commandType === 'string' ? commandType.trim().toLowerCase() : '';
    return Object.prototype.hasOwnProperty.call(SIGNALING_COMMAND_ROLE_MAP, normalized)
        ? SIGNALING_COMMAND_ROLE_MAP[normalized]
        : null;
}

function normalizeType(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return normalized || fallback;
}

export function createSignalingEnvelope(type, payload = null) {
    const normalizedType = normalizeType(type);
    if (!normalizedType) return null;
    return {
        contractVersion: SIGNALING_SESSION_CONTRACT_VERSION,
        type: normalizedType,
        ...(payload && typeof payload === 'object' ? payload : {}),
    };
}

export function normalizeSignalingEnvelope(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        contractVersion: typeof source.contractVersion === 'string'
            ? source.contractVersion
            : SIGNALING_SESSION_CONTRACT_VERSION,
        type: normalizeType(source.type),
        payload: source,
    };
}

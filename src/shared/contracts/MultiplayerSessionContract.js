// @ts-nocheck
export { MULTIPLAYER_SESSION_ROLES } from './RuntimeSessionContract.js';

export const MULTIPLAYER_SESSION_CONTRACT_VERSION = 'multiplayer-session.v2';
export const MULTIPLAYER_STATE_UPDATE_EVENT_SCHEMA_VERSION = 'multiplayer-state-update-event.v1';

export const MULTIPLAYER_MESSAGE_TYPES = Object.freeze({
    JOIN: 'join',
    READY: 'ready',
    LEAVE: 'leave',
    RECONNECT: 'reconnect',
    FULL_STATE_SYNC: 'full_state_sync',
    INPUT: 'input',
    STATE_SNAPSHOT: 'state_snapshot',
    PING: 'ping',
    PONG: 'pong',
    HEARTBEAT: 'heartbeat',
    HEARTBEAT_ACK: 'heartbeat_ack',
    HOST_LEAVING: 'host_leaving',
    PLAYER_DISCONNECTED: 'player_disconnected',
    PLAYER_RECONNECTED: 'player_reconnected',
    PLAYER_REMOVED: 'player_removed',
    MATCH_LIFECYCLE_SIGNAL: 'match_lifecycle_signal',
    // Transport-level round-start gate protocol:
    // Client notifies host that its arena is fully loaded.
    PLAYER_ARENA_LOADED: 'player_arena_loaded',
    // Host broadcasts this to all peers when all players are loaded and the round may start.
    // Only the host sends this; clients react by beginning arena simulation.
    ROUND_START_GATE: 'round_start_gate',
});

/**
 * Host-authoritative lifecycle signals carried via MATCH_LIFECYCLE_SIGNAL messages.
 * Clients react to these by triggering the corresponding lifecycle command on their facade.
 */
export const MULTIPLAYER_LIFECYCLE_SIGNAL_TYPES = Object.freeze({
    MATCH_FINALIZED: 'match_finalized',
});

const MULTIPLAYER_MESSAGE_TYPE_SET = new Set(Object.values(MULTIPLAYER_MESSAGE_TYPES));

function normalizeType(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return normalized || fallback;
}

export function isMultiplayerMessageType(value) {
    return MULTIPLAYER_MESSAGE_TYPE_SET.has(normalizeType(value));
}

export function buildMultiplayerSessionMessage(type, payload = null) {
    const normalizedType = normalizeType(type);
    if (!normalizedType) return null;
    return {
        contractVersion: MULTIPLAYER_SESSION_CONTRACT_VERSION,
        type: normalizedType,
        ...(payload && typeof payload === 'object' ? payload : {}),
    };
}

export function normalizeMultiplayerSessionMessage(rawMessage, fallbackType = '') {
    const source = rawMessage && typeof rawMessage === 'object' ? rawMessage : {};
    const type = normalizeType(source.type, normalizeType(fallbackType));
    return {
        contractVersion: typeof source.contractVersion === 'string'
            ? source.contractVersion
            : MULTIPLAYER_SESSION_CONTRACT_VERSION,
        type,
        payload: source,
    };
}

function resolveStateUpdateMessageType(source, fallbackType = MULTIPLAYER_MESSAGE_TYPES.STATE_SNAPSHOT) {
    const normalizedFallbackType = /** @type {any} */ (normalizeType(fallbackType, MULTIPLAYER_MESSAGE_TYPES.STATE_SNAPSHOT));
    const normalizedType = normalizeType(source?.messageType || source?.type, normalizedFallbackType);
    return isMultiplayerMessageType(normalizedType) ? /** @type {any} */ (normalizedType) : /** @type {any} */ (MULTIPLAYER_MESSAGE_TYPES.STATE_SNAPSHOT);
}

export function buildMultiplayerStateUpdateEvent(rawState, options = {}) {
    const state = rawState && typeof rawState === 'object' ? rawState : {};
    const messageType = resolveStateUpdateMessageType(state, options?.messageType);
    const contractVersion = typeof state.contractVersion === 'string'
        ? state.contractVersion
        : MULTIPLAYER_SESSION_CONTRACT_VERSION;
    return {
        schemaVersion: MULTIPLAYER_STATE_UPDATE_EVENT_SCHEMA_VERSION,
        contractVersion,
        messageType,
        state,
    };
}

/**
 * Message types that the HOST peer sends with authority.
 * Consumers use this to distinguish host-driven updates from peer-driven messages.
 */
/** @type {Readonly<Set<any>>} */
export const MULTIPLAYER_HOST_AUTHORITATIVE_MESSAGE_TYPES = Object.freeze(new Set([
    MULTIPLAYER_MESSAGE_TYPES.FULL_STATE_SYNC,
    MULTIPLAYER_MESSAGE_TYPES.STATE_SNAPSHOT,
    MULTIPLAYER_MESSAGE_TYPES.HOST_LEAVING,
    MULTIPLAYER_MESSAGE_TYPES.PLAYER_DISCONNECTED,
    MULTIPLAYER_MESSAGE_TYPES.PLAYER_RECONNECTED,
    MULTIPLAYER_MESSAGE_TYPES.PLAYER_REMOVED,
    MULTIPLAYER_MESSAGE_TYPES.MATCH_LIFECYCLE_SIGNAL,
    // ROUND_START_GATE is host-authoritative: only the host decides when all players
    // are loaded and the round may begin.  Clients must not send this type.
    MULTIPLAYER_MESSAGE_TYPES.ROUND_START_GATE,
]));

/**
 * Message types that only a CLIENT peer sends.
 */
/** @type {Readonly<Set<any>>} */
export const MULTIPLAYER_CLIENT_ONLY_MESSAGE_TYPES = Object.freeze(new Set([
    MULTIPLAYER_MESSAGE_TYPES.JOIN,
    MULTIPLAYER_MESSAGE_TYPES.RECONNECT,
]));

/**
 * Returns true if the message type is host-authoritative (only the host sends it).
 * @param {string} messageType
 * @returns {boolean}
 */
export function isHostAuthoritativeMessageType(messageType) {
    return MULTIPLAYER_HOST_AUTHORITATIVE_MESSAGE_TYPES.has(
        normalizeType(messageType)
    );
}

/**
 * Returns true if the message type is client-only (only a joining client sends it).
 * @param {string} messageType
 * @returns {boolean}
 */
export function isClientOnlyMessageType(messageType) {
    return MULTIPLAYER_CLIENT_ONLY_MESSAGE_TYPES.has(
        normalizeType(messageType)
    );
}

export function normalizeMultiplayerStateUpdateEvent(rawEvent) {
    const source = rawEvent && typeof rawEvent === 'object' ? rawEvent : {};
    const state = source.state && typeof source.state === 'object'
        ? source.state
        : source;
    const normalized = buildMultiplayerStateUpdateEvent(state, {
        messageType: source.messageType || source.type || state?.type,
    });
    if (typeof source.schemaVersion === 'string') {
        const schemaVersion = source.schemaVersion.trim();
        if (schemaVersion) {
            normalized.schemaVersion = schemaVersion;
        }
    }
    if (typeof source.contractVersion === 'string') {
        const contractVersion = source.contractVersion.trim();
        if (contractVersion) {
            normalized.contractVersion = contractVersion;
        }
    }
    if (typeof source.messageType === 'string') {
        const messageType = resolveStateUpdateMessageType({ messageType: source.messageType }, normalized.messageType);
        normalized.messageType = messageType;
    }
    return normalized;
}

import { tryCloneJsonValue } from '../utils/JsonClone.js';
import { normalizeString } from './ContractNormalizeUtils.js';

export const SESSION_RUNTIME_EVENT_CONTRACT_VERSION = 'session-runtime-event.v1';

export const SESSION_RUNTIME_EVENT_TYPES = Object.freeze({
    COMMAND_OBSERVED: 'runtime_command_observed',
    STATE_TRANSITIONED: 'runtime_state_transitioned',
    SESSION_INITIALIZED: 'session_initialized',
    SESSION_INIT_FAILED: 'session_init_failed',
    MATCH_FINALIZING: 'match_finalizing',
    MATCH_FINALIZED: 'match_finalized',
    MATCH_FINALIZE_FAILED: 'match_finalize_failed',
    MENU_OPENED: 'menu_opened',
    LOBBY_SESSION_CHANGED: 'lobby_session_changed',
    CAPABILITY_FALLBACK_USED: 'capability_fallback_used',
});

const EVENT_CATEGORY_BY_TYPE = Object.freeze({
    [SESSION_RUNTIME_EVENT_TYPES.COMMAND_OBSERVED]: 'command',
    [SESSION_RUNTIME_EVENT_TYPES.STATE_TRANSITIONED]: 'state',
    [SESSION_RUNTIME_EVENT_TYPES.SESSION_INITIALIZED]: 'session',
    [SESSION_RUNTIME_EVENT_TYPES.SESSION_INIT_FAILED]: 'session',
    [SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZING]: 'finalize',
    [SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZED]: 'finalize',
    [SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZE_FAILED]: 'finalize',
    [SESSION_RUNTIME_EVENT_TYPES.MENU_OPENED]: 'lifecycle',
    [SESSION_RUNTIME_EVENT_TYPES.LOBBY_SESSION_CHANGED]: 'lobby',
    [SESSION_RUNTIME_EVENT_TYPES.CAPABILITY_FALLBACK_USED]: 'capability',
});

/** @type {Set<string>} */
const SESSION_RUNTIME_EVENT_TYPE_SET = new Set(Object.values(SESSION_RUNTIME_EVENT_TYPES));

function normalizeNullableString(value) {
    const normalized = normalizeString(value, '');
    return normalized || null;
}

function normalizeTimestamp(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? Math.max(0, Math.floor(timestamp)) : 0;
}

function normalizeSequence(value) {
    const sequence = Number(value);
    return Number.isFinite(sequence) ? Math.max(0, Math.floor(sequence)) : 0;
}

function normalizeSessionRuntimeEventType(value, fallback = '') {
    const normalized = normalizeString(value, '').toLowerCase();
    if (SESSION_RUNTIME_EVENT_TYPE_SET.has(normalized)) {
        return normalized;
    }
    return normalizeString(fallback, '');
}

function cloneEventPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return {};
    }
    return tryCloneJsonValue(payload, { ...payload });
}

export function createSessionRuntimeEvent(type, details = {}) {
    const normalizedType = normalizeSessionRuntimeEventType(type);
    if (!normalizedType) return null;
    const source = /** @type {any} */ (details && typeof details === 'object' ? details : {});
    return {
        contractVersion: SESSION_RUNTIME_EVENT_CONTRACT_VERSION,
        type: normalizedType,
        category: EVENT_CATEGORY_BY_TYPE[normalizedType] || 'runtime',
        sequence: normalizeSequence(source.sequence),
        timestampMs: normalizeTimestamp(source.timestampMs),
        sessionId: normalizeNullableString(source.sessionId),
        lifecycleState: normalizeString(source.lifecycleState, 'unknown'),
        finalizeState: normalizeString(source.finalizeState, 'idle'),
        source: normalizeString(source.source, 'runtime'),
        payload: cloneEventPayload(source.payload),
    };
}

export function normalizeSessionRuntimeEvent(event = null, fallbackType = '') {
    if (!event || typeof event !== 'object') {
        return createSessionRuntimeEvent(fallbackType);
    }
    return createSessionRuntimeEvent(event.type || fallbackType, event);
}

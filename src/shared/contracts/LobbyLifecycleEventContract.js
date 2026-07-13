import { MATCH_LIFECYCLE_CONTRACT_VERSION } from './MatchLifecycleContract.js';

export const LOBBY_LIFECYCLE_EVENT_CONTRACT_VERSION = MATCH_LIFECYCLE_CONTRACT_VERSION;

function normalizeString(value, fallback) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

export function buildLobbyLifecycleEventPayload(eventType, payload = null) {
    const sourcePayload = payload && typeof payload === 'object' ? payload : {};
    return {
        contractVersion: LOBBY_LIFECYCLE_EVENT_CONTRACT_VERSION,
        eventType: normalizeString(eventType, 'unknown'),
        ...sourcePayload,
    };
}

import { normalizeSessionRuntimeEvent } from './SessionRuntimeEventContract.js';
import { normalizeString } from './ContractNormalizeUtils.js';

export const SESSION_RUNTIME_SNAPSHOT_CONTRACT_VERSION = 'session-runtime-snapshot.v1';
export const MATCH_FLOW_SNAPSHOT_CONTRACT_VERSION = 'match-flow-snapshot.v1';
export const RUNTIME_OBSERVABILITY_SNAPSHOT_CONTRACT_VERSION = 'runtime-observability-snapshot.v1';

function normalizeNullableString(value) {
    const normalized = normalizeString(value, '');
    return normalized || null;
}

function normalizeTimestamp(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? Math.max(0, Math.floor(timestamp)) : 0;
}

function normalizeNonNegativeInt(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

export function createSessionRuntimeSnapshot(payload = {}) {
    const source = /** @type {any} */ (payload && typeof payload === 'object' ? payload : {});
    return {
        contractVersion: SESSION_RUNTIME_SNAPSHOT_CONTRACT_VERSION,
        sessionId: normalizeNullableString(source.sessionId),
        lifecycleState: normalizeString(source.lifecycleState, 'unknown'),
        finalizeState: normalizeString(source.finalizeState, 'idle'),
        gameStateId: normalizeString(source.gameStateId, ''),
        sessionType: normalizeString(source.sessionType, source.isNetworkSession === true ? 'multiplayer' : 'local'),
        runtimeTransportKind: normalizeString(source.runtimeTransportKind, source.isNetworkSession === true ? 'network' : 'local'),
        isNetworkSession: source.isNetworkSession === true,
        isHost: source.isHost !== false,
        pendingSessionInit: source.pendingSessionInit === true,
        pendingFinalizeTrigger: normalizeString(source.pendingFinalizeTrigger, ''),
        finalizeErrorMessage: normalizeString(source.finalizeErrorMessage, ''),
        updatedAt: normalizeTimestamp(source.updatedAt),
    };
}

export function createMatchFlowSnapshot(payload = {}) {
    const source = /** @type {any} */ (payload && typeof payload === 'object' ? payload : {});
    return {
        contractVersion: MATCH_FLOW_SNAPSHOT_CONTRACT_VERSION,
        sessionId: normalizeNullableString(source.sessionId),
        gameStateId: normalizeString(source.gameStateId, ''),
        uiStateId: normalizeString(source.uiStateId, ''),
        roundStateId: normalizeString(source.roundStateId, ''),
        isPaused: source.isPaused === true,
        canReturnToMenu: source.canReturnToMenu === true,
        pendingFinalizeTrigger: normalizeString(source.pendingFinalizeTrigger, ''),
        finalizeErrorMessage: normalizeString(source.finalizeErrorMessage, ''),
        isNetworkSession: source.isNetworkSession === true,
        isHost: source.isHost !== false,
        lifecycleState: normalizeString(source.lifecycleState, 'unknown'),
        finalizeState: normalizeString(source.finalizeState, 'idle'),
        updatedAt: normalizeTimestamp(source.updatedAt),
    };
}

export function createRuntimeObservabilitySnapshot(payload = {}) {
    const source = /** @type {any} */ (payload && typeof payload === 'object' ? payload : {});
    const recentEvents = Array.isArray(source.recentEvents)
        ? source.recentEvents
            .map((event) => normalizeSessionRuntimeEvent(event))
            .filter(Boolean)
        : [];
    return {
        contractVersion: RUNTIME_OBSERVABILITY_SNAPSHOT_CONTRACT_VERSION,
        sessionId: normalizeNullableString(source.sessionId),
        lifecycleState: normalizeString(source.lifecycleState, 'unknown'),
        finalizeState: normalizeString(source.finalizeState, 'idle'),
        pendingSessionInit: source.pendingSessionInit === true,
        pendingFinalize: source.pendingFinalize === true,
        finalizeErrorMessage: normalizeString(source.finalizeErrorMessage, ''),
        lastSequence: normalizeNonNegativeInt(source.lastSequence),
        lastEventType: normalizeString(source.lastEventType, ''),
        eventCount: normalizeNonNegativeInt(source.eventCount || recentEvents.length),
        updatedAt: normalizeTimestamp(source.updatedAt),
        recentEvents,
    };
}

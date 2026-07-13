import { SESSION_RUNTIME_EVENT_TYPES } from '../../shared/contracts/SessionRuntimeEventContract.js';
import { recordSessionRuntimeEvent } from '../../shared/runtime/SessionRuntimeObservability.js';

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function summarizeLobbySessionState(sessionState = null) {
    const source = sessionState && typeof sessionState === 'object' ? sessionState : {};
    return {
        joined: source.joined === true,
        connected: source.connected === true,
        lobbyCode: normalizeString(source.lobbyCode, ''),
        role: normalizeString(source.role, 'offline'),
        isHost: source.isHost === true,
        memberCount: Number.isFinite(Number(source.memberCount)) ? Number(source.memberCount) : 0,
        readyCount: Number.isFinite(Number(source.readyCount)) ? Number(source.readyCount) : 0,
        pendingMatchCommandId: normalizeString(source.pendingMatchCommandId, ''),
        transportKind: normalizeString(source.transport, ''),
    };
}

function isMeaningfulLobbySessionState(summary = null) {
    return !!(
        summary?.joined
        || summary?.connected
        || summary?.lobbyCode
        || summary?.memberCount
        || summary?.pendingMatchCommandId
    );
}

function areLobbySessionStatesEqual(left = null, right = null) {
    return !!left
        && !!right
        && left.joined === right.joined
        && left.connected === right.connected
        && left.lobbyCode === right.lobbyCode
        && left.role === right.role
        && left.isHost === right.isHost
        && left.memberCount === right.memberCount
        && left.readyCount === right.readyCount
        && left.pendingMatchCommandId === right.pendingMatchCommandId
        && left.transportKind === right.transportKind;
}

function deriveLobbySwitchKind(previousState = null, nextState = null) {
    if (!previousState?.joined && nextState?.joined) return 'join';
    if (previousState?.joined && !nextState?.joined) return 'leave';
    if ((previousState?.lobbyCode || '') !== (nextState?.lobbyCode || '')) return 'switch';
    if ((previousState?.pendingMatchCommandId || '') !== (nextState?.pendingMatchCommandId || '')) return 'match_start';
    return 'update';
}

export function observeLobbySessionStateChange(runtimeSource, previousState, sessionState = null) {
    const nextState = summarizeLobbySessionState(sessionState);
    if (
        (previousState || isMeaningfulLobbySessionState(nextState))
        && !areLobbySessionStatesEqual(previousState, nextState)
    ) {
        recordSessionRuntimeEvent(runtimeSource, {
            type: SESSION_RUNTIME_EVENT_TYPES.LOBBY_SESSION_CHANGED,
            source: 'menu_multiplayer_bridge',
            payload: {
                switchKind: deriveLobbySwitchKind(previousState, nextState),
                previousLobbyCode: previousState?.lobbyCode || '',
                lobbyState: nextState,
            },
        });
    }
    return nextState;
}

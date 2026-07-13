import { SIGNALING_EVENT_TYPES } from '../shared/contracts/SignalingSessionContract.js';
import {
    createInvalidSignalingPayloadError,
    createServerSignalingError,
    toErrorPayload,
} from './OnlineSignalingSupport.js';

function applyServerStateOrFallbackForLobbyCreated(lobby, msg) {
    lobby.lobbyCode = msg.lobbyCode;
    lobby._playerId = msg.playerId;
    const serverState = msg?.sessionState && typeof msg.sessionState === 'object'
        ? msg.sessionState
        : {
            lobbyCode: lobby.lobbyCode,
            hostPeerId: lobby._playerId,
            maxPlayers: Number(msg.maxPlayers || 10),
            members: [{
                peerId: lobby._playerId,
                actorId: 'Host',
                name: 'Host',
                role: 'host',
                ready: true,
                joinedAt: Date.now(),
                lastSeenAt: Date.now(),
            }],
            updatedAt: Date.now(),
            revision: Number(lobby.sessionState.revision || 0) + 1,
        };
    lobby._applySessionState(serverState);
}

function applyServerStateOrFallbackForLobbyJoined(lobby, msg) {
    lobby._playerId = msg.playerId;
    const serverState = msg?.sessionState && typeof msg.sessionState === 'object'
        ? msg.sessionState
        : {
            ...lobby.sessionState,
            lobbyCode: msg.lobbyCode || lobby.sessionState.lobbyCode,
            updatedAt: Date.now(),
            revision: Number(lobby.sessionState.revision || 0) + 1,
        };
    // A pendingMatchStart that predates this join belongs to a match that is
    // already running — mark it handled so the fresh joiner does not
    // immediately fire a stale matchStart event.
    const staleCommandId = String(serverState?.pendingMatchStart?.commandId || '').trim();
    if (staleCommandId) {
        lobby._lastHandledMatchCommandId = staleCommandId;
    }
    lobby._applySessionState(serverState);
}

function applyServerStateOrFallbackForConnectionResumed(lobby, msg) {
    lobby._playerId = msg.playerId || lobby._playerId;
    if (msg?.sessionState && typeof msg.sessionState === 'object') {
        lobby._applySessionState(msg.sessionState);
    }
    const now = Date.now();
    if (!msg?.sessionState || typeof msg.sessionState !== 'object') {
        lobby._applySessionState({
            ...lobby.sessionState,
            lobbyCode: msg.lobbyCode || lobby.sessionState.lobbyCode,
            updatedAt: now,
            revision: Number(lobby.sessionState.revision || 0) + 1,
        });
    }
    lobby._emit('connectionResumed', { sessionState: lobby.sessionState });
}

export function routeOnlineLobbyMessage(
    lobby,
    msg,
    { connectResolve = null, connectReject = null, connectState = null } = {}
) {
    const messageType = typeof msg?.type === 'string' ? msg.type.trim() : '';
    if (!messageType) {
        const payloadError = createInvalidSignalingPayloadError({
            signalingUrl: lobby._signalingUrl,
            reason: 'missing_type',
        });
        lobby._emit('error', toErrorPayload(payloadError));
        if (connectReject && !connectState?.settled) {
            connectReject(payloadError);
        }
        return;
    }

    lobby._resolveMatchingMutationAcks(msg);

    switch (messageType) {
    case SIGNALING_EVENT_TYPES.LOBBY_CREATED:
        applyServerStateOrFallbackForLobbyCreated(lobby, msg);
        if (connectResolve) connectResolve();
        break;

    case SIGNALING_EVENT_TYPES.LOBBY_JOINED:
        applyServerStateOrFallbackForLobbyJoined(lobby, msg);
        if (connectResolve) connectResolve();
        break;

    case SIGNALING_EVENT_TYPES.CONNECTION_RESUMED:
        applyServerStateOrFallbackForConnectionResumed(lobby, msg);
        if (connectResolve) connectResolve();
        break;

    case SIGNALING_EVENT_TYPES.PLAYER_JOINED: {
        if (msg?.sessionState && typeof msg.sessionState === 'object') {
            lobby._applySessionState(msg.sessionState);
            break;
        }
        const now = Date.now();
        const peerId = String(msg.peerId || '').trim();
        if (!peerId) break;
        const exists = lobby.sessionState.members.some((member) => member.peerId === peerId);
        if (!exists) {
            lobby._applySessionState({
                ...lobby.sessionState,
                members: [
                    ...lobby.sessionState.members,
                    {
                        peerId,
                        actorId: String(msg.name || peerId).trim(),
                        name: String(msg.name || peerId).trim(),
                        role: peerId === lobby.sessionState.hostPeerId ? 'host' : 'client',
                        ready: false,
                        joinedAt: now,
                        lastSeenAt: now,
                    },
                ],
                updatedAt: now,
                revision: Number(lobby.sessionState.revision || 0) + 1,
            });
        }
        break;
    }

    case SIGNALING_EVENT_TYPES.PLAYER_LEFT:
        if (msg?.sessionState && typeof msg.sessionState === 'object') {
            lobby._applySessionState(msg.sessionState);
            break;
        }
        lobby._applySessionState({
            ...lobby.sessionState,
            members: lobby.sessionState.members.filter((member) => member.peerId !== msg.peerId),
            updatedAt: Date.now(),
            revision: Number(lobby.sessionState.revision || 0) + 1,
        });
        break;

    case SIGNALING_EVENT_TYPES.PLAYER_READY:
        if (msg?.sessionState && typeof msg.sessionState === 'object') {
            lobby._applySessionState(msg.sessionState);
            break;
        }
        lobby._setReadyStateFor(msg.peerId, msg.ready === true);
        break;

    case SIGNALING_EVENT_TYPES.MATCH_START: {
        if (msg?.sessionState && typeof msg.sessionState === 'object') {
            lobby._applySessionState(msg.sessionState);
        }
        const pendingMatchStart = msg?.pendingMatchStart && typeof msg.pendingMatchStart === 'object'
            ? {
                ...msg.pendingMatchStart,
                settingsSnapshot: msg.pendingMatchStart.settingsSnapshot ?? null,
            }
            : null;
        const commandId = String(pendingMatchStart?.commandId || '').trim();
        if (!commandId || commandId === lobby._lastHandledMatchCommandId) {
            break;
        }
        lobby._lastHandledMatchCommandId = commandId;
        lobby._emit('matchStart', {
            pendingMatchStart,
            players: lobby.players,
            settings: pendingMatchStart.settingsSnapshot ?? lobby.settings,
            sessionState: lobby.sessionState,
        });
        break;
    }

    case SIGNALING_EVENT_TYPES.PLAYER_RECONNECTED: {
        const peerId = String(msg.peerId || '').trim();
        if (msg?.sessionState && typeof msg.sessionState === 'object') {
            lobby._applySessionState(msg.sessionState);
        }
        if (!peerId) break;
        lobby._emit('playerReconnected', { peerId, sessionState: lobby.sessionState });
        break;
    }

    case SIGNALING_EVENT_TYPES.ERROR: {
        const err = createServerSignalingError(msg.message);
        lobby._rejectAllPendingMutationAcks(err);
        lobby._emit('error', toErrorPayload(err));
        if (connectReject) {
            if (connectState?.rejected) break;
            if (connectState) connectState.rejected = true;
            connectReject(err);
        }
        break;
    }

    default:
        break;
    }
}

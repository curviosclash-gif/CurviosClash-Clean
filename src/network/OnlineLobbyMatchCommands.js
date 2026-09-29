// Host-only match commands of the online lobby: start a match and report it over.
import {
    SIGNALING_COMMAND_TYPES,
    SIGNALING_EVENT_TYPES,
} from '../shared/contracts/SignalingSessionContract.js';

const MATCH_START_ACK_TIMEOUT_MS = 5_000;

function requireHost(lobby, message) {
    if (lobby.isHost === true) return;
    const error = new Error(message);
    error.code = 'host_required';
    throw error;
}

/**
 * @param {import('./OnlineMatchLobby.js').OnlineMatchLobby} lobby
 * @param {{ settingsSnapshot?: unknown, settingsRevision?: number }} [options]
 */
export async function startOnlineLobbyMatch(lobby, options = {}) {
    requireHost(lobby, 'Nur der Host darf das Match starten.');
    const commandId = lobby._createMutationAckId('match');
    const pendingMatchStart = {
        commandId,
        lobbyCode: lobby.sessionState.lobbyCode || lobby.lobbyCode || '',
        hostPeerId: lobby.sessionState.hostPeerId || lobby._playerId || '',
        issuedAt: lobby._lobbyRuntime.nowMs(),
        settingsSnapshot: options?.settingsSnapshot ?? lobby.settings ?? null,
        settingsRevision: options.settingsRevision ?? lobby.sessionState.settingsRevision ?? undefined,
    };
    await lobby._sendMutationWithAck({
        commandType: SIGNALING_COMMAND_TYPES.START_MATCH,
        payload: pendingMatchStart,
        ackMatcher: (msg) => (
            msg?.type === SIGNALING_EVENT_TYPES.MATCH_START
            && String(msg?.pendingMatchStart?.commandId || '').trim() === commandId
        ),
        timeoutMs: MATCH_START_ACK_TIMEOUT_MS,
    });
    return { pendingMatchStart };
}

/**
 * Tells the server that the match started by `commandId` is over, so the lobby
 * takes joins, settings changes and the next start again.
 *
 * @param {import('./OnlineMatchLobby.js').OnlineMatchLobby} lobby
 * @param {string} commandId
 */
export async function endOnlineLobbyMatch(lobby, commandId) {
    requireHost(lobby, 'Nur der Host darf das Match beenden.');
    return lobby._sendMutationWithAck({
        commandType: SIGNALING_COMMAND_TYPES.END_MATCH,
        payload: { commandId: String(commandId || '').trim() },
        ackMatcher: (msg) => msg?.type === SIGNALING_EVENT_TYPES.MATCH_ENDED,
    });
}

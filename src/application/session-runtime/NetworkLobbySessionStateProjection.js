import {
    buildSessionState,
    createIdleSessionState,
    deepClone,
    normalizeString,
} from './NetworkLobbyServiceSupport.js';

/** @param {{ transport?: string }} options */
export function createNetworkLobbySessionStateProjection({ transport } = {}) {
    let sessionState = createIdleSessionState('', transport);

    function projectLobbyState(lobbyState, options = {}) {
        sessionState = buildSessionState(lobbyState, {
            signalingUrl: options.signalingUrl,
            localPeerId: options.localPeerId,
            actorId: options.actorId,
            transport,
        });
        return getSessionState();
    }

    function reset() {
        sessionState = createIdleSessionState('', transport);
        return getSessionState();
    }

    function getSessionState() {
        return deepClone(sessionState) || createIdleSessionState('', transport);
    }

    function getSnapshot(options = {}) {
        return deepClone({
            lobbyCode: sessionState.lobbyCode,
            signalingUrl: options.signalingUrl,
            hostSettingsSnapshot: options.hostSettingsSnapshot,
            transport,
        });
    }

    function getConnectionContext(options = {}) {
        return {
            isHost: sessionState.isHost === true,
            playerId: normalizeString(sessionState.peerId, ''),
            peerToken: normalizeString(options.peerToken, ''),
            lobbyCode: sessionState.lobbyCode,
            signalingUrl: options.signalingUrl,
            transport,
        };
    }

    return Object.freeze({
        projectLobbyState,
        reset,
        getSessionState,
        getSnapshot,
        getConnectionContext,
    });
}

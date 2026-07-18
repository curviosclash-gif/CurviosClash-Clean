import {
    SIGNALING_COMMAND_TYPES,
    SIGNALING_EVENT_TYPES,
    createSignalingEnvelope,
} from '../shared/contracts/SignalingSessionContract.js';
import {
    buildSocketCloseDetails,
    createInvalidSignalingPayloadError,
    createNetworkUnavailableSignalingError,
    createServerSignalingError,
    createSocketLifecycleError,
    resolveConnectTimeoutMs,
    resolveOnlineSignalingUrl,
} from './OnlineSignalingSupport.js';

const LOBBY_LIST_TIMEOUT_MS = 3_500;
const MAX_LOBBY_LIST_ITEMS = 50;

function normalizeOpenLobbyList(value) {
    if (!Array.isArray(value)) return [];
    const seenCodes = new Set();
    return value.slice(0, MAX_LOBBY_LIST_ITEMS).flatMap((entry) => {
        const lobbyCode = String(entry?.lobbyCode || '').trim().toUpperCase();
        if (!lobbyCode || seenCodes.has(lobbyCode)) return [];
        seenCodes.add(lobbyCode);
        const maxPlayers = Math.max(2, Math.floor(Number(entry?.maxPlayers) || 2));
        const memberCount = Math.max(1, Math.min(maxPlayers, Math.floor(Number(entry?.memberCount) || 1)));
        return [{
            lobbyCode,
            memberCount,
            maxPlayers,
            createdAt: Math.max(0, Math.floor(Number(entry?.createdAt) || 0)),
            updatedAt: Math.max(0, Math.floor(Number(entry?.updatedAt) || 0)),
        }];
    });
}

export function listOpenOnlineLobbies(signalingUrl, options = {}) {
    const resolvedUrl = resolveOnlineSignalingUrl(signalingUrl);
    const WebSocketImpl = options.WebSocketImpl || globalThis.WebSocket;
    const timeoutMs = resolveConnectTimeoutMs(options.timeoutMs, LOBBY_LIST_TIMEOUT_MS);
    if (typeof WebSocketImpl !== 'function') {
        return Promise.reject(createNetworkUnavailableSignalingError({
            signalingUrl: resolvedUrl,
            source: 'lobby_list_websocket_missing',
        }));
    }

    return new Promise((resolve, reject) => {
        const socket = new WebSocketImpl(resolvedUrl);
        let settled = false;
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timerId);
            try { socket.close(); } catch { /* response is already settled */ }
            callback(value);
        };
        const timerId = setTimeout(() => finish(
            reject,
            createSocketLifecycleError('timeout', { signalingUrl: resolvedUrl, source: 'lobby_list' })
        ), timeoutMs);

        socket.onopen = () => {
            try {
                socket.send(JSON.stringify(createSignalingEnvelope(SIGNALING_COMMAND_TYPES.LIST_LOBBIES)));
            } catch (error) {
                finish(reject, createSocketLifecycleError(
                    'error',
                    { signalingUrl: resolvedUrl, source: 'lobby_list_send' },
                    error
                ));
            }
        };
        socket.onmessage = (event) => {
            let message;
            try {
                message = JSON.parse(String(event.data));
            } catch (error) {
                finish(reject, createInvalidSignalingPayloadError({ source: 'lobby_list' }, error));
                return;
            }
            if (message?.type === SIGNALING_EVENT_TYPES.ERROR) {
                finish(reject, createServerSignalingError(message.message, { signalingUrl: resolvedUrl }));
                return;
            }
            if (message?.type === SIGNALING_EVENT_TYPES.LOBBY_LIST) {
                finish(resolve, normalizeOpenLobbyList(message.lobbies));
            }
        };
        socket.onerror = (error) => finish(
            reject,
            createSocketLifecycleError('error', { signalingUrl: resolvedUrl, source: 'lobby_list' }, error)
        );
        socket.onclose = (event) => {
            if (settled) return;
            finish(reject, createSocketLifecycleError('close', buildSocketCloseDetails(event, resolvedUrl)));
        };
    });
}

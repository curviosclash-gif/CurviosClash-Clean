// ============================================
// OnlineSessionAdapter.js - Internet session via WebSocket signaling + STUN/TURN
// ============================================

import { createLogger } from '../shared/logging/Logger.js';
import { SessionAdapterBase } from './SessionAdapterBase.js';
import { PeerConnectionManager } from './PeerConnectionManager.js';
import { DataChannelManager } from './DataChannelManager.js';
import { LatencyMonitor } from './LatencyMonitor.js';
import {
    buildMultiplayerStateUpdateEvent,
    isMultiplayerMessageAllowedForSender,
    MULTIPLAYER_MESSAGE_TYPES,
    normalizeMultiplayerSessionMessage,
} from '../shared/contracts/MultiplayerSessionContract.js';
import {
    SIGNALING_COMMAND_TYPES,
    createSignalingEnvelope,
} from '../shared/contracts/SignalingSessionContract.js';
import {
    resolveRetryDelays,
    delay,
    resolveConnectTimeoutMs,
    resolveOnlineSignalingUrl,
    buildSocketCloseDetails,
    createSocketLifecycleError,
    createServerSignalingError,
    createInvalidSignalingPayloadError,
    isRetryableSignalingError,
    toErrorPayload,
} from './OnlineSignalingSupport.js';
import { routeOnlineSessionSignalingMessage } from './OnlineSessionSignalingRouter.js';
import { waitForStateChannelOpen } from './LANSignalingClient.js';

const logger = createLogger('OnlineSessionAdapter');
const CLIENT_CHANNEL_OPEN_TIMEOUT_MS = 10_000;

function resolveSignalingUrl(explicit) {
    if (explicit) return explicit;
    const signalingUrl = /** @type {any} */ (globalThis).__SIGNALING_URL__;
    return typeof signalingUrl === 'string' ? signalingUrl : '';
}

/**
 * SessionAdapter for Internet play.
 * Uses a self-hosted WebSocket signaling server for lobby and SDP exchange.
 * After signaling, communication is P2P via WebRTC (with STUN/TURN for NAT traversal).
 */
export class OnlineSessionAdapter extends SessionAdapterBase {
    constructor(options = {}) {
        super({
            isHost: !!options.isHost,
            reconnectWindowMs: options.reconnectWindowMs,
            now: options.now,
        });
        this._signalingUrl = resolveSignalingUrl(options.signalingUrl);
        this._iceServers = options.iceServers || null;
        this._ws = null;
        this._dataChannelManager = new DataChannelManager();
        this._peerManager = new PeerConnectionManager({
            isHost: this.isHost,
            iceServers: this._iceServers,
            dataChannelManager: this._dataChannelManager,
        });
        this._latencyMonitor = new LatencyMonitor({
            onPingNeeded: (peerId, pingId) => {
                this._sendStateToPeer(
                    peerId,
                    this._createStateMessage(MULTIPLAYER_MESSAGE_TYPES.PING, { pingId })
                );
            },
        });
        this._lobbyCode = null;
        this._hostPeerId = null;
        this._sessionToken = String(options.sessionToken || options.peerToken || '').trim();
        this._usesAttachedTransport = false;

        this._dataChannelManager.on('message', ({ peerId, channel, data }) => {
            this._handleDataMessage(peerId, channel, data);
        });

        this._dataChannelManager.on('channelClose', ({ peerId }) => {
            this._registerPeerDisconnect(peerId, 'channel-close');
        });

        this._dataChannelManager.on('channelOpen', ({ peerId, channel }) => this._resolvePeerReconnectOnChannelOpen(peerId, channel));

        this._peerManager.on('peerDisconnected', ({ peerId, state }) => {
            this._registerPeerDisconnect(peerId, state);
        });

        this._peerManager.on('heartbeatTimeout', ({ peerId }) => {
            this._registerPeerDisconnect(peerId, 'heartbeat-timeout');
        });

        this._peerManager.on('iceCandidate', ({ peerId, candidate }) => {
            this._sendSignaling(createSignalingEnvelope(SIGNALING_COMMAND_TYPES.ICE, { targetPeerId: peerId, candidate }));
        });

        this._peerManager.on('peerConnected', ({ peerId }) => {
            this._clearClientPeerDisconnect(peerId);
        });

        this._beforeUnloadHandler = () => { this._sendLeaveMessage(); };
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', this._beforeUnloadHandler);
        }
    }

    async connect(options = {}) {
        this._isDisconnecting = false;
        this._signalingUrl = resolveOnlineSignalingUrl(options.signalingUrl, this._signalingUrl);
        this._sessionToken = String(options.sessionToken || options.peerToken || this._sessionToken || '').trim();
        return this._runConnectLoop(() => this._connectSingleAttempt(options), options);
    }

    async reconnect(options = {}) {
        if (options.signalingUrl) {
            this._signalingUrl = resolveOnlineSignalingUrl(options.signalingUrl, this._signalingUrl);
        }
        return this._runConnectLoop(() => this._reconnectSingleAttempt(options), options);
    }

    async _runConnectLoop(singleAttemptFn, options = {}) {
        const retryDelays = resolveRetryDelays(options.connectRetryDelaysMs);
        const maxAttempts = Number.isFinite(Number(options.maxConnectAttempts))
            ? Math.min(3, Math.max(1, Math.floor(Number(options.maxConnectAttempts)))) : 3;
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                await singleAttemptFn();
                return;
            } catch (err) {
                lastError = err;
                this._teardownSignalingSocket();
                if (attempt >= maxAttempts || !isRetryableSignalingError(err)) break;
                const retryDelayMs = retryDelays[Math.min(attempt - 1, retryDelays.length - 1)] || 0;
                if (retryDelayMs > 0) {
                    logger.debug('Signaling connect attempt failed; retrying', { attempt, maxAttempts, retryDelayMs });
                    await delay(retryDelayMs);
                }
            }
        }

        throw lastError || createSocketLifecycleError('error', { signalingUrl: this._signalingUrl });
    }

    _socketAttempt(onOpenFn, options = {}) {
        const timeoutMs = resolveConnectTimeoutMs(options.connectTimeoutMs);
        return new Promise((resolve, reject) => {
            let settled = false;
            const settle = (fn, arg) => { if (settled) return; settled = true; fn(arg); };
            const timer = setTimeout(
                () => settle(reject, createSocketLifecycleError('timeout', { signalingUrl: this._signalingUrl })),
                timeoutMs
            );
            const done = () => { clearTimeout(timer); settle(resolve); };
            const fail = (err) => { clearTimeout(timer); settle(reject, err); };

            const socket = new WebSocket(this._signalingUrl);
            this._ws = socket;
            socket.onopen = onOpenFn;
            socket.onmessage = (event) => {
                if (this._ws !== socket) return;
                let msg;
                try {
                    msg = JSON.parse(event.data);
                } catch (error) {
                    const payloadError = createInvalidSignalingPayloadError({
                        signalingUrl: this._signalingUrl,
                        rawData: typeof event?.data === 'string' ? event.data.slice(0, 256) : String(event?.data || ''),
                    }, error);
                    this._emit('error', toErrorPayload(payloadError));
                    if (!settled) {
                        fail(payloadError);
                    }
                    return;
                }
                Promise.resolve(this._handleSignalingMessage(msg, done, fail)).catch((error) => {
                    const signalingError = error instanceof Error
                        ? error
                        : createServerSignalingError('unexpected_signaling_handler_failure');
                    this._emit('error', toErrorPayload(signalingError));
                    if (!settled) {
                        fail(signalingError);
                    }
                });
            };
            socket.onerror = () => {
                if (this._ws !== socket) return;
                const socketError = createSocketLifecycleError('error', { signalingUrl: this._signalingUrl });
                this._emit('error', toErrorPayload(socketError));
                if (!settled) {
                    fail(socketError);
                    return;
                }
                this._emit('signalingDisconnected', toErrorPayload(socketError));
            };
            socket.onclose = (event) => {
                if (this._ws !== socket) return;
                const closeError = createSocketLifecycleError('close', buildSocketCloseDetails(event, this._signalingUrl));
                if (!settled) {
                    fail(closeError);
                    return;
                }
                this.isConnected = false;
                this._emit('signalingDisconnected', toErrorPayload(closeError));
                this._emit('disconnected', {
                    reason: 'signaling_socket_closed',
                    error: toErrorPayload(closeError),
                });
            };
        });
    }

    async _connectSingleAttempt(options = {}, { resumed = false } = {}) {
        const attachPlayerId = String(options.playerId || '').trim();
        const attachLobbyCode = String(options.lobbyCode || '').trim();
        this._usesAttachedTransport = !!(attachPlayerId && attachLobbyCode);
        await this._socketAttempt(() => {
            if (attachPlayerId && attachLobbyCode) {
                // Match-runtime handoff: reuse the existing lobby membership from the
                // menu lobby instead of creating/joining a second lobby. Creating a
                // fresh lobby here would put host and clients into different lobbies
                // and the WebRTC handshake could never happen.
                this._sendSignaling(createSignalingEnvelope(SIGNALING_COMMAND_TYPES.ATTACH_TRANSPORT, {
                    lobbyCode: attachLobbyCode,
                    playerId: attachPlayerId,
                    sessionToken: this._sessionToken,
                }));
            } else if (this.isHost) {
                this._sendSignaling(createSignalingEnvelope(SIGNALING_COMMAND_TYPES.CREATE_LOBBY, { maxPlayers: options.maxPlayers || 10 }));
            } else {
                this._sendSignaling(createSignalingEnvelope(SIGNALING_COMMAND_TYPES.JOIN_LOBBY, { lobbyCode: options.lobbyCode }));
            }
        }, options);
        if (!this.isHost) {
            await this._waitForHostStateChannel(options);
            this._completeSignalingConnection({ resumed });
        }
    }

    async _reconnectSingleAttempt(options = {}) {
        if (this._usesAttachedTransport) {
            return this._connectSingleAttempt({
                ...options,
                playerId: this.localPlayerId,
                lobbyCode: this._lobbyCode,
            }, { resumed: true });
        }
        await this._socketAttempt(() => {
            this._sendSignaling(createSignalingEnvelope(
                SIGNALING_COMMAND_TYPES.RESUME_CONNECTION,
                {
                    lobbyCode: this._lobbyCode,
                    playerId: this.localPlayerId,
                    sessionToken: this._sessionToken,
                }
            ));
        }, options);
        if (!this.isHost) {
            await this._waitForHostStateChannel(options);
            this._completeSignalingConnection({ resumed: true });
        }
    }

    async _waitForHostStateChannel(options = {}) {
        const hostPeerId = this._findHostPeerId();
        if (!hostPeerId) {
            throw new Error('Online P2P connection failed: host peer is unknown');
        }
        await waitForStateChannelOpen({
            dataChannelManager: this._dataChannelManager,
            peerId: hostPeerId,
            timeoutMs: Number.isFinite(Number(options.dataChannelOpenTimeoutMs))
                ? Math.max(1, Math.floor(Number(options.dataChannelOpenTimeoutMs)))
                : CLIENT_CHANNEL_OPEN_TIMEOUT_MS,
            errorMessage: 'Online P2P connection failed: data channel did not open',
        });
    }

    _completeSignalingConnection({ resumed = false } = {}) {
        this.isConnected = true;
        this._latencyMonitor.start();
        this._emit(resumed ? 'connectionResumed' : 'connected', {
            playerId: this.localPlayerId,
            lobbyCode: this._lobbyCode,
        });
    }

    _teardownSignalingSocket() {
        if (!this._ws) return;
        const socket = this._ws;
        this._ws = null;
        try { socket.close(); } catch { /* Best-effort cleanup between retries. */ }
    }

    _handleSignalingMessage(msg, connectResolve, connectReject) {
        return routeOnlineSessionSignalingMessage(this, msg, { connectResolve, connectReject });
    }

    _findHostPeerId() {
        return this._hostPeerId || null;
    }

    _resolveHostPeerId() {
        // Online host is identified by the peer ID stored during signaling.
        return this._findHostPeerId();
    }

    _sendStateToAll(message, excludePeerId = null) {
        if (!message) return;
        this._dataChannelManager.sendToAll('state', message, excludePeerId);
    }

    _sendStateToPeer(peerId, message) {
        if (!peerId || !message) return;
        this._dataChannelManager.send(peerId, 'state', message);
    }

    _closePeerConnection(peerId) {
        this._peerManager.closePeer(peerId);
    }

    _removePeerLatency(peerId) {
        this._latencyMonitor.removePeer(peerId);
    }

    _handleClientPeerDisconnect(peerId, reason) {
        const hostPeerId = this._findHostPeerId();
        if (peerId === hostPeerId) {
            return this._attemptClientReconnect(peerId, reason);
        }
        this._closePeerConnection(peerId);
        this._removePeerLatency(peerId);
        this._emit('playerDisconnected', { peerId, reason, isHost: false });
        return true;
    }

    _sendLeaveMessage() {
        if (!this.isConnected) return;
        if (this.isHost) {
            this._sendStateToAll(this._createStateMessage(MULTIPLAYER_MESSAGE_TYPES.HOST_LEAVING));
        } else {
            const hostPeerId = this._findHostPeerId();
            if (hostPeerId) {
                this._sendStateToPeer(
                    hostPeerId,
                    this._createStateMessage(MULTIPLAYER_MESSAGE_TYPES.LEAVE, { playerId: this.localPlayerId })
                );
            }
        }
        this._sendSignaling(createSignalingEnvelope(SIGNALING_COMMAND_TYPES.LEAVE));
    }

    _sendSignaling(msg) {
        if (!msg) return;
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            this._ws.send(JSON.stringify(msg));
        }
    }

    sendInput(inputData) {
        const payload = {
            ...this._createStateMessage(MULTIPLAYER_MESSAGE_TYPES.INPUT),
            playerId: this.localPlayerId || (this.isHost ? 'host' : ''),
            inputs: inputData,
            timestamp: this._now(),
        };
        if (this.isHost) {
            this._sendStateToAll(payload);
            return;
        }
        const hostPeerId = this._findHostPeerId();
        if (hostPeerId) {
            this._dataChannelManager.send(hostPeerId, 'inputs', payload);
        }
    }

    broadcastState(stateSnapshot) {
        if (!this.isHost) return;
        this._sendStateToAll(this._createStateMessage(MULTIPLAYER_MESSAGE_TYPES.STATE_SNAPSHOT, stateSnapshot));
    }

    sendStateToPeer(peerId, stateSnapshot) {
        this._sendFullStateSync(peerId, stateSnapshot);
    }

    _handleDataMessage(peerId, channel, data) {
        this._peerManager.recordPeerActivity?.(peerId);
        const message = normalizeMultiplayerSessionMessage(data);
        const senderIsHost = String(peerId || '').trim() === String(this._hostPeerId || '').trim();
        if (!isMultiplayerMessageAllowedForSender(message.type, senderIsHost)) return;
        switch (message.type) {
        case MULTIPLAYER_MESSAGE_TYPES.INPUT:
            this._emit('remoteInput', { peerId, input: data.inputs, playerId: peerId });
            break;
        case MULTIPLAYER_MESSAGE_TYPES.PLAYER_ARENA_LOADED:
            // Client signals that its arena is fully loaded.  Host collects these
            // and fires broadcastRoundStartGate() once all players have reported in.
            this._emit('playerLoaded', { playerId: String(peerId || '').trim() });
            break;
        case MULTIPLAYER_MESSAGE_TYPES.ROUND_START_GATE:
            // Host signals all clients that every player is loaded and the round may start.
            this._emit('roundStartGate', {
                expectedPeerIds: Array.isArray(data.expectedPeerIds) ? data.expectedPeerIds : [],
                timestamp: typeof data.timestamp === 'number' ? data.timestamp : 0,
            });
            break;
        case MULTIPLAYER_MESSAGE_TYPES.STATE_SNAPSHOT:
            this._emit('stateUpdate', buildMultiplayerStateUpdateEvent(data, {
                messageType: MULTIPLAYER_MESSAGE_TYPES.STATE_SNAPSHOT,
            }));
            break;
        case MULTIPLAYER_MESSAGE_TYPES.FULL_STATE_SYNC:
            this._emit('fullStateSync', { state: data });
            break;
        case MULTIPLAYER_MESSAGE_TYPES.PING:
            this._dataChannelManager.send(
                peerId,
                channel,
                this._createStateMessage(MULTIPLAYER_MESSAGE_TYPES.PONG, { pingId: data.pingId })
            );
            break;
        case MULTIPLAYER_MESSAGE_TYPES.PONG:
            this._latencyMonitor.recordPongReceived(peerId, data.pingId);
            break;
        case MULTIPLAYER_MESSAGE_TYPES.HEARTBEAT:
            this._sendStateToPeer(peerId, this._createStateMessage(MULTIPLAYER_MESSAGE_TYPES.HEARTBEAT_ACK));
            break;
        case MULTIPLAYER_MESSAGE_TYPES.HEARTBEAT_ACK:
            this._peerManager.recordHeartbeatAck(peerId);
            break;
        case MULTIPLAYER_MESSAGE_TYPES.LEAVE:
            this._closePeerConnection(peerId);
            this._removePeerLatency(peerId);
            this._emit('playerDisconnected', { peerId, reason: 'graceful-leave' });
            break;
        case MULTIPLAYER_MESSAGE_TYPES.HOST_LEAVING:
            this._clientDisconnectedPeers.add(String(peerId || this._hostPeerId || '').trim());
            this._closePeerConnection(peerId || 'host');
            this._removePeerLatency(peerId || 'host');
            this._emit('hostDisconnected', { reason: 'graceful-leave' });
            this._emit('playerDisconnected', { peerId, reason: 'host-leaving', isHost: true });
            break;
        case MULTIPLAYER_MESSAGE_TYPES.PLAYER_DISCONNECTED:
            this._emit('playerDisconnected', {
                peerId: data.peerId,
                reason: data.reason,
                canReconnect: true,
                reconnectWindowMs: data.reconnectWindowMs,
            });
            break;
        case MULTIPLAYER_MESSAGE_TYPES.PLAYER_RECONNECTED:
            this._emit('playerReconnected', { peerId: data.peerId });
            break;
        case MULTIPLAYER_MESSAGE_TYPES.PLAYER_REMOVED:
            this._emit('playerRemoved', { peerId: data.peerId });
            break;
        case MULTIPLAYER_MESSAGE_TYPES.MATCH_LIFECYCLE_SIGNAL:
            this._emit('matchLifecycleSignal', {
                signal: String(data.signal || '').trim(),
                reason: String(data.reason || '').trim(),
            });
            break;
        default:
            break;
        }
    }

    get lobbyCode() {
        return this._lobbyCode;
    }

    getPlayers() {
        const players = [];
        const localPlayerId = String(this.localPlayerId || '').trim();
        if (localPlayerId) {
            players.push({
                id: localPlayerId,
                peerId: localPlayerId,
                name: this.isHost ? 'Host' : localPlayerId,
                isHost: this.isHost,
                ready: this.isConnected,
                connected: this.isConnected,
            });
        }

        const peerIds = this._peerManager?.getAllPeerIds?.() || [];
        for (const peerId of peerIds) {
            const normalizedPeerId = String(peerId || '').trim();
            if (!normalizedPeerId || normalizedPeerId === localPlayerId) continue;
            players.push({
                id: normalizedPeerId,
                peerId: normalizedPeerId,
                name: normalizedPeerId,
                isHost: normalizedPeerId === this._hostPeerId,
                ready: true,
                connected: true,
            });
        }

        return players;
    }

    disconnect() {
        this._isDisconnecting = true;
        this._sendLeaveMessage();
        this._clearReconnectPeers();
        this._latencyMonitor.stop();
        this._peerManager.dispose();
        this._dataChannelManager.dispose();
        if (this._ws) {
            this._ws.close();
            this._ws = null;
        }
        this.isConnected = false;
        this._sessionToken = '';

        if (typeof window !== 'undefined') {
            window.removeEventListener('beforeunload', this._beforeUnloadHandler);
        }

        this._emit('disconnected', { reason: 'manual' });
    }

    dispose() {
        this.disconnect();
        super.dispose();
    }
}

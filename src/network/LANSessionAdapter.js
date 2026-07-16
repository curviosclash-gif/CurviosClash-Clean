// ============================================
// LANSessionAdapter.js - LAN session via embedded signaling
// ============================================

import { createLogger } from '../shared/logging/Logger.js';
import { SessionAdapterBase } from './SessionAdapterBase.js';

const logger = createLogger('LANSessionAdapter');
import { PeerConnectionManager } from './PeerConnectionManager.js';
import { DataChannelManager } from './DataChannelManager.js';
import { LatencyMonitor } from './LatencyMonitor.js';
import {
    buildMultiplayerStateUpdateEvent,
    MULTIPLAYER_MESSAGE_TYPES,
    normalizeMultiplayerSessionMessage,
} from '../shared/contracts/MultiplayerSessionContract.js';
import {
    delay,
    pollIceCandidates,
    sendIceCandidate,
    waitForHostOffer,
    waitForStateChannelOpen,
} from './LANSignalingClient.js';

const HOST_STATUS_POLL_INTERVAL_MS = 1000;
const HOST_STATUS_POLL_TIMEOUT_MS = 2500;
const CLIENT_CHANNEL_OPEN_TIMEOUT_MS = 10_000;

/**
 * SessionAdapter for LAN play.
 * Host runs an embedded HTTP signaling server (in Electron/Tauri main process).
 * Clients connect via fetch() to the host's IP:port.
 * After signaling, communication is P2P via WebRTC data channels.
 */
export class LANSessionAdapter extends SessionAdapterBase {
    constructor(options = {}) {
        super({
            isHost: !!options.isHost,
            reconnectWindowMs: options.reconnectWindowMs,
            now: options.now,
        });
        this.localPlayerId = String(options.playerId || '').trim() || this.localPlayerId;
        this._signalingUrl = options.signalingUrl || null;
        // hostToken (host) or playerToken (client) for the LAN signaling routes.
        this._peerToken = String(options.peerToken || '').trim();
        this._dataChannelManager = new DataChannelManager();
        this._peerManager = new PeerConnectionManager({
            isHost: this.isHost,
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
        this._pollingTimer = null;
        this._pollAbortController = null;
        this._pollInFlight = false;
        this._pollStopped = false;

        this._dataChannelManager.on('message', ({ peerId, channel, data }) => {
            this._handleMessage(peerId, channel, data);
        });

        this._dataChannelManager.on('channelClose', ({ peerId }) => {
            this._registerPeerDisconnect(peerId, 'channel-close');
        });

        this._peerManager.on('peerDisconnected', ({ peerId, state }) => {
            this._registerPeerDisconnect(peerId, state);
        });

        this._peerManager.on('heartbeatTimeout', ({ peerId }) => {
            this._registerPeerDisconnect(peerId, 'heartbeat-timeout');
        });

        this._peerManager.on('iceCandidate', ({ peerId, candidate }) => {
            this._sendIceCandidate(peerId, candidate);
        });

        this._peerManager.on('peerConnected', ({ peerId }) => {
            this._clearClientPeerDisconnect(peerId);
        });

        this._beforeUnloadHandler = () => {
            this._sendLeaveMessage();
        };
        if (typeof window !== 'undefined') {
            window.addEventListener('beforeunload', this._beforeUnloadHandler);
        }
    }

    async connect(options = {}) {
        this._signalingUrl = options.signalingUrl || this._signalingUrl;
        if (options.peerToken) {
            this._peerToken = String(options.peerToken || '').trim();
        }

        if (this.isHost) {
            this.localPlayerId = 'host';
            this.isConnected = true;
            this._emit('connected', { playerId: this.localPlayerId });
            this._latencyMonitor.start();
            this._startPolling();
            return;
        }

        const existingPlayerId = String(options.playerId || this.localPlayerId || '').trim();
        if (existingPlayerId) {
            await this._attachExistingClient(existingPlayerId);
            return;
        }
        await this._joinAsClient(options.lobbyCode);
    }

    /**
     * Client-only. Re-registers this player (same playerId + token) as pending on
     * the signaling server and re-runs the WebRTC handshake. Works within the
     * server-side reconnect lease window after a drop or ghost cleanup.
     */
    async reconnect(options = {}) {
        if (this.isHost) return;
        this._signalingUrl = options.signalingUrl || this._signalingUrl;
        const playerId = String(options.playerId || this.localPlayerId || '').trim();
        if (!playerId) {
            throw new Error('LAN reconnect failed: playerId missing');
        }
        const rejoinRes = await fetch(`${this._signalingUrl}/lobby/rejoin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerId, playerToken: this._peerToken }),
        });
        if (rejoinRes?.ok === false) {
            throw new Error(`LAN reconnect rejected (${rejoinRes.status || 'unknown'})`);
        }
        await this._attachExistingClient(playerId);
    }

    async _joinAsClient(lobbyCode) {
        try {
            const joinRes = await fetch(`${this._signalingUrl}/lobby/join`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lobbyCode }),
            });
            if (joinRes?.ok === false) {
                throw new Error(`Lobby join failed (${joinRes.status || 'unknown'})`);
            }
            const joinData = await joinRes.json();
            this._peerToken = String(joinData.playerToken || '').trim() || this._peerToken;
            await this._attachExistingClient(joinData.playerId);
        } catch (err) {
            logger.error('Join as client failed:', err);
            throw err;
        }
    }

    async _attachExistingClient(playerId) {
        this.localPlayerId = String(playerId || '').trim();
        if (!this.localPlayerId) {
            throw new Error('Client attach failed: playerId missing');
        }

        const offer = await waitForHostOffer({
            signalingUrl: this._signalingUrl,
            playerId: this.localPlayerId,
            token: this._peerToken,
            now: this._now,
        });
        const channelOpenPromise = waitForStateChannelOpen({
            dataChannelManager: this._dataChannelManager,
            peerId: 'host',
            timeoutMs: CLIENT_CHANNEL_OPEN_TIMEOUT_MS,
        });
        const answer = await this._peerManager.handleOffer('host', offer);

        const answerRes = await fetch(`${this._signalingUrl}/signaling/answer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerId: this.localPlayerId,
                playerToken: this._peerToken,
                answer,
            }),
        }).catch((err) => {
            throw new Error(`Answer send failed: ${err?.message || err}`);
        });
        if (answerRes?.ok === false) {
            throw new Error(`Answer send failed (${answerRes.status || 'unknown'})`);
        }

        await this._pollIceCandidates('host', {
            playerId: this.localPlayerId,
            fromPeerId: 'host',
        });

        // Signaling done is not connected: only report success once the reliable
        // state channel is actually open, so P2P failures surface as errors
        // instead of a silently hanging session.
        await channelOpenPromise;

        this.isConnected = true;
        this._latencyMonitor.start();
        this._latencyMonitor.addPeer('host');
        this._emit('connected', { playerId: this.localPlayerId });
    }

    async _sendIceCandidate(peerId, candidate) {
        await sendIceCandidate({
            signalingUrl: this._signalingUrl,
            sourcePlayerId: String(this.localPlayerId || (this.isHost ? 'host' : '') || '').trim(),
            token: this._peerToken,
            targetPlayerId: String(peerId || '').trim() || 'host',
            candidate,
        });
    }

    async _pollIceCandidates(peerId, options = {}) {
        const playerId = String(options.playerId || this.localPlayerId || '').trim();
        if (!playerId) return;
        await pollIceCandidates({
            signalingUrl: this._signalingUrl,
            playerId,
            token: this._peerToken,
            fromPeerId: String(options.fromPeerId || '').trim(),
            addCandidate: (candidate) => this._peerManager.addIceCandidate(peerId, candidate),
            ...(Number.isFinite(Number(options.maxRetries))
                ? { maxRetries: Math.max(1, Math.floor(Number(options.maxRetries))) } : {}),
            ...(Number.isFinite(Number(options.quietWindowPolls))
                ? { quietWindowPolls: Math.max(1, Math.floor(Number(options.quietWindowPolls))) } : {}),
            ...(Number.isFinite(Number(options.pollDelayMs))
                ? { pollDelayMs: Math.max(0, Math.floor(Number(options.pollDelayMs))) } : {}),
        });
    }

    _startPolling() {
        if (!this.isHost || !this._signalingUrl) return;
        this._stopStatusPolling();
        this._connectingPeers = new Set();
        this._pollStopped = false;
        const pollLoop = async () => {
            if (this._pollStopped) return;
            if (!this._pollInFlight) {
                this._pollInFlight = true;
                try {
                    if (this._pollAbortController) {
                        this._pollAbortController.abort();
                    }
                    this._pollAbortController = new AbortController();
                    const timeoutId = setTimeout(() => {
                        this._pollAbortController?.abort();
                    }, HOST_STATUS_POLL_TIMEOUT_MS);
                    try {
                        const statusParams = new URLSearchParams({
                            playerId: 'host',
                            token: this._peerToken,
                        });
                        const res = await fetch(`${this._signalingUrl}/lobby/status?${statusParams}`, {
                            signal: this._pollAbortController.signal,
                        });
                        if (res?.ok === false) {
                            throw new Error(`Lobby status failed (${res.status || 'unknown'})`);
                        }
                        const data = await res.json();
                        if (Array.isArray(data.pendingPlayers)) {
                            for (const pending of data.pendingPlayers) {
                                const peerId = String(pending?.playerId || '').trim();
                                if (!peerId || this._connectingPeers.has(peerId)) continue;
                                this._connectingPeers.add(peerId);
                                this._connectToPendingClient(pending).finally(() => {
                                    this._connectingPeers.delete(peerId);
                                });
                            }
                        }
                    } finally {
                        clearTimeout(timeoutId);
                    }
                } catch (err) {
                    logger.debug('Polling lobby status failed:', err);
                } finally {
                    this._pollAbortController = null;
                    this._pollInFlight = false;
                }
            }
            this._pollingTimer = setTimeout(pollLoop, HOST_STATUS_POLL_INTERVAL_MS);
        };
        this._pollingTimer = setTimeout(pollLoop, HOST_STATUS_POLL_INTERVAL_MS);
    }

    _stopStatusPolling() {
        this._pollStopped = true;
        if (this._pollingTimer) {
            clearTimeout(this._pollingTimer);
            this._pollingTimer = null;
        }
        if (this._pollAbortController) {
            this._pollAbortController.abort();
            this._pollAbortController = null;
        }
    }

    async _connectToPendingClient(pending) {
        const targetPeerId = String(pending?.playerId || '').trim();
        if (!targetPeerId) return;
        try {
            const offer = await this._peerManager.createOffer(targetPeerId);

            await fetch(`${this._signalingUrl}/signaling/offer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetPlayerId: targetPeerId, offer, hostToken: this._peerToken }),
            }).catch((err) => { logger.warn('Offer send to pending client failed:', err); });

            for (let i = 0; i < 30; i += 1) {
                // Poll for ICE candidates from client while waiting for answer
                try {
                    const iceParams = new URLSearchParams({
                        playerId: 'host',
                        token: this._peerToken,
                        fromPlayerId: targetPeerId,
                    });
                    const iceRes = await fetch(`${this._signalingUrl}/signaling/ice?${iceParams.toString()}`);
                    const iceData = await iceRes.json();
                    if (Array.isArray(iceData.candidates)) {
                        for (const candidate of iceData.candidates) {
                            await this._peerManager.addIceCandidate(targetPeerId, candidate);
                        }
                    }
                } catch (err) {
                    logger.debug('ICE poll for pending client failed:', err);
                }

                try {
                    const answerParams = new URLSearchParams({
                        playerId: targetPeerId,
                        token: this._peerToken,
                    });
                    const res = await fetch(`${this._signalingUrl}/signaling/answer?${answerParams.toString()}`);
                    const data = await res.json();
                    if (!data.answer) {
                        await delay(200);
                        continue;
                    }
                    await this._peerManager.handleAnswer(targetPeerId, data.answer);
                    this._latencyMonitor.addPeer(targetPeerId);

                    // Keep this connection attempt in-flight until the server has
                    // removed the pending entry. Otherwise the next status poll can
                    // create a second offer and close the fresh peer connection.
                    await fetch(`${this._signalingUrl}/lobby/ack-pending`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ playerId: targetPeerId, hostToken: this._peerToken }),
                    }).catch((err) => { logger.debug('Ack-pending failed:', err); });

                    // Late trickle candidates (client hit its gathering timeout and
                    // posts candidates after the answer): keep polling briefly in
                    // the background; buffered flushing makes this race-free.
                    this._pollIceCandidates(targetPeerId, {
                        playerId: 'host',
                        fromPeerId: targetPeerId,
                        maxRetries: 10,
                    }).catch(() => { /* best-effort */ });

                    if (this._disconnectedPeers.has(targetPeerId)) {
                        this._resolvePeerReconnect(targetPeerId);
                    } else {
                        this._emit('playerConnected', { peerId: targetPeerId });
                    }
                    return;
                } catch (err) {
                    logger.debug('Answer poll for pending client failed:', err);
                    await delay(200);
                }
            }
        } catch (err) {
            logger.error('Connect to pending client failed:', err);
        }
    }

    _resolveHostPeerId() {
        // LAN host is always reachable under the fixed peer ID 'host'.
        return 'host';
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
        if (peerId !== 'host') return false;
        this._emit('hostDisconnected', { reason });
        this._emit('playerDisconnected', { peerId, reason, isHost: true });
        return true;
    }

    _sendLeaveMessage() {
        if (!this.isConnected) return;
        if (this.isHost) {
            this._sendStateToAll(this._createStateMessage(MULTIPLAYER_MESSAGE_TYPES.HOST_LEAVING));
            return;
        }
        this._sendStateToPeer('host', this._createStateMessage(MULTIPLAYER_MESSAGE_TYPES.LEAVE, {
            playerId: this.localPlayerId,
        }));
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
        this._dataChannelManager.send('host', 'inputs', payload);
    }

    broadcastState(stateSnapshot) {
        if (!this.isHost) return;
        this._sendStateToAll(this._createStateMessage(MULTIPLAYER_MESSAGE_TYPES.STATE_SNAPSHOT, stateSnapshot));
    }

    sendStateToPeer(peerId, stateSnapshot) {
        this._sendFullStateSync(peerId, stateSnapshot);
    }

    _handleMessage(peerId, channel, data) {
        this._peerManager.recordPeerActivity?.(peerId);
        const message = normalizeMultiplayerSessionMessage(data);
        switch (message.type) {
        case MULTIPLAYER_MESSAGE_TYPES.INPUT:
            this._emit('remoteInput', { peerId, input: data.inputs, playerId: data.playerId });
            break;
        case MULTIPLAYER_MESSAGE_TYPES.PLAYER_ARENA_LOADED:
            // Client signals that its arena is fully loaded.  Host collects these
            // and fires broadcastRoundStartGate() once all players have reported in.
            this._emit('playerLoaded', { playerId: String(data.playerId || peerId || '').trim() });
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
                channel === 'inputs' ? 'inputs' : 'state',
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
            this._closePeerConnection(data.playerId || peerId);
            this._removePeerLatency(data.playerId || peerId);
            this._emit('playerDisconnected', { peerId: data.playerId || peerId, reason: 'graceful-leave' });
            break;
        case MULTIPLAYER_MESSAGE_TYPES.HOST_LEAVING:
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

    getPlayers() {
        const players = [];
        const localPlayerId = String(this.localPlayerId || '').trim();
        if (localPlayerId) {
            players.push({
                id: localPlayerId,
                peerId: localPlayerId,
                name: localPlayerId === 'host' ? 'Host' : localPlayerId,
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
                name: normalizedPeerId === 'host' ? 'Host' : normalizedPeerId,
                isHost: normalizedPeerId === 'host',
                ready: true,
                connected: true,
            });
        }

        return players;
    }

    disconnect() {
        this._sendLeaveMessage();

        this._stopStatusPolling();

        this._clearReconnectPeers();
        this._latencyMonitor.stop();
        this._peerManager.dispose();
        this._dataChannelManager.dispose();
        this.isConnected = false;

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

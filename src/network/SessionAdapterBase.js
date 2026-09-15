import { SessionAdapter } from '../core/session/SessionAdapter.js';
import {
    MULTIPLAYER_MESSAGE_TYPES,
    buildMultiplayerSessionMessage,
} from '../shared/contracts/MultiplayerSessionContract.js';
import { createRuntimeClock } from '../shared/contracts/RuntimeClockContract.js';

function normalizePeerId(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized;
}

function toTimestamp(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

export class SessionAdapterBase extends SessionAdapter {
    constructor(options = {}) {
        super();
        this.isHost = !!options.isHost;
        this._clock = createRuntimeClock({
            nowMs: options.now,
            runtime: options.clockRuntime,
        });
        this._now = this._clock.nowMs;
        this._reconnectWindowMs = Number.isFinite(Number(options.reconnectWindowMs))
            ? Math.max(0, Math.floor(Number(options.reconnectWindowMs)))
            : 30_000;
        this._disconnectedPeers = new Map();
        // Client-side dedup: channel-close fires once per data channel (inputs +
        // state), which previously emitted hostDisconnected twice.
        this._clientDisconnectedPeers = new Set();
        this._clientReconnectGeneration = 0;
        this._peerActivityRecoveryBound = false;
        this._isDisconnecting = false;
        this._nextInputSequence = 1;
        this._nextSnapshotSequence = 1;
        this._lastInputSequenceByPeer = new Map();
        this._lastSnapshotSequence = 0;
    }

    _createStateMessage(type, payload = null) {
        return buildMultiplayerSessionMessage(type, payload);
    }

    _createInputSequence() {
        return this._nextInputSequence++;
    }

    _createSnapshotSequence() {
        return this._nextSnapshotSequence++;
    }

    _acceptInputSequence(peerId, value) {
        const sequence = Number(value);
        if (!Number.isSafeInteger(sequence) || sequence < 1) return true;
        const normalizedPeerId = normalizePeerId(peerId);
        if (!normalizedPeerId) return false;
        const previous = this._lastInputSequenceByPeer.get(normalizedPeerId) || 0;
        if (sequence <= previous) return false;
        this._lastInputSequenceByPeer.set(normalizedPeerId, sequence);
        return true;
    }

    _acceptSnapshotSequence(value) {
        const sequence = Number(value);
        if (!Number.isSafeInteger(sequence) || sequence < 1) return true;
        if (sequence <= this._lastSnapshotSequence) return false;
        this._lastSnapshotSequence = sequence;
        return true;
    }

    _sendStateToAll(_message, _excludePeerId = null) {
        throw new Error('SessionAdapterBase._sendStateToAll() not implemented');
    }

    _sendStateToPeer(_peerId, _message) {
        throw new Error('SessionAdapterBase._sendStateToPeer() not implemented');
    }

    _closePeerConnection(_peerId) {
        throw new Error('SessionAdapterBase._closePeerConnection() not implemented');
    }

    _removePeerLatency(_peerId) {
        throw new Error('SessionAdapterBase._removePeerLatency() not implemented');
    }

    _handleClientPeerDisconnect(_peerId, _reason) {
        return false;
    }

    /**
     * Subscribes to the peer manager's activity signal the first time a
     * disconnect is registered. Concrete adapters create `_peerManager` after
     * super(), so the binding cannot happen in the constructor.
     */
    _bindPeerActivityRecovery() {
        if (this._peerActivityRecoveryBound) return;
        const peerManager = this._peerManager;
        if (!peerManager || typeof peerManager.on !== 'function') return;
        this._peerActivityRecoveryBound = true;
        peerManager.on('peerActivityResumed', ({ peerId }) => {
            this._resolvePeerReconnectOnActivity(peerId);
        });
    }

    _registerPeerDisconnect(peerId, reason) {
        if (this._isDisconnecting) return;
        this._bindPeerActivityRecovery();
        const normalizedPeerId = normalizePeerId(peerId);
        if (!normalizedPeerId) return;
        if (this._disconnectedPeers.has(normalizedPeerId)) return;

        if (this.isHost) {
            const timer = setTimeout(() => {
                this._finalizePeerRemoval(normalizedPeerId);
            }, this._reconnectWindowMs);

            const disconnectedAt = toTimestamp(this._now(), 0);
            this._disconnectedPeers.set(normalizedPeerId, {
                reason: String(reason || 'unknown'),
                disconnectedAt,
                timer,
            });

            this._sendStateToAll(
                this._createStateMessage(MULTIPLAYER_MESSAGE_TYPES.PLAYER_DISCONNECTED, {
                    peerId: normalizedPeerId,
                    reason: String(reason || 'unknown'),
                    reconnectWindowMs: this._reconnectWindowMs,
                }),
                normalizedPeerId
            );
            this._emit('playerDisconnected', {
                peerId: normalizedPeerId,
                reason: String(reason || 'unknown'),
                canReconnect: true,
            });
            return;
        }

        if (this._clientDisconnectedPeers.has(normalizedPeerId)) return;
        this._clientDisconnectedPeers.add(normalizedPeerId);
        const handled = this._handleClientPeerDisconnect(normalizedPeerId, reason);
        if (!handled) {
            this._emit('playerDisconnected', {
                peerId: normalizedPeerId,
                reason: String(reason || 'unknown'),
            });
        }
    }

    /**
     * Clears the client-side disconnect dedup marker for a peer, so a later
     * (re-)connection can report a fresh disconnect again.
     */
    _clearClientPeerDisconnect(peerId) {
        const normalizedPeerId = normalizePeerId(peerId);
        if (!normalizedPeerId) return;
        this._clientDisconnectedPeers.delete(normalizedPeerId);
    }

    _attemptClientReconnect(peerId, reason) {
        const normalizedPeerId = normalizePeerId(peerId);
        if (!normalizedPeerId || typeof this.reconnect !== 'function') return false;

        const generation = this._clientReconnectGeneration;
        this.isConnected = false;
        this._closePeerConnection(normalizedPeerId);
        this._removePeerLatency(normalizedPeerId);

        Promise.resolve()
            .then(() => this.reconnect())
            .then(() => {
                if (this._isDisconnecting || generation !== this._clientReconnectGeneration) return;
                this._clearClientPeerDisconnect(normalizedPeerId);
            })
            .catch((error) => {
                if (this._isDisconnecting || generation !== this._clientReconnectGeneration) return;
                this._emit('hostDisconnected', { reason, error });
                this._emit('playerDisconnected', {
                    peerId: normalizedPeerId,
                    reason,
                    isHost: true,
                    error,
                });
            });
        return true;
    }

    _finalizePeerRemoval(peerId) {
        const normalizedPeerId = normalizePeerId(peerId);
        if (!normalizedPeerId) return;
        const entry = this._disconnectedPeers.get(normalizedPeerId);
        if (entry?.timer) {
            clearTimeout(entry.timer);
        }
        this._disconnectedPeers.delete(normalizedPeerId);
        this._closePeerConnection(normalizedPeerId);
        this._removePeerLatency(normalizedPeerId);
        this._sendStateToAll(this._createStateMessage(MULTIPLAYER_MESSAGE_TYPES.PLAYER_REMOVED, {
            peerId: normalizedPeerId,
        }));
        this._emit('playerRemoved', { peerId: normalizedPeerId });
    }

    _resolvePeerReconnect(peerId) {
        const normalizedPeerId = normalizePeerId(peerId);
        if (!normalizedPeerId) return;
        const entry = this._disconnectedPeers.get(normalizedPeerId);
        if (entry?.timer) {
            clearTimeout(entry.timer);
        }
        this._disconnectedPeers.delete(normalizedPeerId);
        this._sendStateToAll(this._createStateMessage(MULTIPLAYER_MESSAGE_TYPES.PLAYER_RECONNECTED, {
            peerId: normalizedPeerId,
        }));
        this._emit('playerReconnected', { peerId: normalizedPeerId });
        this._emit('fullStateSyncNeeded', { peerId: normalizedPeerId });
    }

    _resolvePeerReconnectOnChannelOpen(peerId, channel) {
        if (channel !== 'state') return;
        this._resolvePeerReconnectOnActivity(peerId);
    }

    /**
     * Any sign of life from a peer that is waiting out its reconnect window:
     * a reopened state channel, a heartbeat ack, inputs or snapshots. The peer
     * is back, so the pending removal must not fire.
     */
    _resolvePeerReconnectOnActivity(peerId) {
        if (!this.isHost) return;
        const normalizedPeerId = normalizePeerId(peerId);
        if (!normalizedPeerId) return;
        if (!this._disconnectedPeers.has(normalizedPeerId)) return;
        this._resolvePeerReconnect(normalizedPeerId);
    }

    /**
     * Override in concrete adapters to return the host's peer ID as known by this adapter.
     * Returns null in the base class (no-op fallback).
     * @returns {string|null}
     */
    _resolveHostPeerId() {
        return null;
    }

    /**
     * Client-only. Sends a PLAYER_ARENA_LOADED message to the host to signal that
     * this peer's arena is fully initialised and ready for the round-start gate.
     * The host collects these signals and replies with broadcastRoundStartGate()
     * once all expected peers have reported in.
     *
     * @param {string} playerId - local player/peer ID to include in the message
     */
    notifyArenaLoaded(playerId) {
        if (this.isHost) return;
        const hostPeerId = this._resolveHostPeerId();
        if (!hostPeerId) return;
        this._sendStateToPeer(
            hostPeerId,
            this._createStateMessage(MULTIPLAYER_MESSAGE_TYPES.PLAYER_ARENA_LOADED, { playerId })
        );
    }

    /**
     * Host-only. Broadcasts ROUND_START_GATE to all connected peers, signalling
     * that all players are loaded and the round may begin.  Clients react by
     * resolving their waitForRuntimePlayersLoaded() promise.
     *
     * @param {object|null} payload - Optional extra fields (e.g. expectedPeerIds, timestamp)
     */
    broadcastRoundStartGate(payload = null) {
        if (!this.isHost) return;
        const extra = payload && typeof payload === 'object' ? payload : {};
        this._sendStateToAll(this._createStateMessage(
            MULTIPLAYER_MESSAGE_TYPES.ROUND_START_GATE, extra
        ));
    }

    /**
     * Host-only. Broadcasts a lifecycle signal to all connected peers.
     * Clients react via their MultiplayerMatchLifecycleKernel handler.
     *
     * @param {string} signal - One of MULTIPLAYER_LIFECYCLE_SIGNAL_TYPES
     * @param {object|null} payload - Optional extra fields merged into the message
     */
    broadcastLifecycleSignal(signal, payload = null) {
        if (!this.isHost) return;
        const extra = payload && typeof payload === 'object' ? payload : {};
        this._sendStateToAll(this._createStateMessage(
            MULTIPLAYER_MESSAGE_TYPES.MATCH_LIFECYCLE_SIGNAL,
            { signal, ...extra }
        ));
    }

    _sendFullStateSync(peerId, stateSnapshot) {
        const normalizedPeerId = normalizePeerId(peerId);
        if (!normalizedPeerId) return;
        this._sendStateToPeer(normalizedPeerId, this._createStateMessage(
            MULTIPLAYER_MESSAGE_TYPES.FULL_STATE_SYNC,
            stateSnapshot
        ));
    }

    getReconnectInfo(peerId) {
        const normalizedPeerId = normalizePeerId(peerId);
        if (!normalizedPeerId) return null;
        const info = this._disconnectedPeers.get(normalizedPeerId);
        if (!info) return null;
        const now = toTimestamp(this._now(), 0);
        const elapsed = now - info.disconnectedAt;
        return {
            remainingMs: Math.max(0, this._reconnectWindowMs - elapsed),
            reason: info.reason,
        };
    }

    getDisconnectedPeers() {
        const now = toTimestamp(this._now(), 0);
        const result = [];
        for (const [peerId, info] of this._disconnectedPeers.entries()) {
            const elapsed = now - info.disconnectedAt;
            result.push({
                peerId,
                remainingMs: Math.max(0, this._reconnectWindowMs - elapsed),
                reason: info.reason,
            });
        }
        return result;
    }

    _clearReconnectPeers() {
        this._clientReconnectGeneration += 1;
        for (const entry of this._disconnectedPeers.values()) {
            if (entry?.timer) {
                clearTimeout(entry.timer);
            }
        }
        this._disconnectedPeers.clear();
        this._clientDisconnectedPeers.clear();
        this._lastInputSequenceByPeer.clear();
        this._lastSnapshotSequence = 0;
    }
}

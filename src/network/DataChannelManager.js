// ============================================
// DataChannelManager.js - WebRTC data channel setup and routing
// ============================================

import { MULTIPLAYER_MESSAGE_TYPES } from '../shared/contracts/MultiplayerSessionContract.js';

const PRIORITY_STATE_MESSAGE_TYPES = new Set([
    MULTIPLAYER_MESSAGE_TYPES.JOIN,
    MULTIPLAYER_MESSAGE_TYPES.READY,
    MULTIPLAYER_MESSAGE_TYPES.LEAVE,
    MULTIPLAYER_MESSAGE_TYPES.RECONNECT,
    MULTIPLAYER_MESSAGE_TYPES.FULL_STATE_SYNC,
    MULTIPLAYER_MESSAGE_TYPES.PING,
    MULTIPLAYER_MESSAGE_TYPES.PONG,
    MULTIPLAYER_MESSAGE_TYPES.HEARTBEAT,
    MULTIPLAYER_MESSAGE_TYPES.HEARTBEAT_ACK,
    MULTIPLAYER_MESSAGE_TYPES.HOST_LEAVING,
    MULTIPLAYER_MESSAGE_TYPES.PLAYER_DISCONNECTED,
    MULTIPLAYER_MESSAGE_TYPES.PLAYER_RECONNECTED,
    MULTIPLAYER_MESSAGE_TYPES.PLAYER_REMOVED,
    MULTIPLAYER_MESSAGE_TYPES.MATCH_LIFECYCLE_SIGNAL,
    MULTIPLAYER_MESSAGE_TYPES.PLAYER_ARENA_LOADED,
    MULTIPLAYER_MESSAGE_TYPES.ROUND_START_GATE,
]);

function isPriorityStateMessage(channelName, data) {
    return channelName === 'state' && PRIORITY_STATE_MESSAGE_TYPES.has(data?.type);
}

/**
 * Manages two data channels per peer:
 * - "inputs" (unreliable, unordered) — Client → Host, 60/s
 * - "state"  (reliable, ordered)     — Host → Client, 10/s
 */
export class DataChannelManager {
    constructor(options = {}) {
        this._channels = new Map();
        this._listeners = new Map();
        this._backpressureThresholdBytes = Number.isFinite(Number(options.backpressureThresholdBytes))
            ? Math.max(0, Math.floor(Number(options.backpressureThresholdBytes)))
            : 512 * 1024;
        this._backpressureCooldownMs = Number.isFinite(Number(options.backpressureCooldownMs))
            ? Math.max(0, Math.floor(Number(options.backpressureCooldownMs)))
            : 500;
        this._onBackpressure = typeof options.onBackpressure === 'function' ? options.onBackpressure : null;
        this._lastBackpressureByChannel = new Map();
    }

    createChannels(peerId, peerConnection) {
        const inputChannel = peerConnection.createDataChannel('inputs', {
            ordered: false,
            maxRetransmits: 0,
        });
        // Fully reliable: no maxRetransmits. This channel carries lifecycle-critical
        // messages (ROUND_START_GATE, FULL_STATE_SYNC, PLAYER_DISCONNECTED) that
        // must not be dropped under packet loss.
        const stateChannel = peerConnection.createDataChannel('state', {
            ordered: true,
        });

        this._setupChannel(peerId, 'inputs', inputChannel);
        this._setupChannel(peerId, 'state', stateChannel);
    }

    handleIncomingChannel(peerId, channel) {
        const name = channel.label;
        if (name === 'inputs' || name === 'state') {
            this._setupChannel(peerId, name, channel);
        }
    }

    _setupChannel(peerId, name, channel) {
        const key = `${peerId}:${name}`;
        this._channels.set(key, channel);

        channel.onopen = () => {
            this._emit('channelOpen', { peerId, channel: name });
        };
        channel.onclose = () => {
            this._emit('channelClose', { peerId, channel: name });
        };
        channel.onerror = (err) => {
            this._emit('channelError', { peerId, channel: name, error: err });
        };
        channel.onmessage = (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch {
                return;
            }
            this._emit('message', { peerId, channel: name, data });
        };
    }

    send(peerId, channelName, data) {
        const key = `${peerId}:${channelName}`;
        const channel = this._channels.get(key);
        if (!channel || channel.readyState !== 'open') return false;
        if (this._isBackpressured(peerId, channelName, channel)
            && !isPriorityStateMessage(channelName, data)) return false;

        try {
            channel.send(JSON.stringify(data));
            return true;
        } catch {
            return false;
        }
    }

    sendToAll(channelName, data, excludePeerId) {
        const json = JSON.stringify(data);
        for (const [key, channel] of this._channels) {
            if (!key.endsWith(`:${channelName}`)) continue;
            if (excludePeerId && key.startsWith(`${excludePeerId}:`)) continue;
            if (channel.readyState !== 'open') continue;
            const separatorIndex = key.indexOf(':');
            const peerId = separatorIndex >= 0 ? key.slice(0, separatorIndex) : '';
            if (this._isBackpressured(peerId, channelName, channel)
                && !isPriorityStateMessage(channelName, data)) continue;
            try {
                channel.send(json);
            } catch {
                // skip failed sends
            }
        }
    }

    getChannel(peerId, channelName) {
        return this._channels.get(`${peerId}:${channelName}`) || null;
    }

    closeChannels(peerId) {
        for (const [key, channel] of this._channels) {
            if (key.startsWith(`${peerId}:`)) {
                channel.close();
                this._channels.delete(key);
                this._lastBackpressureByChannel.delete(key);
            }
        }
    }

    on(event, handler) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        this._listeners.get(event).push(handler);
    }

    off(event, handler) {
        const handlers = this._listeners.get(event);
        if (!handlers) return;
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
    }

    _emit(event, data) {
        const handlers = this._listeners.get(event);
        if (handlers) {
            for (const handler of handlers) {
                handler(data);
            }
        }
    }

    _isBackpressured(peerId, channelName, channel) {
        const bufferedAmount = Number(channel?.bufferedAmount);
        if (!Number.isFinite(bufferedAmount) || bufferedAmount <= this._backpressureThresholdBytes) {
            return false;
        }
        this._emitBackpressure({
            peerId: String(peerId || '').trim(),
            channel: String(channelName || '').trim(),
            bufferedAmount,
        });
        return true;
    }

    _emitBackpressure(payload) {
        const peerId = String(payload?.peerId || '').trim();
        const channelName = String(payload?.channel || '').trim();
        if (!peerId || !channelName) return;

        const key = `${peerId}:${channelName}`;
        const now = Date.now();
        const lastEmitAt = Number(this._lastBackpressureByChannel.get(key) || 0);
        if (now - lastEmitAt < this._backpressureCooldownMs) return;
        this._lastBackpressureByChannel.set(key, now);

        const event = {
            peerId,
            channel: channelName,
            bufferedAmount: Number(payload.bufferedAmount) || 0,
            threshold: this._backpressureThresholdBytes,
            timestamp: now,
        };
        if (this._onBackpressure) {
            try {
                this._onBackpressure(event);
            } catch {
                // Best effort callback: event emitter remains source of truth.
            }
        }
        this._emit('backpressure', event);
    }

    dispose() {
        for (const channel of this._channels.values()) {
            channel.close();
        }
        this._channels.clear();
        this._listeners.clear();
        this._lastBackpressureByChannel.clear();
    }
}

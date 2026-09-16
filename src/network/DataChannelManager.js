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

const MAX_DATA_CHANNEL_MESSAGE_CHARS = 128 * 1024;

function utf8ByteLength(value) {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code < 0x80) bytes += 1;
        else if (code < 0x800) bytes += 2;
        else if (code >= 0xD800 && code <= 0xDBFF
            && value.charCodeAt(index + 1) >= 0xDC00 && value.charCodeAt(index + 1) <= 0xDFFF) {
            bytes += 4;
            index += 1;
        } else bytes += 3;
    }
    return bytes;
}

function createTrafficMetrics() {
    return { rxMessages: 0, rxBytes: 0, txMessages: 0, txBytes: 0, backpressureDrops: 0, sendErrors: 0 };
}

function isPriorityStateMessage(channelName, data) {
    return channelName === 'state' && PRIORITY_STATE_MESSAGE_TYPES.has(data?.type);
}

/**
 * Manages three data channels per peer:
 * - "snapshots" (unreliable, unordered) - Host to Client, 10/s
 * - "inputs" (unreliable, unordered) — Client → Host, 60/s
 * - "state"  (reliable, ordered)     — Lifecycle and control messages
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
        this._metrics = {
            total: createTrafficMetrics(),
            channels: {
                inputs: createTrafficMetrics(),
                state: createTrafficMetrics(),
                snapshots: createTrafficMetrics(),
            },
        };
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
        const snapshotChannel = peerConnection.createDataChannel('snapshots', {
            ordered: false,
            maxRetransmits: 0,
        });

        this._setupChannel(peerId, 'inputs', inputChannel);
        this._setupChannel(peerId, 'state', stateChannel);
        this._setupChannel(peerId, 'snapshots', snapshotChannel);
    }

    handleIncomingChannel(peerId, channel) {
        const name = channel.label;
        if (name === 'inputs' || name === 'state' || name === 'snapshots') {
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
            if (typeof event.data !== 'string' || event.data.length > MAX_DATA_CHANNEL_MESSAGE_CHARS) {
                this._emit('protocolError', { peerId, channel: name, reason: 'invalid_message_size' });
                return;
            }
            this._recordTraffic(name, 'rxMessages', 1);
            this._recordTraffic(name, 'rxBytes', utf8ByteLength(event.data));
            let data;
            try {
                data = JSON.parse(event.data);
            } catch {
                this._emit('protocolError', { peerId, channel: name, reason: 'invalid_json' });
                return;
            }
            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                this._emit('protocolError', { peerId, channel: name, reason: 'invalid_message_shape' });
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
            && !isPriorityStateMessage(channelName, data)) {
            this._recordTraffic(channelName, 'backpressureDrops', 1);
            return false;
        }

        try {
            const json = JSON.stringify(data);
            const byteLength = utf8ByteLength(json);
            channel.send(json);
            this._recordTraffic(channelName, 'txMessages', 1);
            this._recordTraffic(channelName, 'txBytes', byteLength);
            return true;
        } catch {
            this._recordTraffic(channelName, 'sendErrors', 1);
            return false;
        }
    }

    sendToAll(channelName, data, excludePeerId) {
        const json = JSON.stringify(data);
        const byteLength = utf8ByteLength(json);
        for (const [key, channel] of this._channels) {
            if (!key.endsWith(`:${channelName}`)) continue;
            if (excludePeerId && key.startsWith(`${excludePeerId}:`)) continue;
            if (channel.readyState !== 'open') continue;
            const separatorIndex = key.indexOf(':');
            const peerId = separatorIndex >= 0 ? key.slice(0, separatorIndex) : '';
            if (this._isBackpressured(peerId, channelName, channel)
                && !isPriorityStateMessage(channelName, data)) {
                this._recordTraffic(channelName, 'backpressureDrops', 1);
                continue;
            }
            try {
                channel.send(json);
                this._recordTraffic(channelName, 'txMessages', 1);
                this._recordTraffic(channelName, 'txBytes', byteLength);
            } catch {
                this._recordTraffic(channelName, 'sendErrors', 1);
            }
        }
    }

    _recordTraffic(channelName, field, amount) {
        const channelMetrics = this._metrics.channels[channelName];
        if (!channelMetrics || !Number.isFinite(amount)) return;
        channelMetrics[field] += amount;
        this._metrics.total[field] += amount;
    }

    getMetrics() {
        const channels = {};
        for (const [name, metrics] of Object.entries(this._metrics.channels)) {
            let bufferedBytes = 0;
            for (const [key, channel] of this._channels) {
                if (!key.endsWith(`:${name}`)) continue;
                bufferedBytes += Math.max(0, Number(channel?.bufferedAmount) || 0);
            }
            channels[name] = { ...metrics, bufferedBytes };
        }
        return { total: { ...this._metrics.total }, channels };
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
        this._metrics = {
            total: createTrafficMetrics(),
            channels: {
                inputs: createTrafficMetrics(),
                state: createTrafficMetrics(),
                snapshots: createTrafficMetrics(),
            },
        };
    }
}

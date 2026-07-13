// ============================================
// LatencyMonitor.js - RTT and jitter tracking per client
// ============================================

/**
 * Tracks round-trip time and jitter for each connected peer.
 * Sends periodic pings and measures response time.
 */
export class LatencyMonitor {
    constructor(options = {}) {
        this._pingInterval = options.pingInterval || 1000;
        // A pending ping is kept alive across ticks so RTTs above the ping
        // interval remain measurable; it is abandoned after this timeout.
        this._pingTimeout = options.pingTimeout || Math.max(4000, (options.pingInterval || 1000) * 4);
        this._historySize = options.historySize || 20;
        this._peers = new Map();
        this._intervalId = null;
        this._onPingNeeded = options.onPingNeeded || null;
        this._running = false;
    }

    addPeer(peerId) {
        this._peers.set(peerId, {
            rttHistory: [],
            lastRtt: 0,
            avgRtt: 0,
            jitter: 0,
            lastPingSent: 0,
            pendingPingId: null,
        });
        this._ensurePingLoop();
    }

    removePeer(peerId) {
        this._peers.delete(peerId);
        if (this._peers.size <= 0 && this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }

    recordPingSent(peerId, pingId) {
        const peer = this._peers.get(peerId);
        if (!peer) return;
        peer.lastPingSent = performance.now();
        peer.pendingPingId = pingId;
    }

    recordPongReceived(peerId, pingId) {
        const peer = this._peers.get(peerId);
        if (!peer || peer.pendingPingId !== pingId) return;

        const rtt = performance.now() - peer.lastPingSent;
        peer.lastRtt = rtt;
        peer.rttHistory.push(rtt);
        if (peer.rttHistory.length > this._historySize) {
            peer.rttHistory.shift();
        }
        peer.pendingPingId = null;

        const sum = peer.rttHistory.reduce((a, b) => a + b, 0);
        peer.avgRtt = sum / peer.rttHistory.length;

        if (peer.rttHistory.length > 1) {
            let jitterSum = 0;
            for (let i = 1; i < peer.rttHistory.length; i++) {
                jitterSum += Math.abs(peer.rttHistory[i] - peer.rttHistory[i - 1]);
            }
            peer.jitter = jitterSum / (peer.rttHistory.length - 1);
        }
    }

    getRTT(peerId) {
        return this._peers.get(peerId)?.avgRtt || 0;
    }

    getJitter(peerId) {
        return this._peers.get(peerId)?.jitter || 0;
    }

    getMaxRTT() {
        let max = 0;
        for (const peer of this._peers.values()) {
            if (peer.avgRtt > max) max = peer.avgRtt;
        }
        return max;
    }

    getAllStats() {
        const stats = {};
        for (const [id, peer] of this._peers) {
            stats[id] = {
                rtt: Math.round(peer.avgRtt),
                jitter: Math.round(peer.jitter),
                lastRtt: Math.round(peer.lastRtt),
            };
        }
        return stats;
    }

    start() {
        this._running = true;
        this._ensurePingLoop();
    }

    stop() {
        this._running = false;
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }
    }

    _ensurePingLoop() {
        if (!this._running) return;
        if (this._intervalId) return;
        if (this._peers.size <= 0) return;
        this._intervalId = setInterval(() => {
            if (this._peers.size <= 0) {
                clearInterval(this._intervalId);
                this._intervalId = null;
                return;
            }
            if (!this._onPingNeeded) return;
            const now = performance.now();
            for (const [peerId, peer] of this._peers) {
                if (peer.pendingPingId && now - peer.lastPingSent < this._pingTimeout) {
                    continue;
                }
                const pingId = `ping-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                this.recordPingSent(peerId, pingId);
                this._onPingNeeded(peerId, pingId);
            }
        }, this._pingInterval);
    }

    dispose() {
        this.stop();
        this._peers.clear();
    }
}

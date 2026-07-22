// ============================================
// PeerConnectionManager.js - WebRTC lifecycle, Star topology
// ============================================

/**
 * Manages WebRTC PeerConnections in a Star topology.
 * Host maintains up to N-1 connections (one per client).
 * Clients maintain exactly one connection (to the host).
 *
 * --- C.7 Test-Checkliste ---
 * [ ] Disconnect-Simulation: Trenne ein Peer manuell (Browser-Tab schließen, Netzwerk aus) →
 *     peerDisconnected wird innerhalb von 5s emittiert, die UI zeigt eine Warnung.
 * [ ] Heartbeat-Timeout: Stoppe Pong-Antworten eines Peers → nach HEARTBEAT_TIMEOUT (5s)
 *     wird der Peer automatisch als disconnected markiert.
 * [ ] Reconnect innerhalb 30s: Trenne einen Client, verbinde innerhalb 30s erneut →
 *     Full-State-Sync wird gesendet, Client spielt normal weiter.
 * [ ] Reconnect-Fenster abgelaufen: Trenne einen Client, warte >30s →
 *     Slot wird endgültig freigegeben, playerRemoved emittiert.
 * [ ] Host-Disconnect: Host-Tab schließen → Clients zeigen "Host getrennt" Dialog,
 *     Match wird beendet.
 * [ ] Graceful Leave: beforeunload → Leave-Nachricht wird gesendet, andere Clients
 *     erhalten sofort playerDisconnected.
 * [ ] Build-Skripte: npm run build:web erzeugt dist/ ohne canHost; npm run build:app
 *     erzeugt dist/ mit canHost=true.
 * [ ] npm run build durchläuft fehlerfrei.
 * [ ] npm run lint:architecture durchläuft fehlerfrei.
 * ---
 */

const DEFAULT_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * Build ICE server list from environment + defaults.
 * Set VITE_TURN_URL, VITE_TURN_USER (or legacy VITE_TURN_USERNAME), VITE_TURN_CREDENTIAL to add a TURN server.
 * Example: VITE_TURN_URL=turn:myserver.com:3478
 */
function resolveIceServers(custom) {
    if (custom && custom.length) return custom;

    const servers = [...DEFAULT_ICE_SERVERS];

    const runtimeGlobals = /** @type {any} */ (globalThis);
    const turnUrl = typeof runtimeGlobals.__TURN_URL__ === 'string' ? runtimeGlobals.__TURN_URL__ : '';
    const turnUser = typeof runtimeGlobals.__TURN_USERNAME__ === 'string' ? runtimeGlobals.__TURN_USERNAME__ : '';
    const turnCred = typeof runtimeGlobals.__TURN_CREDENTIAL__ === 'string' ? runtimeGlobals.__TURN_CREDENTIAL__ : '';

    if (turnUrl) {
        const entry = { urls: turnUrl };
        if (turnUser) entry.username = turnUser;
        if (turnCred) entry.credential = turnCred;
        servers.push(entry);
    }

    return servers;
}

/** Heartbeat interval and timeout for disconnect detection (C.1) */
const HEARTBEAT_INTERVAL = 2000;
const HEARTBEAT_TIMEOUT = 5000;

export class PeerConnectionManager {
    constructor(options = {}) {
        this.isHost = !!options.isHost;
        this.iceServers = resolveIceServers(options.iceServers);
        this._peers = new Map();
        this._listeners = new Map();
        this._dataChannelManager = options.dataChannelManager || null;
        /** @type {Map<string, {lastPong: number, intervalId: number|null}>} */
        this._heartbeats = new Map();
        /**
         * Remote ICE candidates that arrived before the remote description was
         * set (Trickle-ICE race). They are flushed after handleOffer/handleAnswer.
         * @type {Map<string, any[]>}
         */
        this._pendingRemoteCandidates = new Map();
        this._connectedPeers = new Set();
    }

    async createOffer(peerId) {
        const pc = this._createPeerConnection(peerId);

        if (this._dataChannelManager) {
            this._dataChannelManager.createChannels(peerId, pc);
        }

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        await this._waitForIceGathering(pc);

        return pc.localDescription;
    }

    async handleOffer(peerId, offer) {
        const pc = this._createPeerConnection(peerId);

        pc.ondatachannel = (event) => {
            if (this._dataChannelManager) {
                this._dataChannelManager.handleIncomingChannel(peerId, event.channel);
            }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        await this._flushPendingRemoteCandidates(peerId, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        await this._waitForIceGathering(pc);

        return pc.localDescription;
    }

    async handleAnswer(peerId, answer) {
        const pc = this._peers.get(peerId);
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        await this._flushPendingRemoteCandidates(peerId, pc);
    }

    async addIceCandidate(peerId, candidate) {
        const pc = this._peers.get(peerId);
        if (!candidate) return;
        // Buffer candidates that arrive before the peer connection exists or before
        // its remote description is set; addIceCandidate() would throw and the
        // candidate would be lost (signaling queues are drained on read).
        if (!pc || !pc.remoteDescription) {
            const queue = this._pendingRemoteCandidates.get(peerId) || [];
            queue.push(candidate);
            this._pendingRemoteCandidates.set(peerId, queue);
            return;
        }
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }

    async _flushPendingRemoteCandidates(peerId, pc) {
        const queue = this._pendingRemoteCandidates.get(peerId);
        this._pendingRemoteCandidates.delete(peerId);
        if (!queue || !pc) return;
        for (const candidate of queue) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch {
                // Individual candidates may be stale after a renegotiation; the
                // remaining candidates are still applied.
            }
        }
    }

    _createPeerConnection(peerId) {
        if (this._peers.has(peerId)) {
            this._peers.get(peerId).close();
            this._connectedPeers.delete(peerId);
            this._stopHeartbeat(peerId);
        }

        const pc = new RTCPeerConnection({ iceServers: this.iceServers });
        this._peers.set(peerId, pc);

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this._emit('iceCandidate', { peerId, candidate: event.candidate });
            }
        };

        pc.onconnectionstatechange = () => {
            const state = pc.connectionState;
            this._emit('connectionStateChange', { peerId, state });
            if (state === 'connected') {
                if (!this._connectedPeers.has(peerId)) {
                    this._emit('peerConnected', { peerId });
                    this._connectedPeers.add(peerId);
                }
                this._startHeartbeat(peerId);
            }
            if (state === 'failed' || state === 'closed') {
                this._connectedPeers.delete(peerId);
                this._stopHeartbeat(peerId);
                this._emit('peerDisconnected', { peerId, state });
            }
        };

        return pc;
    }

    /** Start heartbeat monitoring for a peer (C.1) */
    _startHeartbeat(peerId) {
        this._stopHeartbeat(peerId);
        const hb = { lastPong: Date.now(), intervalId: null };
        hb.intervalId = setInterval(() => {
            if (Date.now() - hb.lastPong > HEARTBEAT_TIMEOUT) {
                this._stopHeartbeat(peerId);
                this._emit('heartbeatTimeout', { peerId });
            } else if (this._dataChannelManager) {
                this._dataChannelManager.send(peerId, 'state', {
                    type: 'heartbeat',
                    ts: Date.now(),
                });
            }
        }, HEARTBEAT_INTERVAL);
        this._heartbeats.set(peerId, hb);
    }

    /** Stop heartbeat for a peer */
    _stopHeartbeat(peerId) {
        const hb = this._heartbeats.get(peerId);
        if (hb?.intervalId) {
            clearInterval(hb.intervalId);
        }
        this._heartbeats.delete(peerId);
    }

    /** Record that we received a heartbeat ack from a peer */
    recordHeartbeatAck(peerId) {
        const hb = this._heartbeats.get(peerId);
        if (hb) hb.lastPong = Date.now();
    }

    /** Record any inbound data-channel traffic as peer liveness. */
    recordPeerActivity(peerId) {
        this.recordHeartbeatAck(peerId);
    }

    _waitForIceGathering(pc, timeout = 3000) {
        return new Promise((resolve) => {
            if (pc.iceGatheringState === 'complete') {
                resolve();
                return;
            }
            const timer = setTimeout(resolve, timeout);
            pc.onicegatheringstatechange = () => {
                if (pc.iceGatheringState === 'complete') {
                    clearTimeout(timer);
                    resolve();
                }
            };
        });
    }

    getConnection(peerId) {
        return this._peers.get(peerId) || null;
    }

    getAllPeerIds() {
        return Array.from(this._peers.keys());
    }

    get peerCount() {
        return this._peers.size;
    }

    closePeer(peerId) {
        const pc = this._peers.get(peerId);
        if (pc) {
            pc.close();
            this._peers.delete(peerId);
        }
        this._pendingRemoteCandidates.delete(peerId);
        this._connectedPeers.delete(peerId);
        this._stopHeartbeat(peerId);
        if (this._dataChannelManager) {
            this._dataChannelManager.closeChannels(peerId);
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

    dispose() {
        for (const peerId of this._heartbeats.keys()) {
            this._stopHeartbeat(peerId);
        }
        for (const [, pc] of this._peers) {
            pc.close();
        }
        this._peers.clear();
        this._connectedPeers.clear();
        this._pendingRemoteCandidates.clear();
        this._listeners.clear();
    }
}

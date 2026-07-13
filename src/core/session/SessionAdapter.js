// ============================================
// SessionAdapter.js - interface for session transport
// ============================================

/**
 * Abstract interface for session transport.
 * Implementations: LocalSessionAdapter, LANSessionAdapter, OnlineSessionAdapter
 *
 * The SessionAdapter manages the connection between this client and the game host.
 * For LocalSessionAdapter (splitscreen), everything runs in shared memory.
 * For LAN/Online, it wraps WebRTC data channels.
 */
export class SessionAdapter {
    constructor() {
        this.isHost = false;
        this.isConnected = false;
        this.localPlayerId = null;
        this._listeners = new Map();
    }

    async connect(_options) {
        throw new Error('SessionAdapter.connect() not implemented');
    }

    disconnect() {
        throw new Error('SessionAdapter.disconnect() not implemented');
    }

    sendInput(_inputData) {
        throw new Error('SessionAdapter.sendInput() not implemented');
    }

    broadcastState(_stateSnapshot) {
        throw new Error('SessionAdapter.broadcastState() not implemented');
    }

    getPlayers() {
        throw new Error('SessionAdapter.getPlayers() not implemented');
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
        this._listeners.clear();
    }
}

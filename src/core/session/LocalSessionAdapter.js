// ============================================
// LocalSessionAdapter.js - splitscreen session (shared memory)
// ============================================

import { SessionAdapter } from './SessionAdapter.js';

/**
 * SessionAdapter for local splitscreen play.
 * No network involved — all players share the same process.
 * This adapter is essentially a no-op that maintains API compatibility.
 */
export class LocalSessionAdapter extends SessionAdapter {
    constructor() {
        super();
        this.isHost = true;
        this.isConnected = true;
        this.localPlayerId = 'local-host';
        this._players = [];
    }

    async connect(options = {}) {
        const numHumans = options.numHumans || 1;
        this._players = [];
        for (let i = 0; i < numHumans; i++) {
            this._players.push({
                id: `local-p${i}`,
                index: i,
                isLocal: true,
                isHost: i === 0,
                ready: true,
            });
        }
        this.isConnected = true;
        this._emit('connected', { players: this._players });
    }

    disconnect() {
        this.isConnected = false;
        this._players = [];
        this._emit('disconnected', { reason: 'local' });
    }

    sendInput(_inputData) {
        // No-op: inputs are read directly from InputManager in local mode
    }

    broadcastState(_stateSnapshot) {
        // No-op: state is shared memory in local mode
    }

    getPlayers() {
        return this._players;
    }

    dispose() {
        this.disconnect();
        super.dispose();
    }
}

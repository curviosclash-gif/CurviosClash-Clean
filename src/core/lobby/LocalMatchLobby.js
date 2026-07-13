// ============================================
// LocalMatchLobby.js - local splitscreen lobby
// ============================================

import { MatchLobby } from './MatchLobby.js';

/**
 * Lobby for local splitscreen play.
 * No network, instant start. 1-2 local players.
 */
export class LocalMatchLobby extends MatchLobby {
    constructor() {
        super('local');
        this.isHost = true;
    }

    async create(options = {}) {
        const numHumans = options.numHumans || 1;
        this.settings = { ...options };
        this.players = [];
        for (let i = 0; i < numHumans; i++) {
            this.players.push({
                id: `local-p${i}`,
                index: i,
                name: `Spieler ${i + 1}`,
                isHost: i === 0,
                ready: true,
            });
        }
        this.lobbyCode = null;
        this._emit('playersChanged', { players: this.players });
    }

    async join(_code) {
        // Local lobby doesn't support joining
        throw new Error('LocalMatchLobby does not support joining');
    }

    leave() {
        this.players = [];
        this._emit('closed', {});
    }

    setReady(_ready) {
        // Always ready in local mode
    }

    updateSettings(settings) {
        Object.assign(this.settings, settings);
        this._emit('settingsChanged', { settings: this.settings });
    }

    startMatch() {
        this._emit('matchStart', { players: this.players, settings: this.settings });
    }

    dispose() {
        this.leave();
        super.dispose();
    }
}

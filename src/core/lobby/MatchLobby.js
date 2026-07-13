// ============================================
// MatchLobby.js - interface for match lobby
// ============================================

/**
 * Abstract interface for match lobby management.
 * Implementations: LocalMatchLobby, LANMatchLobby, OnlineMatchLobby
 *
 * The lobby manages pre-match coordination:
 * - Creating/joining a game session
 * - Player list and ready state
 * - Settings synchronization
 * - Match start signaling
 */
export class MatchLobby {
    constructor(type = 'unknown') {
        this.type = type;
        this.lobbyCode = null;
        this.players = [];
        this.settings = {};
        this.isHost = false;
        this._listeners = new Map();
    }

    async create(_options) {
        throw new Error('MatchLobby.create() not implemented');
    }

    async join(_codeOrAddress) {
        throw new Error('MatchLobby.join() not implemented');
    }

    leave() {
        throw new Error('MatchLobby.leave() not implemented');
    }

    setReady(_ready) {
        throw new Error('MatchLobby.setReady() not implemented');
    }

    updateSettings(_settings) {
        throw new Error('MatchLobby.updateSettings() not implemented');
    }

    startMatch() {
        throw new Error('MatchLobby.startMatch() not implemented');
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

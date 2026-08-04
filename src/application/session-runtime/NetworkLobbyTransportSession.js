import { LANMatchLobby } from '../../network/LANMatchLobby.js';
import {
    defaultJoinLobby,
    normalizeString,
} from './NetworkLobbyServiceSupport.js';

export class NetworkLobbyTransportSession {
    constructor(options = {}) {
        this._transport = options.transport;
        this._runtime = options.runtime && typeof options.runtime === 'object' ? options.runtime : {};
        this._platformCapabilities = options.platformCapabilities && typeof options.platformCapabilities === 'object'
            ? options.platformCapabilities
            : {};
        this._createLobby = typeof options.createLobby === 'function'
            ? options.createLobby
            : (signalingUrl) => new LANMatchLobby({ signalingUrl });
        this._joinLobby = typeof options.joinLobby === 'function' ? options.joinLobby : defaultJoinLobby;
        this._onSessionStateChanged = typeof options.onSessionStateChanged === 'function'
            ? options.onSessionStateChanged
            : null;
        this._onError = typeof options.onError === 'function' ? options.onError : null;
        this._onClosed = typeof options.onClosed === 'function' ? options.onClosed : null;
        this._onMatchStart = typeof options.onMatchStart === 'function' ? options.onMatchStart : null;
        this._onConnectionPhaseChanged = typeof options.onConnectionPhaseChanged === 'function'
            ? options.onConnectionPhaseChanged
            : null;
        this._signalingUrl = '';
        this._lobby = null;
    }

    _bindLobby(lobby) {
        lobby.on('sessionStateChanged', ({ sessionState }) => {
            this._onSessionStateChanged?.({
                sessionState,
                signalingUrl: this._signalingUrl,
                localPeerId: lobby.getLocalPeerId?.(),
            });
        });
        lobby.on('error', (payload = null) => {
            this._onError?.(payload);
        });
        lobby.on('closed', (payload = null) => {
            this._onClosed?.(payload);
        });
        lobby.on('matchStart', ({ pendingMatchStart }) => {
            this._onMatchStart?.(pendingMatchStart);
        });
        lobby.on('reconnecting', (payload = null) => {
            this._onConnectionPhaseChanged?.({ phase: 'reconnecting', ...(payload || {}) });
        });
        lobby.on('connectionResumed', (payload = null) => {
            this._onConnectionPhaseChanged?.({ phase: 'connected', ...(payload || {}) });
        });
    }

    replace(nextSignalingUrl) {
        if (this._lobby) {
            this._lobby.dispose?.();
        }
        this._signalingUrl = normalizeString(nextSignalingUrl, '');
        this._lobby = this._createLobby(this._signalingUrl, {
            transport: this._transport,
            runtime: this._runtime,
            platformCapabilities: this._platformCapabilities,
        });
        this._bindLobby(this._lobby);
    }

    create(options = {}) {
        return this._lobby.create(options);
    }

    join(options = {}) {
        return this._joinLobby(this._lobby, options);
    }

    setReady(ready) {
        return this._lobby.setReady(ready);
    }

    invalidateReadyForAll() {
        return this._lobby.invalidateReadyForAll();
    }

    updateSettings(settingsSnapshot) {
        return this._lobby?.updateSettings?.(settingsSnapshot);
    }

    startMatch(options = {}) {
        return this._lobby.startMatch(options);
    }

    hasLobby() {
        return !!this._lobby;
    }

    getLobbyState() {
        return this._lobby?.sessionState || null;
    }

    getLocalPeerId() {
        return this._lobby?.getLocalPeerId?.();
    }

    getLocalPeerToken() {
        return this._lobby?.getLocalPeerToken?.() || '';
    }

    getSignalingUrl() {
        return this._signalingUrl;
    }

    dispose() {
        const currentLobby = this._lobby;
        this._lobby = null;
        currentLobby?.dispose?.();
        this._signalingUrl = '';
    }
}

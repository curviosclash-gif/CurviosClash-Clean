// ============================================
// LANMatchLobby.js - LAN lobby via embedded signaling
// ============================================

import { createLogger } from '../shared/logging/Logger.js';
import { MatchLobby } from '../core/lobby/MatchLobby.js';

const logger = createLogger('LANMatchLobby');
import {
    createInitialLobbySessionState,
    normalizeLobbySessionState,
} from './MatchLobbySessionState.js';
import {
    SIGNALING_HTTP_ROUTES,
} from '../shared/contracts/SignalingSessionContract.js';
import {
    createNetworkUnavailableSignalingError,
    toErrorPayload,
} from './OnlineSignalingSupport.js';
import {
    buildLanRequestError,
    publishLanLobbyMetadata,
} from './LANSignalingSupport.js';
import { createLobbyRuntimeBindings } from './LobbyRuntimeBindings.js';

const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_POLL_TIMEOUT_MS = 2500;
const POLL_FAILURE_THRESHOLD = 3;

/**
 * Lobby for LAN play. Communicates with the embedded LAN signaling server
 * running in the Electron/Tauri app main process.
 */
export class LANMatchLobby extends MatchLobby {
    constructor(options = {}) {
        super('lan');
        this._lobbyRuntime = createLobbyRuntimeBindings(options);
        this._signalingUrl = options.signalingUrl || 'http://localhost:9090';
        this._pollingTimer = null;
        this._pollingAbortController = null;
        this._pollInFlight = false;
        this._pollClosed = false;
        this._consecutivePollFailures = 0;
        this._pollIntervalMs = Number.isFinite(Number(options.pollIntervalMs))
            ? Math.max(100, Math.floor(Number(options.pollIntervalMs)))
            : DEFAULT_POLL_INTERVAL_MS;
        this._pollTimeoutMs = Number.isFinite(Number(options.pollTimeoutMs))
            ? Math.max(250, Math.floor(Number(options.pollTimeoutMs)))
            : DEFAULT_POLL_TIMEOUT_MS;
        this.sessionState = createInitialLobbySessionState();
        this._localPeerId = '';
        this._localPeerToken = '';
        this._lastHandledMatchCommandId = '';
        this._reconnectPromise = null;
        this._cancelReconnect = false;
    }

    _applySessionState(nextState) {
        this.sessionState = normalizeLobbySessionState(nextState);
        this.lobbyCode = this.sessionState.lobbyCode;
        this.players = this.sessionState.players;
        this._emit('playersChanged', { players: this.players, sessionState: this.sessionState });
        this._emit('sessionStateChanged', { sessionState: this.sessionState });
    }

    async create(options = {}) {
        this.isHost = true;
        this.settings = { ...options };
        this._localPeerId = 'host';
        this._lastHandledMatchCommandId = '';
        this._pollClosed = false;
        this._consecutivePollFailures = 0;
        this._cancelReconnect = false;

        const res = await fetch(`${this._signalingUrl}${SIGNALING_HTTP_ROUTES.LOBBY_CREATE}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                maxPlayers: Number(options.maxPlayers || 10),
                actorId: options.actorId,
                name: options.name || options.actorId,
                metadata: options.metadata,
            }),
        });
        if (res?.ok === false) {
            const payload = await res.json().catch(() => ({}));
            throw buildLanRequestError({
                response: res,
                payload,
                fallbackMessage: 'Lobby erstellen fehlgeschlagen.',
                fallbackCode: 'lobby_create_failed',
            });
        }
        const data = await res.json();
        this._localPeerToken = String(data.hostToken || '').trim();
        this._processServerStatus(data);
        this._startPolling();
        if (!this.sessionState.lobbyCode) {
            throw new Error('Lobby create failed: lobby code missing');
        }
    }

    async join(codeOrAddress) {
        const joinOptions = codeOrAddress && typeof codeOrAddress === 'object'
            ? codeOrAddress
            : { signalingUrl: codeOrAddress };
        this.isHost = false;
        if (joinOptions?.lobbyCode) {
            this.lobbyCode = String(joinOptions.lobbyCode || '').trim().toUpperCase();
        }
        const rawUrl = String(joinOptions?.signalingUrl || joinOptions?.address || '').trim();
        const url = rawUrl.includes('://')
            ? rawUrl
            : `http://${rawUrl}`;
        this._signalingUrl = url;
        this._lastHandledMatchCommandId = '';
        this._pollClosed = false;
        this._consecutivePollFailures = 0;
        this._cancelReconnect = false;

        try {
            const res = await fetch(`${this._signalingUrl}${SIGNALING_HTTP_ROUTES.LOBBY_JOIN}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lobbyCode: this.lobbyCode,
                    actorId: joinOptions.actorId,
                    name: joinOptions.name || joinOptions.actorId,
                }),
            });
            if (res?.ok === false) {
                const payload = await res.json().catch(() => ({}));
                throw buildLanRequestError({
                    response: res,
                    payload,
                    fallbackMessage: 'Lobby beitreten fehlgeschlagen.',
                    fallbackCode: 'join_failed',
                });
            }
            const data = await res.json();
            this._localPeerId = String(data.playerId || '').trim();
            this._localPeerToken = String(data.playerToken || '').trim();
            // A pendingMatchStart that predates this join belongs to an already
            // running match — mark it handled so the joiner does not fire a
            // stale matchStart immediately.
            const staleCommandId = String(
                data?.sessionState?.pendingMatchStart?.commandId
                || data?.pendingMatchStart?.commandId
                || ''
            ).trim();
            if (staleCommandId) {
                this._lastHandledMatchCommandId = staleCommandId;
            }
            this._processServerStatus(data);
            this._startPolling();
        } catch (err) {
            logger.warn('Lobby join request failed:', err);
            if (err instanceof Error && typeof err.code === 'string') {
                throw err;
            }
            throw buildLanRequestError({
                fallbackMessage: `LAN-Signaling nicht erreichbar: ${this._signalingUrl}`,
                fallbackCode: 'signaling_network_unavailable',
            });
        }
    }

    _syncWithServerStatus(serverState = {}) {
        const status = serverState && typeof serverState === 'object' ? serverState : {};
        const existingMembers = Array.isArray(this.sessionState?.members) ? this.sessionState.members : [];
        const serverPlayers = Array.isArray(status.players) ? status.players : [];

        const merged = [];
        const hostPeerId = String(status.hostPeerId || this.sessionState.hostPeerId || 'host').trim() || 'host';
        const now = this._lobbyRuntime.nowMs();

        const ensureMember = (player, fallbackRole = 'client') => {
            const peerId = String(player?.playerId || player?.peerId || player?.id || '').trim();
            if (!peerId) return;
            const existing = existingMembers.find((member) => member.peerId === peerId);
            const resolvedReady = typeof player?.ready === 'boolean'
                ? player.ready === true
                : existing?.ready === true;
            merged.push({
                peerId,
                actorId: String(player?.actorId || existing?.actorId || player?.name || (peerId === hostPeerId ? 'Host' : peerId)).trim(),
                name: String(player?.name || existing?.name || peerId).trim(),
                role: peerId === hostPeerId ? 'host' : fallbackRole,
                ready: resolvedReady,
                joinedAt: Number(existing?.joinedAt || now),
                lastSeenAt: now,
            });
        };

        ensureMember({
            playerId: hostPeerId,
            actorId: status.hostActorId,
            name: status.hostName || status.hostActorId || 'Host',
            ready: status.hostReady === true,
        }, 'host');
        for (const player of serverPlayers) {
            ensureMember(player, 'client');
        }

        this._applySessionState({
            lobbyCode: status.lobbyCode || this.sessionState.lobbyCode,
            hostPeerId,
            maxPlayers: Number(status.maxPlayers || this.sessionState.maxPlayers || 10),
            members: merged,
            pendingMatchStart: status?.pendingMatchStart && typeof status.pendingMatchStart === 'object'
                ? { ...status.pendingMatchStart }
                : null,
            updatedAt: now,
            revision: Number(this.sessionState.revision || 0) + 1,
        });
    }

    _processServerStatus(serverState = {}) {
        const status = serverState?.sessionState && typeof serverState.sessionState === 'object'
            ? serverState.sessionState
            : serverState;
        this._syncWithServerStatus(status);

        const pendingMatchStart = status?.pendingMatchStart && typeof status.pendingMatchStart === 'object'
            ? {
                ...status.pendingMatchStart,
                settingsSnapshot: status.pendingMatchStart.settingsSnapshot ?? null,
            }
            : null;
        const commandId = String(pendingMatchStart?.commandId || '').trim();
        if (commandId && commandId !== this._lastHandledMatchCommandId) {
            this._lastHandledMatchCommandId = commandId;
            this._emit('matchStart', {
                pendingMatchStart,
                players: this.players,
                settings: pendingMatchStart.settingsSnapshot ?? this.settings,
                sessionState: this.sessionState,
            });
        }
    }

    _startPolling() {
        this._stopPolling();
        this._pollClosed = false;
        const pollLoop = async () => {
            if (this._pollClosed) return;
            if (!this._pollInFlight) {
                this._pollInFlight = true;
                try {
                    const data = await this._pollStatusOnce();
                    this._consecutivePollFailures = 0;
                    this._processServerStatus(data);
                } catch (err) {
                    this._consecutivePollFailures += 1;
                    logger.debug('Lobby status poll failed:', err);
                    if (this._consecutivePollFailures >= POLL_FAILURE_THRESHOLD) {
                        this._handleSignalingClosed(err);
                        this._pollInFlight = false;
                        return;
                    }
                } finally {
                    this._pollInFlight = false;
                }
            }
            this._pollingTimer = setTimeout(pollLoop, this._pollIntervalMs);
        };
        this._pollingTimer = setTimeout(pollLoop, this._pollIntervalMs);
    }

    _stopPolling() {
        this._pollClosed = true;
        if (this._pollingTimer) {
            clearTimeout(this._pollingTimer);
            this._pollingTimer = null;
        }
        if (this._pollingAbortController) {
            this._pollingAbortController.abort();
            this._pollingAbortController = null;
        }
    }

    async _pollStatusOnce() {
        if (this._pollingAbortController) {
            this._pollingAbortController.abort();
        }
        this._pollingAbortController = new AbortController();
        const timeoutId = setTimeout(() => {
            this._pollingAbortController?.abort();
        }, this._pollTimeoutMs);
        try {
            const statusParams = `?${new URLSearchParams({
                playerId: this._localPeerId,
                token: this._localPeerToken,
            }).toString()}`;
            const res = await fetch(`${this._signalingUrl}${SIGNALING_HTTP_ROUTES.LOBBY_STATUS}${statusParams}`, {
                signal: this._pollingAbortController.signal,
            });
            if (res?.ok === false) {
                throw new Error(`Lobby status failed (${res.status || 'unknown'})`);
            }
            return await res.json();
        } finally {
            clearTimeout(timeoutId);
            this._pollingAbortController = null;
        }
    }

    _handleSignalingClosed(error = null) {
        if (this._pollClosed) return;
        this._stopPolling();
        const err = createNetworkUnavailableSignalingError({
            signalingUrl: this._signalingUrl,
            source: 'lan_status_poll',
            reason: error instanceof Error ? error.message : 'unknown',
        }, error instanceof Error ? error : null);
        if (this._reconnectPromise || !this._localPeerId || !this._localPeerToken) return;
        this._reconnectPromise = this._attemptReconnect(err).finally(() => {
            this._reconnectPromise = null;
        });
    }

    async _attemptReconnect(closeError) {
        const maxAttempts = 3;
        let lastError = closeError;
        for (let attempt = 1; attempt <= maxAttempts && !this._cancelReconnect; attempt += 1) {
            this._emit('reconnecting', { attempt, maxAttempts, sessionState: this.sessionState });
            if (attempt > 1) {
                await new Promise((resolve) => setTimeout(resolve, attempt * 750));
            }
            if (this._cancelReconnect) return;
            try {
                let data;
                if (this.isHost) {
                    data = await this._pollStatusOnce();
                } else {
                    const response = await fetch(`${this._signalingUrl}${SIGNALING_HTTP_ROUTES.LOBBY_REJOIN}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            playerId: this._localPeerId,
                            playerToken: this._localPeerToken,
                        }),
                    });
                    if (response?.ok === false) {
                        const payload = await response.json().catch(() => ({}));
                        throw buildLanRequestError({
                            response,
                            payload,
                            fallbackMessage: 'Wiederverbindung fehlgeschlagen.',
                            fallbackCode: 'connection_resume_failed',
                        });
                    }
                    data = await response.json();
                }
                if (this._cancelReconnect) return;
                this._consecutivePollFailures = 0;
                this._processServerStatus(data);
                this._emit('connectionResumed', { sessionState: this.sessionState });
                this._startPolling();
                return;
            } catch (error) {
                lastError = error;
            }
        }
        if (this._cancelReconnect) return;
        this._emit('error', toErrorPayload(lastError, 'LAN-Signaling nicht erreichbar.'));
        this._applySessionState(createInitialLobbySessionState());
        this._emit('closed', {
            reason: 'signaling_unavailable',
            error: toErrorPayload(lastError, 'LAN-Signaling nicht erreichbar.'),
        });
    }

    leave() {
        this._cancelReconnect = true;
        this._stopPolling();
        this._consecutivePollFailures = 0;

        // Notify the LAN signaling server so the player slot is freed
        if (this._signalingUrl && this._localPeerId && this.isHost) {
            try {
                fetch(`${this._signalingUrl}${SIGNALING_HTTP_ROUTES.LOBBY_LEAVE}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        playerId: 'host',
                        hostToken: this._localPeerToken,
                    }),
                }).catch((err) => { logger.debug('Host lobby reset failed:', err); });
            } catch (err) {
                logger.debug('Host lobby reset error:', err);
            }
        } else if (this._signalingUrl && this._localPeerId && !this.isHost) {
            try {
                fetch(`${this._signalingUrl}${SIGNALING_HTTP_ROUTES.LOBBY_LEAVE}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        playerId: this._localPeerId,
                        playerToken: this._localPeerToken,
                    }),
                }).catch((err) => { logger.debug('Leave notification failed:', err); });
            } catch (err) {
                logger.debug('Leave notification error:', err);
            }
        }

        this.players = [];
        this.sessionState = createInitialLobbySessionState();
        this._localPeerId = '';
        this._localPeerToken = '';
        this._lastHandledMatchCommandId = '';
        this._emit('closed', {});
    }

    async setReady(ready) {
        const res = await fetch(`${this._signalingUrl}${SIGNALING_HTTP_ROUTES.LOBBY_READY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                playerId: this._localPeerId || 'host',
                ready: ready === true,
                hostToken: this.isHost ? this._localPeerToken : undefined,
                playerToken: this.isHost ? undefined : this._localPeerToken,
            }),
        });
        if (res?.ok === false) {
            const payload = await res.json().catch(() => ({}));
            throw buildLanRequestError({
                response: res,
                payload,
                fallbackMessage: 'Ready-Status setzen fehlgeschlagen.',
                fallbackCode: 'ready_failed',
            });
        }
        const data = await res.json();
        this._processServerStatus(data);
        this._emit('readyChanged', { ready: ready === true, sessionState: this.sessionState });
        return data;
    }

    updateSettings(settings) {
        Object.assign(this.settings, settings);
        this._emit('settingsChanged', { settings: this.settings, sessionState: this.sessionState });
        if (this.isHost !== true || !settings?.metadata || !this._localPeerToken) {
            return null;
        }
        return publishLanLobbyMetadata({
            signalingUrl: this._signalingUrl,
            hostPeerId: this._localPeerId || 'host',
            hostToken: this._localPeerToken,
            metadata: settings.metadata,
        }).then((data) => {
            this._processServerStatus(data);
            return data;
        }).catch((error) => {
            logger.warn('Lobby metadata update failed:', error);
            return null;
        });
    }

    async invalidateReadyForAll() {
        const res = await fetch(`${this._signalingUrl}${SIGNALING_HTTP_ROUTES.LOBBY_INVALIDATE_READY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                hostPeerId: this._localPeerId || 'host',
                hostToken: this._localPeerToken,
            }),
        });
        if (res?.ok === false) {
            const payload = await res.json().catch(() => ({}));
            throw buildLanRequestError({
                response: res,
                payload,
                fallbackMessage: 'Ready-Invalidierung fehlgeschlagen.',
                fallbackCode: 'ready_invalidation_failed',
            });
        }
        const data = await res.json();
        this._processServerStatus(data);
        return data;
    }

    async startMatch(options = {}) {
        const settingsSnapshot = options?.settingsSnapshot ?? this.settings ?? null;
        const commandId = options?.commandId || `match-${this._lobbyRuntime.nowMs().toString(36)}-${this._lobbyRuntime.random().toString(36).slice(2, 8)}`;
        const res = await fetch(`${this._signalingUrl}${SIGNALING_HTTP_ROUTES.LOBBY_MATCH_START}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                hostPeerId: this._localPeerId || 'host',
                hostToken: this._localPeerToken,
                commandId,
                settingsSnapshot,
            }),
        });
        if (res?.ok === false) {
            const payload = await res.json().catch(() => ({}));
            throw buildLanRequestError({
                response: res,
                payload,
                fallbackMessage: 'Lobby-Matchstart fehlgeschlagen.',
                fallbackCode: 'match_start_failed',
            });
        }
        const data = await res.json();
        this._processServerStatus(data);
        return data;
    }

    getLocalPeerId() {
        return this._localPeerId;
    }

    getLocalPeerToken() {
        return this._localPeerToken;
    }

    getSignalingUrl() {
        return this._signalingUrl;
    }

    dispose() {
        this.leave();
        super.dispose();
    }
}

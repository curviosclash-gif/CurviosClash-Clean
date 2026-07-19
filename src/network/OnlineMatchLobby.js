// OnlineMatchLobby: Internet lobby via WebSocket signaling.
import { MatchLobby } from '../core/lobby/MatchLobby.js';
import {
    createInitialLobbySessionState,
    normalizeLobbySessionState,
} from './MatchLobbySessionState.js';
import {
    SIGNALING_COMMAND_TYPES,
    SIGNALING_EVENT_TYPES,
    createSignalingEnvelope,
} from '../shared/contracts/SignalingSessionContract.js';
import {
    resolveRetryDelays,
    delay,
    resolveConnectTimeoutMs,
    resolveOnlineSignalingUrl,
    buildSocketCloseDetails,
    createSocketLifecycleError,
    createInvalidSignalingPayloadError,
    createNetworkUnavailableSignalingError,
    createResumeSignalingEnvelope,
    isRetryableSignalingError,
    toErrorPayload,
} from './OnlineSignalingSupport.js';
import { routeOnlineLobbyMessage } from './OnlineMatchLobbyMessageRouter.js';

const MUTATION_ACK_TIMEOUT_MS = 3_500;

function createLobbyUsageError(code, message) {
    const error = new Error(message);
    error.code = String(code || 'lobby_usage_error');
    return error;
}

/**
 * Lobby for Internet play. Communicates with the self-hosted
 * WebSocket signaling server.
 */
export class OnlineMatchLobby extends MatchLobby {
    constructor(options = {}) {
        super('online');
        this._signalingUrl = options.signalingUrl || '';
        this._ws = null;
        this._playerId = null;
        this._sessionToken = '';
        this._lastHandledMatchCommandId = '';
        this._pendingMutationAcks = new Map();
        this._closedByClient = false;
        this._cancelReconnect = false; this._reconnectPromise = null;
        this.sessionState = createInitialLobbySessionState();
    }

    _applySessionState(nextState) {
        this.sessionState = normalizeLobbySessionState(nextState);
        this.lobbyCode = this.sessionState.lobbyCode;
        this.players = this.sessionState.players;
        this._emit('playersChanged', { players: this.players, sessionState: this.sessionState });
        this._emit('sessionStateChanged', { sessionState: this.sessionState });
    }

    _setReadyStateFor(peerId, ready) {
        const normalizedPeerId = String(peerId || '').trim();
        if (!normalizedPeerId) return;
        const nextMembers = this.sessionState.members.map((member) => (
            member.peerId === normalizedPeerId
                ? { ...member, ready: ready === true, lastSeenAt: Date.now() }
                : member
        ));
        this._applySessionState({
            ...this.sessionState,
            members: nextMembers,
            updatedAt: Date.now(),
            revision: Number(this.sessionState.revision || 0) + 1,
        });
    }

    _isSocketOpen() {
        return !!(this._ws && this._ws.readyState === WebSocket.OPEN);
    }

    _createMutationAckId(prefix = 'ack') {
        return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    _rejectAllPendingMutationAcks(error) {
        const err = error || createNetworkUnavailableSignalingError({
            signalingUrl: this._signalingUrl,
            source: 'mutation_ack',
            reason: 'socket_closed',
        });
        for (const [ackId, pending] of this._pendingMutationAcks.entries()) {
            clearTimeout(pending.timerId);
            try {
                pending.reject(err);
            } catch {
                // Ignore downstream Promise observer failures.
            }
            this._pendingMutationAcks.delete(ackId);
        }
    }

    _awaitMutationAck({ ackId, matcher, timeoutMs = MUTATION_ACK_TIMEOUT_MS } = {}) {
        return new Promise((resolve, reject) => {
            if (!ackId || typeof matcher !== 'function') {
                reject(createInvalidSignalingPayloadError({
                    reason: 'mutation_ack_invalid_registration',
                    signalingUrl: this._signalingUrl,
                }));
                return;
            }
            const timerId = setTimeout(() => {
                this._pendingMutationAcks.delete(ackId);
                reject(createNetworkUnavailableSignalingError({
                    signalingUrl: this._signalingUrl,
                    source: 'mutation_ack_timeout',
                    ackId,
                    timeoutMs,
                }));
            }, timeoutMs);
            this._pendingMutationAcks.set(ackId, {
                matcher,
                resolve,
                reject,
                timerId,
            });
        });
    }

    _resolveMatchingMutationAcks(message) {
        for (const [ackId, pending] of this._pendingMutationAcks.entries()) {
            let matches = false;
            try {
                matches = pending.matcher(message) === true;
            } catch {
                matches = false;
            }
            if (!matches) continue;
            clearTimeout(pending.timerId);
            this._pendingMutationAcks.delete(ackId);
            pending.resolve(message);
        }
    }

    _parseSocketMessage(rawData) {
        let parsedMessage;
        try {
            parsedMessage = JSON.parse(rawData);
        } catch (error) {
            throw createInvalidSignalingPayloadError({
                signalingUrl: this._signalingUrl,
                rawData: typeof rawData === 'string' ? rawData.slice(0, 256) : String(rawData || ''),
            }, error);
        }
        const normalizedType = typeof parsedMessage?.type === 'string'
            ? parsedMessage.type.trim()
            : '';
        if (!normalizedType) {
            throw createInvalidSignalingPayloadError({
                signalingUrl: this._signalingUrl,
                reason: 'missing_type',
            });
        }
        return parsedMessage;
    }

    _handleSocketClosed(event = null) {
        const reconnectContext = {
            lobbyCode: this.sessionState.lobbyCode || this.lobbyCode || '',
            playerId: this._playerId || '',
            sessionToken: this._sessionToken || '',
        };
        this._closeSocket();
        if (this._closedByClient) {
            this._closedByClient = false;
            this._rejectAllPendingMutationAcks();
            return;
        }
        const closeError = createSocketLifecycleError('close', buildSocketCloseDetails(event, this._signalingUrl));
        this._rejectAllPendingMutationAcks(closeError);
        this._emit('error', toErrorPayload(closeError));
        if (reconnectContext.lobbyCode && reconnectContext.playerId && reconnectContext.sessionToken) {
            this._scheduleReconnect(reconnectContext, closeError);
            return;
        }
        this._finalizeUnexpectedClose(closeError);
    }

    _scheduleReconnect(reconnectContext, closeError) {
        if (this._reconnectPromise) return this._reconnectPromise;
        this._cancelReconnect = false;
        this._emit('reconnecting', { sessionState: this.sessionState });
        this._reconnectPromise = this.reconnect(reconnectContext)
            .catch((error) => {
                if (!this._cancelReconnect) {
                    this._finalizeUnexpectedClose(error || closeError);
                }
            })
            .finally(() => {
                this._reconnectPromise = null;
            });
        return this._reconnectPromise;
    }

    _finalizeUnexpectedClose(error) {
        this._applySessionState(createInitialLobbySessionState());
        this._emit('closed', { reason: 'signaling_unavailable', error: toErrorPayload(error) });
    }

    _handleSocketError() {
        const socketError = createSocketLifecycleError('error', { signalingUrl: this._signalingUrl });
        this._rejectAllPendingMutationAcks(socketError);
        this._emit('error', toErrorPayload(socketError));
    }

    async _makeConnectPromise(setupFn, options = {}) {
        const timeoutMs = resolveConnectTimeoutMs(options.connectTimeoutMs);
        const retryDelays = resolveRetryDelays(options.connectRetryDelaysMs);
        const configuredAttempts = Number.isFinite(Number(options.maxConnectAttempts))
            ? Math.max(1, Math.floor(Number(options.maxConnectAttempts)))
            : 3;
        const maxAttempts = Math.min(3, configuredAttempts);
        let lastError = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            if (this._cancelReconnect) break;
            try {
                await this._makeConnectAttempt(setupFn, timeoutMs);
                return;
            } catch (err) {
                lastError = err;
                this._closeSocket();
                if (this._cancelReconnect || attempt >= maxAttempts || !isRetryableSignalingError(err)) {
                    break;
                }
                const retryDelayMs = retryDelays[Math.min(attempt - 1, retryDelays.length - 1)] || 0;
                if (retryDelayMs > 0) {
                    await delay(retryDelayMs);
                }
            }
        }

        throw lastError || createSocketLifecycleError('error', { signalingUrl: this._signalingUrl });
    }

    _makeConnectAttempt(setupFn, timeoutMs) {
        return new Promise((resolve, reject) => {
            const connectState = {
                settled: false,
                rejected: false,
            };
            const settle = (fn, arg) => {
                if (connectState.settled) return;
                connectState.settled = true;
                fn(arg);
            };

            const timer = setTimeout(
                () => settle(reject, createSocketLifecycleError('timeout', { signalingUrl: this._signalingUrl })),
                timeoutMs
            );
            const connectResolve = () => { clearTimeout(timer); settle(resolve); };
            const connectReject = (err) => {
                if (connectState.rejected) return;
                connectState.rejected = true;
                clearTimeout(timer);
                settle(reject, err);
            };

            this._ws = new WebSocket(this._signalingUrl);
            setupFn(this._ws, connectResolve, connectReject, connectState);

            this._ws.onerror = () => {
                if (!connectState.settled) {
                    connectReject(createSocketLifecycleError('error', { signalingUrl: this._signalingUrl }));
                    return;
                }
                this._handleSocketError();
            };
            this._ws.onclose = (event) => {
                if (!connectState.settled) {
                    connectReject(createSocketLifecycleError('close', buildSocketCloseDetails(event, this._signalingUrl)));
                    return;
                }
                this._handleSocketClosed(event);
            };
        });
    }

    _closeSocket() {
        if (this._ws) {
            try {
                this._ws.close();
            } catch {
                // Ignore socket close failures during retries.
            }
            this._ws = null;
        }
    }

    async create(options = {}) {
        this.isHost = true;
        this.settings = { ...options };
        this._signalingUrl = resolveOnlineSignalingUrl(options.signalingUrl, this._signalingUrl);
        this._closedByClient = false;
        this._cancelReconnect = false;

        return this._makeConnectPromise((ws, connectResolve, connectReject, connectState) => {
            ws.onopen = () => {
                this._send(createSignalingEnvelope(SIGNALING_COMMAND_TYPES.CREATE_LOBBY, {
                    maxPlayers: options.maxPlayers || 10,
                }));
            };
            ws.onmessage = (event) => {
                try {
                    const msg = this._parseSocketMessage(event.data);
                    this._handleMessage(msg, connectResolve, connectReject, connectState);
                } catch (error) {
                    const payload = toErrorPayload(error, 'Online-Signaling hat eine ungueltige Nachricht geliefert.');
                    this._emit('error', payload);
                    if (!connectState.settled) {
                        connectReject(error);
                    }
                }
            };
        }, options);
    }

    async join(lobbyCode, options = {}) {
        this.isHost = false;
        this._signalingUrl = resolveOnlineSignalingUrl(options.signalingUrl, this._signalingUrl);
        this._closedByClient = false;
        this._cancelReconnect = false;

        return this._makeConnectPromise((ws, connectResolve, connectReject, connectState) => {
            ws.onopen = () => {
                this._send(createSignalingEnvelope(SIGNALING_COMMAND_TYPES.JOIN_LOBBY, { lobbyCode }));
            };
            ws.onmessage = (event) => {
                try {
                    const msg = this._parseSocketMessage(event.data);
                    this._handleMessage(msg, connectResolve, connectReject, connectState);
                } catch (error) {
                    const payload = toErrorPayload(error, 'Online-Signaling hat eine ungueltige Nachricht geliefert.');
                    this._emit('error', payload);
                    if (!connectState.settled) {
                        connectReject(error);
                    }
                }
            };
        }, options);
    }

    async reconnect(options = {}) {
        if (options.signalingUrl) {
            this._signalingUrl = resolveOnlineSignalingUrl(options.signalingUrl, this._signalingUrl);
        }
        const lobbyCode = String(options.lobbyCode || this.sessionState.lobbyCode || this.lobbyCode || '').trim();
        const playerId = String(options.playerId || this._playerId || '').trim();
        const sessionToken = String(options.sessionToken || this._sessionToken || '').trim();
        this._closedByClient = false;

        return this._makeConnectPromise((ws, connectResolve, connectReject, connectState) => {
            ws.onopen = () => {
                if (this._cancelReconnect) {
                    ws.close();
                    return;
                }
                this._send(createResumeSignalingEnvelope({
                    lobbyCode,
                    playerId,
                    sessionToken,
                }));
            };
            ws.onmessage = (event) => {
                if (this._cancelReconnect) return;
                try {
                    const msg = this._parseSocketMessage(event.data);
                    this._handleMessage(msg, connectResolve, connectReject, connectState);
                } catch (error) {
                    const payload = toErrorPayload(error, 'Online-Signaling hat eine ungueltige Nachricht geliefert.');
                    this._emit('error', payload);
                    if (!connectState.settled) {
                        connectReject(error);
                    }
                }
            };
        }, options);
    }

    _handleMessage(msg, connectResolve, connectReject, connectState = null) {
        routeOnlineLobbyMessage(this, msg, { connectResolve, connectReject, connectState });
    }

    _send(data) {
        if (!data) return;
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            try {
                this._ws.send(JSON.stringify(data));
                return true;
            } catch {
                return false;
            }
        }
        return false;
    }

    _sendMutationWithAck({
        commandType,
        payload = {},
        timeoutMs = MUTATION_ACK_TIMEOUT_MS,
        ackMatcher = null,
    } = {}) {
        if (!this._isSocketOpen()) {
            return Promise.reject(createNetworkUnavailableSignalingError({
                signalingUrl: this._signalingUrl,
                source: 'mutation_send',
                commandType,
            }));
        }
        const ackId = this._createMutationAckId(commandType || 'mutation');
        const matcher = typeof ackMatcher === 'function' ? ackMatcher : () => false;
        const ackPromise = this._awaitMutationAck({ ackId, matcher, timeoutMs });
        const sent = this._send(createSignalingEnvelope(commandType, payload));
        if (!sent) {
            const pending = this._pendingMutationAcks.get(ackId);
            if (pending) {
                clearTimeout(pending.timerId);
                this._pendingMutationAcks.delete(ackId);
                pending.reject(createNetworkUnavailableSignalingError({
                    signalingUrl: this._signalingUrl,
                    source: 'mutation_send_failed',
                    commandType,
                }));
            }
        }
        return ackPromise;
    }

    leave() {
        this._closedByClient = true;
        this._cancelReconnect = true;
        this._send(createSignalingEnvelope(SIGNALING_COMMAND_TYPES.LEAVE));
        this._rejectAllPendingMutationAcks(createNetworkUnavailableSignalingError({
            signalingUrl: this._signalingUrl,
            source: 'manual_leave',
        }));
        if (this._ws) {
            this._ws.close();
            this._ws = null;
        }
        this.players = [];
        this.sessionState = createInitialLobbySessionState();
        this._playerId = null;
        this._sessionToken = '';
        this._lastHandledMatchCommandId = '';
        this._emit('closed', {});
    }

    async setReady(ready) {
        const expectedReady = ready === true;
        const localPeerId = String(this._playerId || '').trim();
        if (!localPeerId) {
            throw createLobbyUsageError('not_in_lobby', 'Ready-Status kann ohne aktive Lobby nicht gesetzt werden.');
        }
        return this._sendMutationWithAck({
            commandType: SIGNALING_COMMAND_TYPES.READY,
            payload: { ready: expectedReady },
            ackMatcher: (msg) => {
                if (msg?.type !== SIGNALING_EVENT_TYPES.PLAYER_READY) return false;
                const msgPeerId = String(msg.peerId || '').trim();
                if (localPeerId && msgPeerId && msgPeerId === localPeerId) {
                    return msg.ready === expectedReady;
                }
                const members = Array.isArray(msg?.sessionState?.members) ? msg.sessionState.members : [];
                const localMember = members.find((member) => String(member?.peerId || '').trim() === localPeerId);
                return localMember ? localMember.ready === expectedReady : false;
            },
        });
    }

    async invalidateReadyForAll() {
        if (this.isHost !== true) {
            throw createLobbyUsageError('host_required', 'Nur der Host darf Ready fuer alle invalidieren.');
        }
        const hasAnyClientReady = this.sessionState.members.some((member) => (
            member?.isHost !== true && member?.ready === true
        ));
        if (!hasAnyClientReady) {
            return { ok: true, skipped: true };
        }
        return this._sendMutationWithAck({
            commandType: SIGNALING_COMMAND_TYPES.INVALIDATE_READY,
            payload: {},
            ackMatcher: (msg) => {
                if (msg?.type !== SIGNALING_EVENT_TYPES.PLAYER_READY) return false;
                const members = Array.isArray(msg?.sessionState?.members) ? msg.sessionState.members : [];
                if (members.length <= 0) return false;
                return members.every((member) => (
                    member?.isHost === true || member?.ready !== true
                ));
            },
        });
    }

    updateSettings(settings) {
        Object.assign(this.settings, settings);
        this._emit('settingsChanged', { settings: this.settings, sessionState: this.sessionState });
    }

    async startMatch(options = {}) {
        if (this.isHost !== true) {
            throw createLobbyUsageError('host_required', 'Nur der Host darf das Match starten.');
        }
        const commandId = this._createMutationAckId('match');
        const pendingMatchStart = {
            commandId,
            lobbyCode: this.sessionState.lobbyCode || this.lobbyCode || '',
            hostPeerId: this.sessionState.hostPeerId || this._playerId || '',
            issuedAt: Date.now(),
            settingsSnapshot: options?.settingsSnapshot ?? this.settings ?? null,
        };
        await this._sendMutationWithAck({
            commandType: SIGNALING_COMMAND_TYPES.START_MATCH,
            payload: pendingMatchStart,
            ackMatcher: (msg) => (
                msg?.type === SIGNALING_EVENT_TYPES.MATCH_START
                && String(msg?.pendingMatchStart?.commandId || '').trim() === commandId
            ),
            timeoutMs: Math.max(MUTATION_ACK_TIMEOUT_MS, 5000),
        });
        return { pendingMatchStart };
    }

    getLocalPeerId() {
        return String(this._playerId || '').trim();
    }

    getLocalPeerToken() {
        return this._sessionToken;
    }

    dispose() {
        this.leave();
        super.dispose();
    }
}

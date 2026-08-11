import { createLobbyLifecycleEventEmitter } from './LobbyLifecycleEventEmitter.js';
import { createRuntimeClock } from '../../shared/contracts/RuntimeClockContract.js';
import { createRuntimeRng } from '../../shared/contracts/RuntimeRngContract.js';
import { resolveGlobalObject, toCallable } from './LobbyRuntimeEnvironment.js';
import { createNetworkLobbyDiscoveryPort } from './NetworkLobbyDiscoveryPort.js';
import { createNetworkLobbySessionStateProjection } from './NetworkLobbySessionStateProjection.js';
import { NetworkLobbyTransportSession } from './NetworkLobbyTransportSession.js';
import {
    createLobbyServiceDescriptor,
    LOBBY_SERVICE_EVENT_TYPES,
    LOBBY_SERVICE_TRANSPORTS,
    normalizeLobbyServiceTransport,
} from '../../shared/contracts/LobbyServiceContract.js';
import {
    deepClone,
    delay,
    normalizeLobbyCode,
    normalizeSignalingUrl,
    normalizeString,
    tryParseManualSignalingUrl,
} from './NetworkLobbyServiceSupport.js';
import {
    collectMatchingDiscoveryHosts,
    selectJoinSignalingUrlFromDiscoveredHosts,
} from './NetworkLobbyDiscoveryResolver.js';
import {
    resolveDefaultHostSignalingUrl,
    resolveDefaultJoinSignalingUrl,
} from './NetworkLobbyServiceDiscovery.js';
import {
    createPublicLobbyMetadata,
    listDiscoveredNetworkLobbies,
    resolveNetworkLobbyShareAddress,
    tryResolveNetworkLobbyUrl,
} from './NetworkLobbyExperienceSupport.js';
import {
    requestNetworkLobbyMatchStart,
    toggleNetworkLobbyReady,
} from './NetworkLobbyMutationActions.js';

const DISCOVERY_POLL_INTERVAL_MS = 250;
const DISCOVERY_MAX_WAIT_MS = 3_000;
const DISCOVERY_MAX_MATCHING_HOSTS = 8;

export class NetworkLobbyService {
    constructor(options = {}) {
        const runtimeGlobal = resolveGlobalObject(options.runtime?.global || null);
        this._runtimeGlobal = runtimeGlobal;
        this.transport = normalizeLobbyServiceTransport(options.transport, LOBBY_SERVICE_TRANSPORTS.LAN);
        this.bridgeKind = this.transport;
        this.contractVersion = normalizeString(options.contractVersion, 'lifecycle.v1');
        this.serviceDescriptor = createLobbyServiceDescriptor({
            transport: this.transport,
            providerKind: normalizeString(options.providerKind, ''),
            lifecycleContractVersion: this.contractVersion,
            supportsConnectionContext: true,
            supportsDiscovery: options.supportsDiscovery !== false,
        });
        this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
        this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : null;
        this.onStateChanged = typeof options.onStateChanged === 'function' ? options.onStateChanged : null;
        this.onMatchStart = typeof options.onMatchStart === 'function' ? options.onMatchStart : null;
        this._runtime = options.runtime && typeof options.runtime === 'object' ? options.runtime : {};
        // Gleiche Reihenfolge wie in StorageLobbyTransportRuntime: erst die Uhr aus
        // den Service-Optionen, dann die der Laufzeit, sonst die des Contracts.
        this._clock = createRuntimeClock({
            nowMs: options.now || this._runtime.now,
            runtime: runtimeGlobal,
        });
        this._rng = createRuntimeRng({ random: options.random || this._runtime.random });
        const platformBindings = options.platformBindings && typeof options.platformBindings === 'object'
            ? options.platformBindings
            : null;
        this._platformCapabilities = options.platformCapabilities && typeof options.platformCapabilities === 'object'
            ? options.platformCapabilities
            : platformBindings?.platformCapabilities || {};
        this._hostIntentBridge = options.hostIntentBridge && typeof options.hostIntentBridge === 'object'
            ? options.hostIntentBridge
            : platformBindings?.hostIntentBridge || {};
        this._resolveHostSignalingUrlImpl = typeof options.resolveHostSignalingUrl === 'function'
            ? options.resolveHostSignalingUrl
            : null;
        this._resolveJoinSignalingUrlImpl = typeof options.resolveJoinSignalingUrl === 'function'
            ? options.resolveJoinSignalingUrl
            : null;
        this._eventEmitter = createLobbyLifecycleEventEmitter({
            now: this._clock.nowMs,
        });
        this._actorId = '';
        this._participantMetadata = options.participantMetadata && typeof options.participantMetadata === 'object'
            ? { ...options.participantMetadata }
            : null;
        this._hostSettingsSnapshot = null;
        this._connectionPhase = 'idle';
        this._reconnectAttempt = 0;
        this._reconnectMaxAttempts = 0;
        this._readyMutationPending = false;
        this._matchStartPending = false;
        this._shareAddress = '';
        this._lastNotifiedMatchCommandId = '';
        this._sessionStateProjection = createNetworkLobbySessionStateProjection({
            transport: this.transport,
        });
        this._transportSession = new NetworkLobbyTransportSession({
            transport: this.transport,
            runtime: this._runtime,
            platformCapabilities: this._platformCapabilities,
            nowMs: this._clock.nowMs,
            random: this._rng.next,
            createLobby: options.createLobby,
            joinLobby: options.joinLobby,
            onSessionStateChanged: ({ sessionState, signalingUrl, localPeerId }) => {
                this._connectionPhase = 'connected';
                this._reconnectAttempt = 0;
                this._sessionStateProjection.projectLobbyState(sessionState, {
                    signalingUrl,
                    localPeerId,
                    actorId: this._actorId,
                });
                this.onStateChanged?.(this.getSessionState());
                this._notifyMatchStart(sessionState?.pendingMatchStart);
            },
            onError: (payload = null) => {
                const message = normalizeString(
                    payload?.message,
                    'Lobby-Verbindung unterbrochen.'
                );
                this._setStatus(message);
            },
            onClosed: (payload = null) => {
                this._connectionPhase = 'disconnected';
                this._sessionStateProjection.reset();
                this.onStateChanged?.(this.getSessionState());
                if (payload?.reason === 'signaling_unavailable') {
                    const reasonMessage = normalizeString(
                        payload?.error?.message,
                        'Lobby-Verbindung unterbrochen.'
                    );
                    this._setStatus(reasonMessage);
                }
            },
            onMatchStart: (pendingMatchStart) => {
                this._notifyMatchStart(pendingMatchStart);
            },
            onConnectionPhaseChanged: ({ phase, attempt = 0, maxAttempts = 0 } = {}) => {
                this._connectionPhase = normalizeString(phase, 'connected');
                this._reconnectAttempt = Math.max(0, Math.floor(Number(attempt) || 0));
                this._reconnectMaxAttempts = Math.max(0, Math.floor(Number(maxAttempts) || 0));
                this.onStateChanged?.(this.getSessionState());
            },
        });
        this._lastJoinDiscoveryIssue = null;
        this._discoveryPort = options.discoveryPort === null
            ? null
            : (options.discoveryPort && typeof options.discoveryPort === 'object'
                ? options.discoveryPort
                : createNetworkLobbyDiscoveryPort({
                    runtime: this._runtime,
                    platformBindings,
                    discoveryRuntime: options.discoveryRuntime || platformBindings?.discoveryIntentBridge || null,
                }));
    }

    _notifyMatchStart(pendingMatchStart = null) {
        const commandId = normalizeString(pendingMatchStart?.commandId, '');
        if (!commandId || commandId === this._lastNotifiedMatchCommandId) return false;
        this._lastNotifiedMatchCommandId = commandId;
        this.onMatchStart?.(deepClone(pendingMatchStart), this.getSessionState());
        return true;
    }

    _emit(eventType, payload = null) {
        return this._eventEmitter.emit(eventType, {
            contractVersion: this.contractVersion,
            payload: payload && typeof payload === 'object' ? { ...payload } : {},
            onEvent: this.onEvent,
        });
    }

    _setStatus(message) {
        if (!message) return;
        this.onStatus?.(String(message));
    }

    _fail(message, code) {
        const normalizedMessage = normalizeString(message, 'Multiplayer-Aktion fehlgeschlagen.');
        this._setStatus(normalizedMessage);
        return {
            ok: false,
            code: normalizeString(code, 'multiplayer_error'),
            message: normalizedMessage,
            sessionState: this.getSessionState(),
        };
    }

    _clearJoinDiscoveryIssue() {
        this._lastJoinDiscoveryIssue = null;
    }

    _setJoinDiscoveryIssue(code, message, details = null) {
        this._lastJoinDiscoveryIssue = {
            code: normalizeString(code, 'lobby_not_found'),
            message: normalizeString(message, 'Lobby nicht gefunden.'),
            details: details && typeof details === 'object' ? deepClone(details) : null,
        };
        return this._lastJoinDiscoveryIssue;
    }

    async _resolveDefaultHostSignalingUrl() {
        return resolveDefaultHostSignalingUrl({
            platformCapabilities: this._platformCapabilities,
            hostIntentBridge: this._hostIntentBridge,
            toCallable,
        });
    }

    async _resolveHostSignalingUrl() {
        if (this._resolveHostSignalingUrlImpl) {
            const resolved = await this._resolveHostSignalingUrlImpl({
                hostBridge: this._hostIntentBridge,
                platformCapabilities: this._platformCapabilities,
                transport: this.transport,
                normalizeSignalingUrl,
            });
            return normalizeSignalingUrl(resolved);
        }
        return this._resolveDefaultHostSignalingUrl();
    }

    async _resolveDefaultJoinSignalingUrl(lobbyCode, explicitSignalingUrl = '') {
        return resolveDefaultJoinSignalingUrl({
            lobbyCode,
            explicitSignalingUrl,
            normalizeSignalingUrl,
            normalizeLobbyCode,
            tryParseManualSignalingUrl,
            discoveryPort: this._discoveryPort,
            clearJoinDiscoveryIssue: this._clearJoinDiscoveryIssue.bind(this),
            setJoinDiscoveryIssue: this._setJoinDiscoveryIssue.bind(this),
            delay,
            collectMatchingDiscoveryHosts,
            selectJoinSignalingUrlFromDiscoveredHosts,
            runtimeGlobal: this._runtimeGlobal,
            nowMs: this._clock.nowMs,
            discoveryPollIntervalMs: DISCOVERY_POLL_INTERVAL_MS,
            discoveryMaxWaitMs: DISCOVERY_MAX_WAIT_MS,
            discoveryMaxMatchingHosts: DISCOVERY_MAX_MATCHING_HOSTS,
        });
    }

    async _resolveJoinSignalingUrl(lobbyCode, explicitSignalingUrl = '') {
        if (this._resolveJoinSignalingUrlImpl) {
            const resolved = await this._resolveJoinSignalingUrlImpl({
                lobbyCode,
                explicitSignalingUrl,
                discoveryPort: this._discoveryPort,
                transport: this.transport,
                normalizeSignalingUrl,
                tryParseManualSignalingUrl,
            });
            const normalizedResolved = normalizeSignalingUrl(resolved);
            if (normalizedResolved) {
                this._clearJoinDiscoveryIssue();
            }
            return normalizedResolved;
        }
        return this._resolveDefaultJoinSignalingUrl(lobbyCode, explicitSignalingUrl);
    }

    async host(options = {}) {
        const actorId = normalizeString(options.actorId, 'Host');
        this._actorId = actorId;
        this._connectionPhase = 'connecting';
        this._hostSettingsSnapshot = deepClone(options.settingsSnapshot ?? this._hostSettingsSnapshot);
        const resolvedUrl = await tryResolveNetworkLobbyUrl(() => this._resolveHostSignalingUrl());
        if (resolvedUrl.error) {
            this._connectionPhase = 'disconnected';
            return this._fail(
                resolvedUrl.error instanceof Error ? resolvedUrl.error.message : 'Lobby konnte nicht erstellt werden.',
                normalizeString(resolvedUrl.error?.code, 'lobby_create_failed')
            );
        }
        const signalingUrl = resolvedUrl.value;
        this._transportSession.replace(signalingUrl);

        try {
            await this._transportSession.create({
                maxPlayers: Number(options.maxPlayers || 10),
                actorId,
                name: actorId,
                metadata: createPublicLobbyMetadata(this._hostSettingsSnapshot, actorId),
            });
        } catch (error) {
            this._connectionPhase = 'disconnected';
            const message = error instanceof Error ? error.message : 'Lobby konnte nicht erstellt werden.';
            return this._fail(message, normalizeString(error?.code, 'lobby_create_failed'));
        }

        const sessionState = this.getSessionState();
        this._shareAddress = await this._resolveShareAddress(signalingUrl);
        const event = this._emit(LOBBY_SERVICE_EVENT_TYPES.HOST, {
            actorId,
            lobbyCode: sessionState.lobbyCode,
            mode: 'host',
            peerId: sessionState.peerId,
        });
        this._setStatus(`Lobby erstellt: ${sessionState.lobbyCode}`);
        return {
            ok: true,
            lobbyCode: sessionState.lobbyCode,
            event,
            sessionState,
            snapshot: this.getSnapshot(),
        };
    }

    async join(options = {}) {
        const actorId = normalizeString(options.actorId, 'Spieler');
        const requestedLobbyCode = normalizeLobbyCode(options.lobbyCode, '');
        if (!requestedLobbyCode) {
            return this._fail('Lobby-Code fehlt.', 'missing_lobby_code');
        }

        this._actorId = actorId;
        this._connectionPhase = 'connecting';
        const resolvedUrl = await tryResolveNetworkLobbyUrl(
            () => this._resolveJoinSignalingUrl(requestedLobbyCode, options.signalingUrl)
        );
        if (resolvedUrl.error) {
            this._connectionPhase = 'disconnected';
            return this._fail(
                resolvedUrl.error instanceof Error ? resolvedUrl.error.message : 'Lobby konnte nicht beigetreten werden.',
                normalizeString(resolvedUrl.error?.code, 'join_failed')
            );
        }
        const signalingUrl = resolvedUrl.value;
        if (!signalingUrl) {
            this._connectionPhase = 'disconnected';
            const issue = this._lastJoinDiscoveryIssue;
            return this._fail(
                issue?.message || `Lobby nicht gefunden: ${requestedLobbyCode}`,
                issue?.code || 'lobby_not_found'
            );
        }

        this._transportSession.replace(signalingUrl);

        try {
            await Promise.resolve(this._transportSession.join({
                signalingUrl,
                lobbyCode: requestedLobbyCode,
                actorId,
                name: actorId,
                participantMetadata: this._participantMetadata,
            }));
        } catch (error) {
            this._connectionPhase = 'disconnected';
            const message = error instanceof Error ? error.message : 'Lobby konnte nicht beigetreten werden.';
            const code = normalizeString(error?.code, 'join_failed');
            return this._fail(message, code);
        }

        const sessionState = this.getSessionState();
        const event = this._emit(LOBBY_SERVICE_EVENT_TYPES.JOIN, {
            actorId,
            lobbyCode: sessionState.lobbyCode,
            mode: 'join',
            peerId: sessionState.peerId,
        });
        this._clearJoinDiscoveryIssue();
        this._setStatus(`Lobby beigetreten: ${sessionState.lobbyCode}`);
        return {
            ok: true,
            lobbyCode: sessionState.lobbyCode,
            event,
            sessionState,
            snapshot: this.getSnapshot(),
        };
    }

    async toggleReady(options = {}) {
        return toggleNetworkLobbyReady(this, options);
    }

    invalidateReadyForAll(reason = 'host_settings_changed') {
        const sessionState = this.getSessionState();
        if (!this._transportSession.hasLobby() || !sessionState.isHost) return null;
        return Promise.resolve(this._transportSession.invalidateReadyForAll()).then(() => {
            const updatedSessionState = this.getSessionState();
            const event = this._emit(LOBBY_SERVICE_EVENT_TYPES.READY_INVALIDATED, {
                reason: normalizeString(reason, 'host_settings_changed'),
                lobbyCode: updatedSessionState.lobbyCode,
                peerId: updatedSessionState.peerId,
            });
            this._setStatus('Ready-Status zurueckgesetzt (Host-Aenderung)');
            return {
                ok: true,
                event,
                sessionState: this.getSessionState(),
                snapshot: this.getSnapshot(),
            };
        }).catch((error) => this._fail(
            error instanceof Error ? error.message : 'Ready-Invalidierung fehlgeschlagen.',
            normalizeString(error?.code, 'ready_invalidation_failed')
        ));
    }

    syncActorIdentity(actorId) {
        this._actorId = normalizeString(actorId, this._actorId);
        if (this.getSessionState().joined) {
            this._sessionStateProjection.projectLobbyState(this._transportSession.getLobbyState(), {
                signalingUrl: this._transportSession.getSignalingUrl(),
                localPeerId: this._transportSession.getLocalPeerId(),
                actorId: this._actorId,
            });
            this.onStateChanged?.(this.getSessionState());
        }
        return this.getSessionState();
    }

    publishHostSettings(settingsSnapshot) {
        this._hostSettingsSnapshot = deepClone(settingsSnapshot);
        this._transportSession.updateSettings({
            ...this._hostSettingsSnapshot,
            metadata: createPublicLobbyMetadata(this._hostSettingsSnapshot, this._actorId),
        });
        return this.getSnapshot();
    }

    requestMatchStart(options = {}) {
        return requestNetworkLobbyMatchStart(this, options);
    }

    leave(options = {}) {
        const previousState = this.getSessionState();
        this._transportSession.dispose();
        this._sessionStateProjection.reset();
        this._connectionPhase = 'idle';
        this._reconnectAttempt = 0;
        this._reconnectMaxAttempts = 0;
        this._readyMutationPending = false;
        this._matchStartPending = false;
        this._shareAddress = '';
        if (options?.silent !== true && previousState.lobbyCode) {
            this._setStatus(`Lobby verlassen: ${previousState.lobbyCode}`);
        }
        return {
            ok: true,
            previousState,
            sessionState: this.getSessionState(),
        };
    }

    getPeerId() {
        return normalizeString(this.getSessionState().peerId, '');
    }

    getSessionState() {
        return {
            ...this._sessionStateProjection.getSessionState(),
            connectionPhase: this._connectionPhase,
            reconnectAttempt: this._reconnectAttempt,
            reconnectMaxAttempts: this._reconnectMaxAttempts,
            readyMutationPending: this._readyMutationPending,
            matchStartPending: this._matchStartPending,
            shareAddress: this._shareAddress,
        };
    }

    async _resolveShareAddress(signalingUrl = '') {
        return resolveNetworkLobbyShareAddress({
            transport: this.transport,
            hostIntentBridge: this._hostIntentBridge,
            signalingUrl,
        });
    }

    async listOpenLobbies() {
        return listDiscoveredNetworkLobbies({
            discoveryPort: this._discoveryPort,
            transport: this.transport,
        });
    }

    getSnapshot() {
        return this._sessionStateProjection.getSnapshot({
            signalingUrl: this._transportSession.getSignalingUrl(),
            hostSettingsSnapshot: this._hostSettingsSnapshot,
        });
    }

    getConnectionContext() {
        return this._sessionStateProjection.getConnectionContext({
            signalingUrl: this._transportSession.getSignalingUrl(),
            peerToken: this._transportSession.getLocalPeerToken(),
        });
    }

    getEvents() {
        return this._eventEmitter.getEvents();
    }

    dispose() {
        this.leave({ silent: true });
    }
}

export class LanLobbyService extends NetworkLobbyService {
    constructor(options = {}) {
        super({
            ...options,
            transport: LOBBY_SERVICE_TRANSPORTS.LAN,
            supportsDiscovery: true,
        });
    }
}

import {
    createElectronDiscoveryIntentBridge,
    createElectronHostIntentBridge,
    getElectronPlatformCapabilitySnapshot,
} from '../../platform/electron/ElectronPlatformBridge.js';
import { createLobbyLifecycleEventEmitter } from './LobbyLifecycleEventEmitter.js';
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
        this._platformCapabilities = options.platformCapabilities && typeof options.platformCapabilities === 'object'
            ? options.platformCapabilities
            : getElectronPlatformCapabilitySnapshot(runtimeGlobal);
        this._hostIntentBridge = options.hostIntentBridge && typeof options.hostIntentBridge === 'object'
            ? options.hostIntentBridge
            : createElectronHostIntentBridge(runtimeGlobal);
        this._resolveHostSignalingUrlImpl = typeof options.resolveHostSignalingUrl === 'function'
            ? options.resolveHostSignalingUrl
            : null;
        this._resolveJoinSignalingUrlImpl = typeof options.resolveJoinSignalingUrl === 'function'
            ? options.resolveJoinSignalingUrl
            : null;
        this._eventEmitter = createLobbyLifecycleEventEmitter({
            now: () => Date.now(),
        });
        this._actorId = '';
        this._hostSettingsSnapshot = null;
        this._lastNotifiedMatchCommandId = '';
        this._sessionStateProjection = createNetworkLobbySessionStateProjection({
            transport: this.transport,
        });
        this._transportSession = new NetworkLobbyTransportSession({
            transport: this.transport,
            runtime: this._runtime,
            platformCapabilities: this._platformCapabilities,
            createLobby: options.createLobby,
            joinLobby: options.joinLobby,
            onSessionStateChanged: ({ sessionState, signalingUrl, localPeerId }) => {
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
        });
        this._lastJoinDiscoveryIssue = null;
        this._discoveryPort = options.discoveryPort === null
            ? null
            : (options.discoveryPort && typeof options.discoveryPort === 'object'
                ? options.discoveryPort
                : createNetworkLobbyDiscoveryPort({
                    runtime: this._runtime,
                    discoveryRuntime: options.discoveryRuntime || createElectronDiscoveryIntentBridge(runtimeGlobal),
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
        const signalingUrl = await this._resolveHostSignalingUrl();
        this._transportSession.replace(signalingUrl);

        try {
            await this._transportSession.create({
                maxPlayers: Number(options.maxPlayers || 10),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Lobby konnte nicht erstellt werden.';
            return this._fail(message, normalizeString(error?.code, 'lobby_create_failed'));
        }

        const sessionState = this.getSessionState();
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
        const signalingUrl = await this._resolveJoinSignalingUrl(requestedLobbyCode, options.signalingUrl);
        if (!signalingUrl) {
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
            }));
        } catch (error) {
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
        const sessionState = this.getSessionState();
        if (!this._transportSession.hasLobby() || !sessionState.joined) {
            return this._fail('Noch keiner Lobby beigetreten.', 'not_in_lobby');
        }
        if (sessionState.isHost) {
            return {
                ok: true,
                event: null,
                sessionState,
                snapshot: this.getSnapshot(),
            };
        }

        const requestedReady = typeof options.ready === 'boolean'
            ? options.ready
            : !sessionState.localReady;
        try {
            await this._transportSession.setReady(requestedReady);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Ready-Status konnte nicht gesetzt werden.';
            return this._fail(message, normalizeString(error?.code, 'ready_failed'));
        }

        const updatedSessionState = this.getSessionState();
        const event = this._emit(LOBBY_SERVICE_EVENT_TYPES.READY_TOGGLE, {
            actorId: normalizeString(options.actorId, this._actorId || 'Spieler'),
            lobbyCode: updatedSessionState.lobbyCode,
            ready: requestedReady,
            peerId: updatedSessionState.peerId,
        });
        this._setStatus(requestedReady ? 'Ready gesetzt' : 'Ready entfernt');
        return {
            ok: true,
            event,
            sessionState: this.getSessionState(),
            snapshot: this.getSnapshot(),
        };
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
        this._transportSession.updateSettings(this._hostSettingsSnapshot);
        return this.getSnapshot();
    }

    requestMatchStart(options = {}) {
        const sessionState = this.getSessionState();
        if (!this._transportSession.hasLobby() || !sessionState.joined) {
            return this._fail('Lobby fehlt.', 'not_in_lobby');
        }
        if (!sessionState.isHost) {
            return this._fail('Nur der Host kann starten.', 'host_required');
        }
        if (sessionState.memberCount < 2) {
            return this._fail('Mindestens zwei Teilnehmer werden benoetigt.', 'not_enough_members');
        }
        if (!sessionState.allReady) {
            return this._fail('Alle Teilnehmer muessen Ready sein.', 'members_not_ready');
        }

        const settingsSnapshot = deepClone(options.settingsSnapshot ?? this._hostSettingsSnapshot);
        return Promise.resolve(this._transportSession.startMatch({ settingsSnapshot })).then((response) => {
            const updatedSessionState = this.getSessionState();
            const commandId = normalizeString(
                response?.pendingMatchStart?.commandId || response?.sessionState?.pendingMatchStart?.commandId,
                ''
            );
            const event = this._emit(LOBBY_SERVICE_EVENT_TYPES.MATCH_START, {
                lobbyCode: updatedSessionState.lobbyCode,
                commandId,
                participantCount: updatedSessionState.memberCount,
                peerId: updatedSessionState.peerId,
            });
            this._setStatus(`Match-Start an Lobby gesendet: ${updatedSessionState.lobbyCode}`);
            return {
                ok: true,
                commandId,
                event,
                sessionState: this.getSessionState(),
                snapshot: this.getSnapshot(),
            };
        }).catch((error) => (
            this._fail(
                error instanceof Error ? error.message : 'Lobby-Start konnte nicht ausgeliefert werden.',
                normalizeString(error?.code, 'match_start_failed')
            )
        ));
    }

    leave(options = {}) {
        const previousState = this.getSessionState();
        this._transportSession.dispose();
        this._sessionStateProjection.reset();
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
        return this._sessionStateProjection.getSessionState();
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

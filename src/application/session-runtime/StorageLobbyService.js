import {
    LOBBY_LIFECYCLE_EVENT_CONTRACT_VERSION as MENU_LIFECYCLE_EVENT_CONTRACT_VERSION,
} from '../../shared/contracts/LobbyLifecycleEventContract.js';
import {
    hostStorageLobby,
    invalidateStorageLobbyReadyForAll,
    joinStorageLobby,
    publishStorageLobbyHostSettings,
    requestStorageLobbyMatchStart,
    toggleReadyStorageLobby,
} from './StorageLobbyMutationOps.js';
import { createLobbyLifecycleEventEmitter } from './LobbyLifecycleEventEmitter.js';
import { createStorageLobbySessionStateProjection } from './StorageLobbySessionStateProjection.js';
import { StorageLobbyTransportRuntime } from './StorageLobbyTransportRuntime.js';
import { SNAPSHOT_NOOP } from './StorageLobbySnapshotCas.js';
import {
    createLobbyServiceDescriptor,
    LOBBY_SERVICE_EVENT_TYPES,
    LOBBY_SERVICE_TRANSPORTS,
} from '../../shared/contracts/LobbyServiceContract.js';
import {
    buildRuntimeId,
    deepClone,
    deriveSessionState,
    generateLobbyCode,
    MULTIPLAYER_SESSION_SCHEMA_VERSION,
    normalizeLobbyCode,
    normalizeString,
} from './StorageLobbyServiceSupport.js';
export const MENU_MULTIPLAYER_EVENT_TYPES = LOBBY_SERVICE_EVENT_TYPES;
export class StorageLobbyService {
    constructor(options = {}) {
        this.transport = LOBBY_SERVICE_TRANSPORTS.STORAGE_BRIDGE;
        this.bridgeKind = this.transport;
        this.contractVersion = normalizeString(options.contractVersion, MENU_LIFECYCLE_EVENT_CONTRACT_VERSION);
        this.serviceDescriptor = createLobbyServiceDescriptor({
            transport: this.transport,
            providerKind: normalizeString(options.providerKind, ''),
            lifecycleContractVersion: this.contractVersion,
        });
        this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
        this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : null;
        this.onStateChanged = typeof options.onStateChanged === 'function' ? options.onStateChanged : null;
        this.onMatchStart = typeof options.onMatchStart === 'function' ? options.onMatchStart : null;

        this._transportRuntime = new StorageLobbyTransportRuntime({
            serviceOptions: options,
            getActiveLobbyCode: () => this._sessionStateProjection?.getActiveLobbyCode() || '',
            onSnapshot: (snapshot, syncOptions) => this._sessionStateProjection?.syncSnapshot(snapshot, syncOptions),
            onBeforeUnload: () => this.dispose(),
        });
        this._now = this._transportRuntime.now;
        this._random = this._transportRuntime.random;
        this._peerId = this._transportRuntime.peerId;
        this._eventEmitter = createLobbyLifecycleEventEmitter({ now: this._now });
        this._sessionStateProjection = createStorageLobbySessionStateProjection({
            peerId: this._peerId,
            now: this._now,
            startHeartbeat: () => this._transportRuntime.startHeartbeat(),
            stopHeartbeat: () => this._transportRuntime.stopHeartbeat(),
            onStateChanged: (sessionState) => this.onStateChanged?.(sessionState),
            onMatchStart: (command, sessionState) => this.onMatchStart?.(command, sessionState),
        });
    }

    get _activeLobbyCode() {
        return this._sessionStateProjection?.getActiveLobbyCode() || '';
    }

    get _sessionState() {
        return this._sessionStateProjection?.getSessionState() || null;
    }

    get _sessionSnapshot() {
        return this._sessionStateProjection?.getSnapshot() || null;
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

    _getSnapshot(lobbyCode = this._activeLobbyCode) {
        return this._transportRuntime.getSnapshot(lobbyCode);
    }

    _syncStateFromSnapshot(snapshot, options = {}) {
        return this._sessionStateProjection.syncSnapshot(snapshot, options);
    }

    _persistSnapshot(snapshot, reason, options = {}) {
        return this._transportRuntime._persistSnapshot(snapshot, reason, options);
    }

    _updateActiveSnapshot(mutator, reason, options = {}) {
        return this._transportRuntime.updateActiveSnapshot(mutator, reason, options);
    }

    _startHeartbeat() {
        return this._transportRuntime.startHeartbeat();
    }

    _stopHeartbeat() {
        return this._transportRuntime.stopHeartbeat();
    }

    _handleVisibilityChange() {
        return this._transportRuntime._handleVisibilityChange();
    }

    _handleRuntimeResume() {
        return this._transportRuntime._handleRuntimeResume();
    }

    _updateHeartbeat() {
        return this._transportRuntime._updateHeartbeat();
    }

    _schedulePendingMatchCommandClear(lobbyCode, commandId) {
        return this._transportRuntime.schedulePendingMatchCommandClear(lobbyCode, commandId);
    }

    _handleStorageEvent(event) {
        return this._transportRuntime._handleStorageEvent(event);
    }

    _handleBroadcastChannelMessage(event) {
        return this._transportRuntime._handleBroadcastChannelMessage(event);
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

    leave(options = {}) {
        const previousLobbyCode = this._activeLobbyCode;
        if (!previousLobbyCode) {
            this._syncStateFromSnapshot(null);
            return { ok: true, sessionState: this.getSessionState() };
        }

        const silent = options?.silent === true;
        const previousState = this.getSessionState();
        this._updateActiveSnapshot((snapshot) => {
            if (!snapshot) return null;
            const remainingMembers = snapshot.members.filter((member) => member.peerId !== this._peerId);
            if (remainingMembers.length === 0) {
                return null;
            }
            if (snapshot.hostPeerId === this._peerId) {
                return null;
            }
            return {
                ...snapshot,
                members: remainingMembers,
            };
        }, 'leave', {
            lobbyCode: previousLobbyCode,
            preserveLobbyCode: false,
        });
        this._syncStateFromSnapshot(null);
        if (!silent) {
            this._setStatus(`Lobby verlassen: ${previousLobbyCode}`);
        }
        return {
            ok: true,
            previousState,
            sessionState: this.getSessionState(),
        };
    }

    host(options = {}) {
        return hostStorageLobby(this, options, {
            normalizeString,
            normalizeLobbyCode,
            generateLobbyCode,
            deepClone,
            sessionSchemaVersion: MULTIPLAYER_SESSION_SCHEMA_VERSION,
            eventTypes: MENU_MULTIPLAYER_EVENT_TYPES,
        });
    }

    join(options = {}) {
        return joinStorageLobby(this, options, {
            normalizeString,
            normalizeLobbyCode,
            deepClone,
            eventTypes: MENU_MULTIPLAYER_EVENT_TYPES,
        });
    }

    toggleReady(options = {}) {
        return toggleReadyStorageLobby(this, options, {
            normalizeString,
            deepClone,
            eventTypes: MENU_MULTIPLAYER_EVENT_TYPES,
        });
    }

    invalidateReadyForAll(reason = 'host_settings_changed') {
        return invalidateStorageLobbyReadyForAll(this, reason, {
            normalizeString,
            deepClone,
            eventTypes: MENU_MULTIPLAYER_EVENT_TYPES,
        });
    }

    syncActorIdentity(actorId) {
        const normalizedActorId = normalizeString(actorId, '');
        if (!normalizedActorId || !this._activeLobbyCode) return null;

        return this._updateActiveSnapshot((snapshot) => {
            if (!snapshot) return null;
            const hasLocalMember = snapshot.members.some((member) => member.peerId === this._peerId);
            if (!hasLocalMember) return SNAPSHOT_NOOP;
            return {
                ...snapshot,
                hostActorId: snapshot.hostPeerId === this._peerId
                    ? normalizedActorId
                    : snapshot.hostActorId,
                members: snapshot.members.map((member) => (
                    member.peerId === this._peerId
                        ? {
                            ...member,
                            actorId: normalizedActorId,
                            lastSeenAt: this._now(),
                        }
                        : member
                )),
            };
        }, 'identity_sync');
    }

    publishHostSettings(settingsSnapshot) {
        return publishStorageLobbyHostSettings(this, settingsSnapshot, {
            deepClone,
        });
    }

    requestMatchStart(options = {}) {
        return requestStorageLobbyMatchStart(this, options, {
            deriveSessionState,
            buildRuntimeId,
            deepClone,
            eventTypes: MENU_MULTIPLAYER_EVENT_TYPES,
        });
    }

    getPeerId() {
        return this._peerId;
    }

    getSessionState() {
        return this._sessionStateProjection.getSessionState();
    }

    getSnapshot() {
        return this._sessionStateProjection.getSnapshot();
    }

    getConnectionContext() { return { isHost: this._sessionState.isHost === true, playerId: this._peerId, lobbyCode: this._activeLobbyCode, transport: this.transport }; }

    getEvents() {
        return this._eventEmitter.getEvents();
    }

    dispose() {
        this.leave({ silent: true });
        this._transportRuntime.dispose();
    }
}

import { createRuntimeClock } from '../../shared/contracts/RuntimeClockContract.js';
import { createRuntimeRng } from '../../shared/contracts/RuntimeRngContract.js';
import {
    createBroadcastChannelHandle,
    resolveEventTarget,
    resolveGlobalObject,
    resolveRuntimeTimer,
    resolveStorage,
} from './LobbyRuntimeEnvironment.js';
import {
    extendStorageLobbyPresenceLease,
    STORAGE_LOBBY_HEARTBEAT_INTERVAL_MS,
} from './StorageLobbyPresence.js';
import {
    acquireStorageLobbySnapshotLock,
    persistStorageLobbySnapshotWithCas,
    releaseStorageLobbySnapshotLock,
    SNAPSHOT_CAS_MAX_RETRIES,
    SNAPSHOT_NOOP,
} from './StorageLobbySnapshotCas.js';
import {
    buildRuntimeId,
    createLobbyStorageKey,
    deepClone,
    ensurePeerId,
    normalizeLobbyCode,
    normalizeSessionSnapshot,
    normalizeString,
    persistSnapshotToStorage,
    readSnapshotFromStorage,
    toTimestamp,
} from './StorageLobbyServiceSupport.js';

const MULTIPLAYER_CHANNEL_NAME = 'cuviosclash.multiplayer.v1';
const MATCH_START_CLEAR_DELAY_MS = 2500;

export class StorageLobbyTransportRuntime {
    constructor(options = {}) {
        const serviceOptions = options.serviceOptions && typeof options.serviceOptions === 'object'
            ? options.serviceOptions
            : {};
        const runtime = serviceOptions.runtime && typeof serviceOptions.runtime === 'object'
            ? serviceOptions.runtime
            : {};
        const runtimeGlobal = resolveGlobalObject(runtime.global || null);
        const runtimeClock = createRuntimeClock({
            nowMs: serviceOptions.now || runtime.now,
            runtime: runtimeGlobal,
        });
        const runtimeRng = createRuntimeRng({
            random: serviceOptions.random || runtime.random,
        });

        this.now = runtimeClock.nowMs;
        this.random = runtimeRng.next;
        this._onSnapshot = typeof options.onSnapshot === 'function' ? options.onSnapshot : () => {};
        this._getActiveLobbyCode = typeof options.getActiveLobbyCode === 'function'
            ? options.getActiveLobbyCode
            : () => '';
        this._onBeforeUnload = typeof options.onBeforeUnload === 'function' ? options.onBeforeUnload : () => {};
        this._setInterval = resolveRuntimeTimer(runtime.setInterval, runtimeGlobal, 'setInterval');
        this._clearInterval = resolveRuntimeTimer(runtime.clearInterval, runtimeGlobal, 'clearInterval');
        this._setTimeout = resolveRuntimeTimer(runtime.setTimeout, runtimeGlobal, 'setTimeout');
        this._clearTimeout = resolveRuntimeTimer(runtime.clearTimeout, runtimeGlobal, 'clearTimeout');
        this._storage = resolveStorage(serviceOptions.storage, 'localStorage', runtimeGlobal);
        const sessionStorage = resolveStorage(serviceOptions.sessionStorage, 'sessionStorage', runtimeGlobal);
        this.peerId = ensurePeerId(serviceOptions.peerId, sessionStorage, this.now, this.random);
        this._eventTarget = resolveEventTarget(runtime.eventTarget || runtimeGlobal);
        this._channel = createBroadcastChannelHandle(
            runtime.createBroadcastChannel,
            runtimeGlobal,
            MULTIPLAYER_CHANNEL_NAME
        );
        this._document = resolveEventTarget(runtime.document || runtimeGlobal?.document || null);
        this._heartbeatTimer = null;
        this._pendingMatchClearTimer = null;

        this._boundStorageHandler = (event) => this._handleStorageEvent(event);
        this._boundBeforeUnload = () => this._onBeforeUnload();
        this._boundChannelHandler = (event) => this._handleBroadcastChannelMessage(event);
        this._boundVisibilityHandler = () => this._handleVisibilityChange();
        this._boundResumeHandler = () => this._handleRuntimeResume();

        this._eventTarget?.addEventListener?.('storage', this._boundStorageHandler);
        this._eventTarget?.addEventListener?.('beforeunload', this._boundBeforeUnload);
        this._eventTarget?.addEventListener?.('focus', this._boundResumeHandler);
        this._eventTarget?.addEventListener?.('pageshow', this._boundResumeHandler);
        this._channel?.addEventListener?.('message', this._boundChannelHandler);
        this._document?.addEventListener?.('visibilitychange', this._boundVisibilityHandler);
    }

    getSnapshot(lobbyCode = this._getActiveLobbyCode()) {
        const resolvedLobbyCode = normalizeLobbyCode(lobbyCode, '');
        if (!resolvedLobbyCode) return null;
        return readSnapshotFromStorage(this._storage, resolvedLobbyCode, this.now());
    }

    _announceSnapshotChange(lobbyCode, reason, revision) {
        if (!this._channel?.postMessage) return;
        try {
            this._channel.postMessage({
                type: 'multiplayer_snapshot_changed',
                lobbyCode,
                reason: normalizeString(reason, 'updated'),
                revision: Math.max(0, Math.floor(Number(revision) || 0)),
                sourcePeerId: this.peerId,
            });
        } catch {
            // Ignore BroadcastChannel delivery failures.
        }
    }

    _persistSnapshot(snapshot, reason, options = {}) {
        const expectedRevision = Number(options?.expectedRevision);
        const baseRevision = Number.isFinite(expectedRevision)
            ? Math.max(0, Math.floor(expectedRevision))
            : Math.max(0, Math.floor(Number(snapshot?.revision) || 0));
        const nextSnapshot = snapshot ? normalizeSessionSnapshot({
            ...snapshot,
            updatedAt: this.now(),
            revision: baseRevision + 1,
        }, this.now()) : null;

        if (!nextSnapshot && options.previousLobbyCode) {
            const previousStorageKey = createLobbyStorageKey(options.previousLobbyCode);
            if (previousStorageKey) {
                try {
                    this._storage?.removeItem?.(previousStorageKey);
                } catch {
                    // Ignore localStorage cleanup failures.
                }
            }
        } else {
            persistSnapshotToStorage(this._storage, nextSnapshot);
        }
        this._onSnapshot(nextSnapshot, options);
        if (nextSnapshot?.lobbyCode) {
            this._announceSnapshotChange(nextSnapshot.lobbyCode, reason, nextSnapshot.revision);
        } else if (options.previousLobbyCode) {
            this._announceSnapshotChange(options.previousLobbyCode, reason, 0);
        }
        return nextSnapshot;
    }

    updateActiveSnapshot(mutator, reason, options = {}) {
        const activeLobbyCode = normalizeLobbyCode(options.lobbyCode || this._getActiveLobbyCode(), '');
        if (!activeLobbyCode) return null;

        for (let attempt = 0; attempt < SNAPSHOT_CAS_MAX_RETRIES; attempt += 1) {
            const lockLease = acquireStorageLobbySnapshotLock({
                storage: this._storage,
                lobbyCode: activeLobbyCode,
                peerId: this.peerId,
                nowProvider: this.now,
                randomProvider: this.random,
                buildRuntimeId,
                normalizeString,
                toTimestamp,
                createLobbyStorageKey,
            });
            if (!lockLease) continue;
            try {
                const currentSnapshot = this.getSnapshot(activeLobbyCode);
                const baseRevision = Math.max(0, Math.floor(Number(currentSnapshot?.revision) || 0));
                const nextSnapshot = mutator(currentSnapshot ? deepClone(currentSnapshot) : null, {
                    attempt,
                    baseRevision,
                });
                if (nextSnapshot === SNAPSHOT_NOOP) {
                    this._onSnapshot(currentSnapshot, {
                        preserveLobbyCode: options.preserveLobbyCode === true,
                    });
                    return currentSnapshot;
                }
                const persistResult = persistStorageLobbySnapshotWithCas({
                    normalizeLobbyCode,
                    lobbyCode: activeLobbyCode,
                    snapshot: nextSnapshot,
                    expectedRevision: baseRevision,
                    getSnapshot: (lobbyCode) => this.getSnapshot(lobbyCode),
                    persistSnapshot: (persistedSnapshot, persistOptions = {}) => this._persistSnapshot(
                        persistedSnapshot,
                        reason,
                        {
                            ...persistOptions,
                            previousLobbyCode: activeLobbyCode,
                        }
                    ),
                    preserveLobbyCode: options.preserveLobbyCode === true,
                });
                if (persistResult.ok) {
                    return persistResult.snapshot;
                }
            } finally {
                releaseStorageLobbySnapshotLock({
                    storage: this._storage,
                    lease: lockLease,
                    normalizeString,
                });
            }
        }

        const latestSnapshot = this.getSnapshot(activeLobbyCode);
        this._onSnapshot(latestSnapshot, {
            preserveLobbyCode: options.preserveLobbyCode === true,
        });
        return latestSnapshot;
    }

    startHeartbeat() {
        if (this._heartbeatTimer || typeof this._setInterval !== 'function') return;
        this._heartbeatTimer = this._setInterval(() => {
            this._updateHeartbeat();
        }, STORAGE_LOBBY_HEARTBEAT_INTERVAL_MS);
    }

    stopHeartbeat() {
        if (!this._heartbeatTimer) return;
        if (typeof this._clearInterval === 'function') {
            this._clearInterval(this._heartbeatTimer);
        }
        this._heartbeatTimer = null;
    }

    _handleVisibilityChange() {
        const visibilityState = normalizeString(this._document?.visibilityState, 'visible');
        if (visibilityState === 'hidden') {
            this._updateHeartbeat();
            return;
        }
        this._handleRuntimeResume();
    }

    _handleRuntimeResume() {
        const activeLobbyCode = this._getActiveLobbyCode();
        if (!activeLobbyCode) return;
        this._onSnapshot(this.getSnapshot(activeLobbyCode), {
            preserveLobbyCode: true,
        });
        this._updateHeartbeat();
    }

    _updateHeartbeat() {
        if (!this._getActiveLobbyCode()) return;
        this.updateActiveSnapshot((snapshot) => {
            if (!snapshot) return null;
            const now = this.now();
            const members = Array.isArray(snapshot.members) ? snapshot.members : [];
            const hasLocalMember = members.some((member) => member?.peerId === this.peerId);
            if (!hasLocalMember) return SNAPSHOT_NOOP;
            return {
                ...snapshot,
                members: members.map((member) => (
                    member?.peerId === this.peerId
                        ? extendStorageLobbyPresenceLease(member, now)
                        : member
                )),
            };
        }, 'heartbeat');
    }

    schedulePendingMatchCommandClear(lobbyCode, commandId) {
        if (this._pendingMatchClearTimer) {
            if (typeof this._clearTimeout === 'function') {
                this._clearTimeout(this._pendingMatchClearTimer);
            }
            this._pendingMatchClearTimer = null;
        }
        const clearPendingCommand = () => {
            this._pendingMatchClearTimer = null;
            this.updateActiveSnapshot((snapshot) => {
                if (!snapshot) return null;
                if (normalizeLobbyCode(snapshot.lobbyCode, '') !== normalizeLobbyCode(lobbyCode, '')) {
                    return SNAPSHOT_NOOP;
                }
                const activeCommandId = normalizeString(snapshot.pendingMatchStart?.commandId, '');
                if (activeCommandId !== normalizeString(commandId, '')) return SNAPSHOT_NOOP;
                return {
                    ...snapshot,
                    pendingMatchStart: null,
                };
            }, 'match_start_cleared');
        };

        if (typeof this._setTimeout !== 'function') {
            clearPendingCommand();
            return;
        }
        this._pendingMatchClearTimer = this._setTimeout(clearPendingCommand, MATCH_START_CLEAR_DELAY_MS);
    }

    _handleStorageEvent(event) {
        const changedKey = normalizeString(event?.key, '');
        if (!changedKey.startsWith('cuviosclash.multiplayer.lobby.')) return;
        const activeLobbyCode = this._getActiveLobbyCode();
        const activeStorageKey = createLobbyStorageKey(activeLobbyCode);
        if (!activeStorageKey || changedKey !== activeStorageKey) return;
        this._onSnapshot(this.getSnapshot(activeLobbyCode), {
            preserveLobbyCode: false,
        });
    }

    _handleBroadcastChannelMessage(event) {
        const data = event?.data && typeof event.data === 'object' ? event.data : null;
        if (!data || data.type !== 'multiplayer_snapshot_changed') return;
        const lobbyCode = normalizeLobbyCode(data.lobbyCode, '');
        if (!lobbyCode || lobbyCode !== this._getActiveLobbyCode()) return;
        const sourcePeerId = normalizeString(data.sourcePeerId, '');
        if (sourcePeerId && sourcePeerId === this.peerId) return;
        this._onSnapshot(this.getSnapshot(lobbyCode), {
            preserveLobbyCode: false,
        });
    }

    dispose() {
        this.stopHeartbeat();
        if (this._pendingMatchClearTimer) {
            if (typeof this._clearTimeout === 'function') {
                this._clearTimeout(this._pendingMatchClearTimer);
            }
            this._pendingMatchClearTimer = null;
        }
        this._eventTarget?.removeEventListener?.('storage', this._boundStorageHandler);
        this._eventTarget?.removeEventListener?.('beforeunload', this._boundBeforeUnload);
        this._eventTarget?.removeEventListener?.('focus', this._boundResumeHandler);
        this._eventTarget?.removeEventListener?.('pageshow', this._boundResumeHandler);
        this._channel?.removeEventListener?.('message', this._boundChannelHandler);
        this._document?.removeEventListener?.('visibilitychange', this._boundVisibilityHandler);
        this._channel?.close?.();
    }
}

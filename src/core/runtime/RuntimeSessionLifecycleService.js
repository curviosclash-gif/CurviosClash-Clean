// @ts-nocheck
// ============================================
// RuntimeSessionLifecycleService.js - session/network lifecycle orchestration
// ============================================

import { GAME_STATE_IDS } from '../../shared/contracts/GameStateIds.js';
import {
    RUNTIME_SESSION_TYPES,
    resolveRuntimeSessionContract,
} from '../../shared/contracts/RuntimeSessionContract.js';
import { LocalSessionAdapter } from '../session/LocalSessionAdapter.js';
import { createGameStateSnapshot } from '../GameStateSnapshot.js';
import {
    attachMultiplayerLifecycleKernel,
    detachMultiplayerLifecycleKernel,
} from './MultiplayerMatchLifecycleKernel.js';
import {
    attachNetworkPlayerDepartureHandler,
    detachNetworkPlayerDepartureHandler,
} from './NetworkPlayerDepartureOps.js';
import {
    applyRuntimeNetworkPlayerSlotContext,
    resolveRuntimeNetworkPlayerSlotContext,
} from './RuntimeNetworkPlayerSlots.js';

/** @type {number} Host broadcasts state snapshots at this interval (ms). */
const STATE_BROADCAST_INTERVAL_MS = 100; // 10/s
const STATE_UPDATE_BUFFER_LIMIT = 24;
const ROUND_START_GATE_TIMEOUT_MS = 12_000;
const ARENA_LOADED_BASE_TIMEOUT_MS = 10_000;
const ARENA_LOADED_TIMEOUT_PER_REMOTE_PLAYER_MS = 5_000;
const ARENA_LOADED_NOTIFY_RETRY_MS = 500;

function resolveHostArenaLoadedTimeoutMs(playerCount) {
    return ARENA_LOADED_BASE_TIMEOUT_MS
        + Math.max(0, playerCount - 1) * ARENA_LOADED_TIMEOUT_PER_REMOTE_PLAYER_MS;
}
// The host keeps broadcasting on its result boards: the snapshot carries the round
// result until the next round starts, so one lost snapshot no longer costs a client
// its board, and the host round serial in it is the client's round start signal.
const STATE_BROADCAST_GAME_STATES = new Set([
    GAME_STATE_IDS.PLAYING,
    GAME_STATE_IDS.ROUND_END,
    GAME_STATE_IDS.MATCH_END,
]);

function resolveSessionContract(sessionSource = null) {
    if (typeof sessionSource === 'string') {
        return resolveRuntimeSessionContract({ sessionType: sessionSource });
    }
    return resolveRuntimeSessionContract(sessionSource);
}

function createMeasuredGameStateSnapshot(facade, entityManager, roundStateController) {
    const startedAt = performance.now();
    try {
        return createGameStateSnapshot(entityManager, roundStateController);
    } finally {
        const durationMs = Math.max(0, performance.now() - startedAt);
        const metrics = facade._stateSnapshotMetrics || {
            count: 0,
            totalDurationMs: 0,
            maxDurationMs: 0,
            lastDurationMs: 0,
        };
        metrics.count += 1;
        metrics.totalDurationMs += durationMs;
        metrics.maxDurationMs = Math.max(metrics.maxDurationMs, durationMs);
        metrics.lastDurationMs = durationMs;
        facade._stateSnapshotMetrics = metrics;
    }
}

export function getRuntimeStateSnapshotMetrics(facade) {
    const metrics = facade?._stateSnapshotMetrics;
    if (!metrics) return { count: 0, totalDurationMs: 0, maxDurationMs: 0, lastDurationMs: 0 };
    return { ...metrics };
}

export async function createRuntimeSessionAdapter(sessionSource, adapterOptions = {}) {
    const sessionContract = resolveSessionContract(sessionSource);
    if (sessionContract.adapterSessionType === RUNTIME_SESSION_TYPES.LAN) {
        const { LANSessionAdapter } = await import(/* webpackChunkName: "net" */ '../../network/LANSessionAdapter.js');
        return new LANSessionAdapter(adapterOptions);
    }
    if (sessionContract.adapterSessionType === RUNTIME_SESSION_TYPES.ONLINE) {
        const { OnlineSessionAdapter } = await import(/* webpackChunkName: "net" */ '../../network/OnlineSessionAdapter.js');
        return new OnlineSessionAdapter(adapterOptions);
    }
    if (sessionContract.usesMenuStorageBridge) {
        // Storage-Bridge coordination is a menu-only transport contract, not a real runtime network adapter.
        return new LocalSessionAdapter();
    }
    return new LocalSessionAdapter();
}

function resolveRuntimeSessionConnectionContext(facade, sessionContract) {
    if (sessionContract?.sessionType !== RUNTIME_SESSION_TYPES.MULTIPLAYER) {
        return {};
    }
    const bridgeContext = facade?.menuMultiplayerBridge?.getConnectionContext?.();
    return bridgeContext && typeof bridgeContext === 'object'
        ? { ...bridgeContext }
        : {};
}

export async function initRuntimeSession(facade) {
    const game = facade?.game;
    const sessionContract = resolveSessionContract(game?.runtimeConfig?.session);

    const pendingTeardown = teardownRuntimeSession(facade);
    const initGeneration = facade._runtimeSessionGeneration;
    const isCurrentInit = () => facade?._runtimeSessionGeneration === initGeneration;
    await pendingTeardown;
    if (!isCurrentInit()) return false;
    facade._runtimeSessionContract = sessionContract;
    const connectionContext = resolveRuntimeSessionConnectionContext(facade, sessionContract);
    const session = await createRuntimeSessionAdapter(sessionContract, connectionContext);
    if (!isCurrentInit()) {
        await Promise.resolve(session?.dispose?.());
        return false;
    }
    facade.session = session;

    const numHumans = game?.runtimeConfig?.session?.numHumans || 1;
    await session.connect({
        numHumans,
        ...connectionContext,
    });
    if (!isCurrentInit() || facade.session !== session) {
        if (facade.session === session) {
            facade.session = null;
            await Promise.resolve(session.dispose?.());
        }
        return false;
    }

    if (sessionContract.isNetworkSession) {
        applyRuntimeNetworkPlayerSlotContext(facade);
        game?.entityManager?.setNetworkReplica?.(facade.session.isHost !== true);
    }

    if (facade.session.isHost && sessionContract.isNetworkSession) {
        startRuntimeStateBroadcast(facade);
        setupRuntimeHostFullStateSyncHandler(facade);
        facade._playerDepartureHandlers = attachNetworkPlayerDepartureHandler(facade);
    }

    if (!facade.session.isHost && sessionContract.isNetworkSession) {
        setupRuntimeClientStateReceiver(facade);
        facade._lifecycleKernelHandlers = attachMultiplayerLifecycleKernel(facade, facade.session);
    }
    return true;
}

export function startRuntimeStateBroadcast(facade) {
    stopRuntimeStateBroadcast(facade);
    facade._stateSnapshotMetrics = null;
    facade._stateBroadcastTimer = setInterval(() => {
        const game = facade?.game;
        if (!game?.entityManager || !STATE_BROADCAST_GAME_STATES.has(game.state)) return;
        const snapshot = createMeasuredGameStateSnapshot(facade, game.entityManager, game.roundStateController);
        facade.session?.broadcastState?.(snapshot);
    }, STATE_BROADCAST_INTERVAL_MS);
}

export function stopRuntimeStateBroadcast(facade) {
    if (facade?._stateBroadcastTimer) {
        clearInterval(facade._stateBroadcastTimer);
        facade._stateBroadcastTimer = null;
    }
}

/**
 * Host-only.  Listens for the 'fullStateSyncNeeded' event that the session adapter
 * emits when a peer reconnects after a disconnect.  Responds by immediately sending
 * the current game state snapshot to the reconnected peer so it can catch up without
 * waiting for the next scheduled broadcast tick. The adapter resolves transport and
 * target; this handler only reads game state and sends it through sendStateToPeer().
 */
export function setupRuntimeHostFullStateSyncHandler(facade) {
    if (!facade?.session?.isHost) return;
    facade._onFullStateSyncNeededHandler = (/** @type {any} */ { peerId } = {}) => {
        const normalizedPeerId = typeof peerId === 'string' ? peerId.trim() : '';
        if (!normalizedPeerId) return;
        const game = facade?.game;
        if (!game?.entityManager) return;
        try {
            const snapshot = createMeasuredGameStateSnapshot(facade, game.entityManager, game.roundStateController);
            facade.session?.sendStateToPeer?.(normalizedPeerId, snapshot);
        } catch {
            // Best-effort: the host's periodic broadcast will catch the client up on the
            // next interval even if this on-demand sync fails.
        }
    };
    facade.session.on('fullStateSyncNeeded', facade._onFullStateSyncNeededHandler);
}

export function setupRuntimeClientStateReceiver(facade) {
    if (!facade?.session) return;
    const receiverSession = facade.session;
    if (!Array.isArray(facade._pendingStateUpdates)) {
        facade._pendingStateUpdates = [];
    }
    const loadStateReconciler = typeof facade._loadStateReconciler === 'function'
        ? facade._loadStateReconciler
        : async () => {
            const { StateReconciler } = await import('../../network/StateReconciler.js');
            return new StateReconciler();
        };

    const replayBufferedStateUpdates = () => {
        if (!facade._stateReconciler) return;
        if (!Array.isArray(facade._pendingStateUpdates) || facade._pendingStateUpdates.length <= 0) return;
        const buffered = facade._pendingStateUpdates.splice(0, facade._pendingStateUpdates.length);
        for (const stateUpdate of buffered) {
            facade._stateReconciler.receiveServerState(stateUpdate);
        }
        const game = facade?.game;
        if (game?.entityManager?.players) {
            facade._stateReconciler.reconcile(game.entityManager.players, game.entityManager);
        }
    };

    // Lazy-create reconciler
    if (!facade._stateReconciler) {
        loadStateReconciler().then((stateReconciler) => {
            if (facade._disposed === true || facade?.game?._disposed === true || facade.session !== receiverSession || !facade._onStateUpdateHandler) {
                stateReconciler?.reset?.();
                return;
            }
            facade._stateReconciler = stateReconciler || null;
            replayBufferedStateUpdates();
        }).catch(() => { /* reconciler unavailable - degrade gracefully */ });
    }

    facade._onStateUpdateHandler = (serverState) => {
        if (facade._disposed === true || facade.session !== receiverSession) return;
        if (!facade._stateReconciler) {
            facade._pendingStateUpdates.push(serverState);
            if (facade._pendingStateUpdates.length > STATE_UPDATE_BUFFER_LIMIT) {
                facade._pendingStateUpdates.splice(0, facade._pendingStateUpdates.length - STATE_UPDATE_BUFFER_LIMIT);
            }
            return;
        }
        facade._stateReconciler.receiveServerState(serverState);
        const game = facade?.game;
        if (game?.entityManager?.players) {
            facade._stateReconciler.reconcile(game.entityManager.players, game.entityManager);
        }
    };
    facade.session.on('stateUpdate', facade._onStateUpdateHandler);
}

function clearRuntimeClientArenaLoadedNotifier(facade) {
    const cancelWait = facade?._cancelRuntimePlayersLoadedWait;
    if (typeof cancelWait === 'function') {
        cancelWait();
    }
    if (
        facade?._arenaLoadedNotifyInterval !== null
        && facade?._arenaLoadedNotifyInterval !== undefined
    ) {
        clearInterval(facade._arenaLoadedNotifyInterval);
        facade._arenaLoadedNotifyInterval = null;
    }
    if (
        facade?._arenaLoadedNotifyTimeout !== null
        && facade?._arenaLoadedNotifyTimeout !== undefined
    ) {
        clearTimeout(facade._arenaLoadedNotifyTimeout);
        facade._arenaLoadedNotifyTimeout = null;
    }
}

function configureFightNetworkAuthority(facade) {
    const entityManager = facade?.game?.entityManager;
    if (!entityManager || !facade?.session) return;
    entityManager.isFightOutcomeAuthority = facade.session.isHost !== false;
    entityManager.onAuthoritativeFightStateChanged = facade.session.isHost
        ? () => facade.session?.broadcastState?.(createMeasuredGameStateSnapshot(
            facade,
            entityManager,
            facade?.game?.roundStateController
        ))
        : null;
}

function clearRuntimeHostArenaLoadedWait(facade) {
    const activeWait = facade?._arenaLoadedHostWait || null;
    if (activeWait && typeof activeWait.cancel === 'function') {
        activeWait.cancel();
    }
    if (facade) {
        facade._arenaLoadedHostWait = null;
    }

    const retryTimers = Array.isArray(facade?._arenaLoadedHostRetryTimers)
        ? facade._arenaLoadedHostRetryTimers
        : [];
    for (const timerId of retryTimers) {
        clearTimeout(timerId);
    }
    retryTimers.length = 0;
}

export async function waitForRuntimePlayersLoaded(facade) {
    if (!facade?.session || facade.session instanceof LocalSessionAdapter) return;
    configureFightNetworkAuthority(facade);
    clearRuntimeHostArenaLoadedWait(facade);

    const slotContext = resolveRuntimeNetworkPlayerSlotContext(facade);
    const configuredPlayersByPeerId = new Map();
    if (Array.isArray(slotContext?.slots)) {
        for (const slot of slotContext.slots) {
            const peerId = String(slot?.ownerPeerId || slot?.peerId || '').trim();
            if (!peerId || configuredPlayersByPeerId.has(peerId)) continue;
            configuredPlayersByPeerId.set(peerId, {
                id: peerId,
                peerId,
                isHost: slot?.ownerIsHost === true || slot?.isHost === true,
            });
        }
    }
    const configuredPlayers = Array.from(configuredPlayersByPeerId.values());
    const players = configuredPlayers.length > 0
        ? configuredPlayers
        : (Array.isArray(facade.session.getPlayers?.()) ? facade.session.getPlayers() : []);
    if (players.length <= 1) return;

    const localPlayerId = String(facade.session.localPlayerId || '').trim();
    if (localPlayerId) {
        facade._arenaLoadedPeers.add(localPlayerId);
    }

    // Client reports readiness first, then waits for the host's authoritative gate.
    if (!facade.session.isHost) {
        clearRuntimeClientArenaLoadedNotifier(facade);
        const clientSession = facade.session;
        return new Promise((resolve, reject) => {
            let completed = false;
            let wait = null;
            const cleanup = () => {
                if (facade._arenaLoadedNotifyInterval != null) clearInterval(facade._arenaLoadedNotifyInterval);
                if (facade._arenaLoadedNotifyTimeout != null) clearTimeout(facade._arenaLoadedNotifyTimeout);
                facade._arenaLoadedNotifyInterval = facade._arenaLoadedNotifyTimeout = null;
                clientSession.off('roundStartGate', onRoundStartGate);
                if (facade._onRoundStartGateHandler === onRoundStartGate) facade._onRoundStartGateHandler = null;
                if (facade._arenaLoadedClientWait === wait) facade._arenaLoadedClientWait = null;
                if (facade._cancelRuntimePlayersLoadedWait === cancelWait) facade._cancelRuntimePlayersLoadedWait = null;
            };
            const finish = (result, error = null) => {
                if (completed) return;
                completed = true;
                cleanup();
                if (error) reject(error);
                else resolve(result);
            };
            const cancelWait = () => finish(false);
            const onRoundStartGate = (payload) => {
                if (facade.session !== clientSession || facade._arenaLoadedClientWait !== wait) return finish(false);
                const expectedPeerIds = payload?.expectedPeerIds;
                if (
                    !Array.isArray(expectedPeerIds)
                    || !expectedPeerIds.includes(localPlayerId)
                    || !Number.isFinite(payload?.timestamp)
                    || payload.timestamp <= 0
                ) return;
                finish(true);
            };
            const notifyArenaLoaded = () => {
                if (facade.session !== clientSession || facade._arenaLoadedClientWait !== wait) return finish(false);
                try { clientSession.notifyArenaLoaded?.(localPlayerId); }
                catch (error) { finish(false, error); }
            };
            facade._arenaLoadedClientWait = wait = { cancel: cancelWait, session: clientSession };
            facade._cancelRuntimePlayersLoadedWait = cancelWait;
            facade._onRoundStartGateHandler = onRoundStartGate;
            clientSession.on('roundStartGate', onRoundStartGate);
            facade._arenaLoadedNotifyInterval = setInterval(notifyArenaLoaded, ARENA_LOADED_NOTIFY_RETRY_MS);
            facade._arenaLoadedNotifyTimeout = setTimeout(
                () => finish(false, new Error('Timed out waiting for host ROUND_START_GATE')),
                // The host may wait this long for the slowest peer; the extra window covers its own load lag.
                resolveHostArenaLoadedTimeoutMs(players.length) + ROUND_START_GATE_TIMEOUT_MS
            );
            notifyArenaLoaded();
        });
    }

    const hostSession = facade.session;

    // ── Host path ──────────────────────────────────────────────────────────────
    // Host waits for all remote peers to send PLAYER_ARENA_LOADED (surfaced as
    // 'playerLoaded' events by the adapter).  Once all peers have confirmed,
    // the host broadcasts ROUND_START_GATE — a host-authoritative transport
    // signal that instructs every client to begin arena simulation.
    const expectedPeerIds = new Set(
        players
            .map((player) => String(player?.peerId || player?.id || '').trim())
            .filter(Boolean)
    );
    if (localPlayerId) {
        expectedPeerIds.add(localPlayerId);
    }

    return new Promise((resolve) => {
        let completed = false;
        let timeoutId = null;

        const detachPlayerLoadedHandler = () => {
            if (!facade._onPlayerLoadedHandler) return;
            hostSession?.off?.('playerLoaded', facade._onPlayerLoadedHandler);
            facade._onPlayerLoadedHandler = null;
        };

        const cancel = () => {
            if (completed) return;
            completed = true;
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            detachPlayerLoadedHandler();
            resolve();
        };
        facade._arenaLoadedHostWait = { cancel, session: hostSession };

        const finish = () => {
            if (completed) return;
            completed = true;
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            try {
                // Broadcast the host-authoritative ROUND_START_GATE signal to all clients.
                const payload = {
                    expectedPeerIds: Array.from(expectedPeerIds.values()),
                    timestamp: Date.now(),
                };
                if (facade.session !== hostSession) {
                    detachPlayerLoadedHandler();
                    if (facade._arenaLoadedHostWait?.session === hostSession) {
                        facade._arenaLoadedHostWait = null;
                    }
                    resolve();
                    return;
                }
                hostSession.broadcastRoundStartGate?.(payload);
                const retryTimers = [];
                facade._arenaLoadedHostRetryTimers = retryTimers;
                for (let attempt = 1; attempt <= 4; attempt += 1) {
                    const timerId = setTimeout(() => {
                        if (facade.session === hostSession) {
                            hostSession.broadcastRoundStartGate?.({
                                ...payload,
                                timestamp: Date.now(),
                                retry: attempt,
                            });
                        }
                        if (attempt === 4 && facade._arenaLoadedHostRetryTimers === retryTimers) {
                            retryTimers.length = 0;
                        }
                    }, attempt * 350);
                    retryTimers.push(timerId);
                }
            } catch {
                // Best-effort: even if broadcast fails, local host resolves and starts.
            }
            detachPlayerLoadedHandler();
            if (facade._arenaLoadedHostWait?.session === hostSession) {
                facade._arenaLoadedHostWait = null;
            }
            resolve();
        };

        const hasAllPlayersLoaded = () => {
            for (const peerId of expectedPeerIds.values()) {
                if (!facade._arenaLoadedPeers.has(peerId)) return false;
            }
            return true;
        };

        facade._onPlayerLoadedHandler = (data) => {
            const playerId = String(data?.playerId || '').trim();
            if (playerId) {
                facade._arenaLoadedPeers.add(playerId);
            }
            if (hasAllPlayersLoaded()) {
                finish();
            }
        };
        hostSession.on('playerLoaded', facade._onPlayerLoadedHandler);

        if (hasAllPlayersLoaded()) {
            finish();
            return;
        }

        timeoutId = setTimeout(() => finish(), resolveHostArenaLoadedTimeoutMs(expectedPeerIds.size));
    });
}

export function teardownRuntimeSession(facade) {
    if (facade) {
        facade._runtimeSessionGeneration = (Number(facade._runtimeSessionGeneration) || 0) + 1;
    }
    if (facade?.game?.entityManager) {
        facade.game.entityManager.isFightOutcomeAuthority = true;
        facade.game.entityManager.onAuthoritativeFightStateChanged = null;
        facade.game.entityManager.setNetworkReplica?.(false);
    }
    stopRuntimeStateBroadcast(facade);
    clearRuntimeClientArenaLoadedNotifier(facade);
    clearRuntimeHostArenaLoadedWait(facade);
    if (facade?._onStateUpdateHandler && facade.session) {
        facade.session.off('stateUpdate', facade._onStateUpdateHandler);
        facade._onStateUpdateHandler = null;
    }
    if (facade?._onPlayerLoadedHandler && facade.session) {
        facade.session.off('playerLoaded', facade._onPlayerLoadedHandler);
        facade._onPlayerLoadedHandler = null;
    }
    if (facade?._onRoundStartGateHandler && facade.session) {
        facade.session.off('roundStartGate', facade._onRoundStartGateHandler);
        facade._onRoundStartGateHandler = null;
    }
    if (facade?._onFullStateSyncNeededHandler && facade.session) {
        facade.session.off('fullStateSyncNeeded', facade._onFullStateSyncNeededHandler);
        facade._onFullStateSyncNeededHandler = null;
    }
    if (facade?._lifecycleKernelHandlers && facade.session) {
        detachMultiplayerLifecycleKernel(facade.session, facade._lifecycleKernelHandlers);
    }
    if (facade?._playerDepartureHandlers && facade.session) {
        detachNetworkPlayerDepartureHandler(facade.session, facade._playerDepartureHandlers);
    }
    if (facade) {
        facade._lifecycleKernelHandlers = null;
        facade._playerDepartureHandlers = null;
    }
    facade?._arenaLoadedPeers?.clear?.();
    if (Array.isArray(facade?._pendingStateUpdates)) {
        facade._pendingStateUpdates.length = 0;
    }
    if (facade?.session) {
        const session = facade.session;
        facade.session = null;
        const disposePromise = Promise.resolve(session.dispose?.());
        const trackedTeardown = disposePromise.finally(() => {
            if (facade?._pendingRuntimeSessionTeardown === trackedTeardown) {
                facade._pendingRuntimeSessionTeardown = null;
            }
        });
        facade._pendingRuntimeSessionTeardown = trackedTeardown;
    }
    if (facade) {
        facade._runtimeSessionContract = null;
        facade._stateSnapshotMetrics = null;
    }
    facade?._stateReconciler?.reset?.();
    facade?._resetArcadeRunState?.();
    return facade?._pendingRuntimeSessionTeardown || undefined;
}

function getRuntimePorts(game) {
    return game?.runtimeBundle?.ports || game?.runtimePorts || null;
}

function getTransitionArcadePort(game) {
    return getRuntimePorts(game)?.arcadePort || null;
}

function getTransitionRecordingPort(game) {
    return getRuntimePorts(game)?.recordingPort || null;
}

function getTransitionLifecyclePort(game) {
    return getRuntimePorts(game)?.lifecyclePort || null;
}

function getTransitionUiFeedbackPort(game) {
    return getRuntimePorts(game)?.uiFeedbackPort || null;
}

function getTransitionRuntimeProjectionPort(game) {
    return getRuntimePorts(game)?.runtimeProjectionPort || null;
}

function getLegacyRoundRecorder(game) {
    return game?.recorder || null;
}

function resolveGhostRouteContext(game) {
    const explicitRouteId = String(game?.arena?.currentMapDefinition?.parcours?.routeId || '').trim();
    const runtimeRouteId = String(game?.arena?.runtimeMapDefinition?.parcours?.routeId || '').trim();
    const fallbackMapKeys = [
        game?.arena?.currentMapKey,
        game?.runtimeConfig?.session?.mapKey,
        game?.settings?.mapKey,
        game?.mapKey,
    ];
    const routeAliases = [];
    const seen = new Set();
    const pushCandidate = (value) => {
        const candidate = String(value || '').trim();
        if (!candidate || seen.has(candidate)) return;
        seen.add(candidate);
        routeAliases.push(candidate);
    };
    pushCandidate(explicitRouteId);
    pushCandidate(runtimeRouteId);
    for (let i = 0; i < fallbackMapKeys.length; i += 1) {
        pushCandidate(fallbackMapKeys[i]);
    }
    return {
        routeId: routeAliases[0] || '',
        routeAliases,
    };
}

function resolveTransitionSessionSnapshot(game) {
    const runtimeProjectionPort = getTransitionRuntimeProjectionPort(game);
    const snapshot = runtimeProjectionPort?.getSessionRuntimeSnapshot?.();
    if (snapshot) {
        return snapshot;
    }
    const runtimeProjection = runtimeProjectionPort?.getMatchRuntimeProjection?.() || null;
    return {
        isNetworkSession: runtimeProjection?.isNetworkSession === true,
        isHost: true,
    };
}

function createTransitionArcadeAdapter(game) {
    const arcadePort = getTransitionArcadePort(game);
    return {
        getMenuSurfaceState() {
            return arcadePort?.getMenuSurfaceState?.() ?? null;
        },
        selectIntermissionChoice(choiceId) {
            return arcadePort?.selectIntermissionChoice?.(choiceId);
        },
        selectReward(rewardId) {
            return arcadePort?.selectReward?.(rewardId);
        },
        requestReplayPlayback() {
            return arcadePort?.requestReplayPlayback?.();
        },
    };
}

function createTransitionRecordingAdapter(game) {
    const recordingPort = getTransitionRecordingPort(game);
    const recorder = getLegacyRoundRecorder(game);
    return {
        finalizeRound(winner, players, options = undefined) {
            return recordingPort?.finalizeRound?.(winner, players, options)
                ?? recorder?.finalizeRound?.(winner, players, options);
        },
        dump() {
            return recordingPort?.dump?.()
                ?? recorder?.dump?.();
        },
        getLastRoundMetrics() {
            return recordingPort?.getLastRoundMetrics?.()
                ?? recorder?.getLastRoundMetrics?.()
                ?? null;
        },
        getAggregateMetrics() {
            return recordingPort?.getAggregateMetrics?.()
                ?? recorder?.getAggregateMetrics?.()
                ?? null;
        },
        getLastRoundGhostClip(players, options = undefined) {
            return recordingPort?.getLastRoundGhostClip?.(players, options)
                ?? recorder?.getLastRoundGhostClip?.(players, options)
                ?? null;
        },
        recordRoundEndTelemetry(payload = null) {
            return recordingPort?.recordRoundEndTelemetry?.(payload);
        },
        recordMatchEndTelemetry(payload = null) {
            return recordingPort?.recordMatchEndTelemetry?.(payload);
        },
    };
}

function createTransitionSessionAdapter(game) {
    const lifecyclePort = getTransitionLifecyclePort(game);
    const uiFeedbackPort = getTransitionUiFeedbackPort(game);
    const recordingAdapter = createTransitionRecordingAdapter(game);
    return {
        initializeSession() {
            return lifecyclePort?.initializeSession?.();
        },
        waitForAllPlayersLoaded() {
            return lifecyclePort?.waitForAllPlayersLoaded?.();
        },
        startArcadeRunIfEnabled() {
            return lifecyclePort?.startArcadeRunIfEnabled?.();
        },
        recordRoundEndTelemetry(payload = null) {
            return recordingAdapter.recordRoundEndTelemetry(payload);
        },
        recordMatchEndTelemetry(payload = null) {
            return recordingAdapter.recordMatchEndTelemetry(payload);
        },
        getSessionRuntimeSnapshot() {
            return resolveTransitionSessionSnapshot(game);
        },
        syncP2HudVisibility(isVisible) {
            const p2Hud = game?.ui?.p2Hud;
            if (p2Hud?.classList?.toggle) {
                p2Hud.classList.toggle('hidden', !isVisible);
                return;
            }
            uiFeedbackPort?.toggleP2Hud?.(isVisible);
        },
    };
}

export function getArcadeMenuSurfaceState(runtimePort, game) {
    return runtimePort?.getArcadeMenuSurfaceState?.()
        ?? createTransitionArcadeAdapter(game).getMenuSurfaceState();
}

export function selectArcadeIntermissionChoice(runtimePort, game, choiceId) {
    return runtimePort?.selectArcadeIntermissionChoice?.(choiceId)
        ?? createTransitionArcadeAdapter(game).selectIntermissionChoice(choiceId);
}

export function selectArcadeReward(runtimePort, game, rewardId) {
    return runtimePort?.selectArcadeReward?.(rewardId)
        ?? createTransitionArcadeAdapter(game).selectReward(rewardId);
}

export function requestArcadeReplayPlayback(runtimePort, game) {
    const replayResult = runtimePort?.requestArcadeReplayPlayback?.()
        ?? createTransitionArcadeAdapter(game).requestReplayPlayback();
    const replayCode = String(replayResult?.code || '').trim();
    if (
        replayResult?.ok === true
        || (replayCode !== 'replay_player_unavailable' && replayCode !== 'replay_unavailable')
    ) {
        return replayResult;
    }
    if (typeof runtimePort?.applyArcadeParcoursEvent !== 'function') {
        return replayResult;
    }
    const routeContext = resolveGhostRouteContext(game);
    if (!routeContext.routeId) {
        return replayResult;
    }
    const ghostResult = runtimePort.applyArcadeParcoursEvent({
        type: 'ghost_start',
        routeId: routeContext.routeId,
        routeAliases: routeContext.routeAliases,
        source: 'menu_replay_fallback',
    });
    if (ghostResult?.started === true) {
        return {
            ok: true,
            code: 'ghost_fallback_started',
            replayResult,
            ghostResult,
            routeId: String(ghostResult.routeId || routeContext.routeId || ''),
        };
    }
    return {
        ...(replayResult && typeof replayResult === 'object' ? replayResult : {}),
        ok: false,
        code: String(ghostResult?.reason || replayCode || 'replay_unavailable'),
        replayResult,
        ghostResult,
    };
}

export function getLastRoundRecordingMetrics(runtimePort, game, roundEndPlan) {
    return roundEndPlan?.recording?.roundMetrics
        || runtimePort?.getLastRoundRecordingMetrics?.()
        || createTransitionRecordingAdapter(game).getLastRoundMetrics()
        || null;
}

export function getLastRoundGhostClip(runtimePort, game, options = undefined) {
    return runtimePort?.getLastRoundGhostClip?.(game?.entityManager?.players, options)
        ?? createTransitionRecordingAdapter(game).getLastRoundGhostClip(game?.entityManager?.players, options);
}

export function createRoundEndRecorderAdapter(runtimePort, game) {
    const adapter = {};
    if (typeof runtimePort?.finalizeRoundRecording === 'function') {
        adapter.finalizeRound = (winner, players, options = undefined) => runtimePort.finalizeRoundRecording(winner, players, options);
    }
    if (typeof runtimePort?.dumpRoundRecording === 'function') {
        adapter.dump = () => runtimePort.dumpRoundRecording();
    }
    if (typeof runtimePort?.getLastRoundRecordingMetrics === 'function') {
        adapter.getLastRoundMetrics = () => runtimePort.getLastRoundRecordingMetrics();
    }
    if (typeof runtimePort?.getAggregateRecordingMetrics === 'function') {
        adapter.getAggregateMetrics = () => runtimePort.getAggregateRecordingMetrics();
    }
    if (typeof runtimePort?.getLastRoundGhostClip === 'function') {
        adapter.getLastRoundGhostClip = (players, options = undefined) => runtimePort.getLastRoundGhostClip(players, options);
    }
    return Object.keys(adapter).length > 0 ? adapter : createTransitionRecordingAdapter(game);
}

export function initializeMatchSession(runtimePort, game) {
    return runtimePort?.initializeSession?.()
        ?? createTransitionSessionAdapter(game).initializeSession();
}

export function waitForMatchPlayersLoaded(runtimePort, game) {
    return runtimePort?.waitForAllPlayersLoaded?.()
        ?? createTransitionSessionAdapter(game).waitForAllPlayersLoaded();
}

export function startArcadeRunIfEnabled(runtimePort, game) {
    return runtimePort?.startArcadeRunIfEnabled?.()
        ?? createTransitionSessionAdapter(game).startArcadeRunIfEnabled();
}

export function recordRoundEndTelemetry(runtimePort, game, payload = null) {
    return runtimePort?.recordRoundEndTelemetry?.(payload)
        ?? createTransitionSessionAdapter(game).recordRoundEndTelemetry(payload);
}

export function recordMatchEndTelemetry(runtimePort, game, payload = null) {
    return runtimePort?.recordMatchEndTelemetry?.(payload)
        ?? createTransitionSessionAdapter(game).recordMatchEndTelemetry(payload);
}

export function getMatchSessionAccessSnapshot(runtimePort, game) {
    return runtimePort?.getSessionRuntimeSnapshot?.()
        ?? createTransitionSessionAdapter(game).getSessionRuntimeSnapshot();
}

export function syncMatchP2HudVisibility(runtimePort, game, isVisible) {
    if (typeof runtimePort?.toggleP2Hud === 'function') {
        runtimePort.toggleP2Hud(isVisible);
        return;
    }
    createTransitionSessionAdapter(game).syncP2HudVisibility(isVisible);
}

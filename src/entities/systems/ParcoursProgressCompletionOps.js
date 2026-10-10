import { formatDurationMs } from './ParcoursProgressUtils.js';

export function completeParcours(system, player, state, now) {
    if (!system._route || !state || state.completed) return;
    state.completed = true;
    state.completedAtMs = now;
    const baseTimeMs = Math.max(0, now - (state.startedAtMs || now));
    const penaltyTimeMs = Math.max(0, Math.trunc(Number(state.penaltyTimeMs) || 0));
    state.completionTimeMs = baseTimeMs + penaltyTimeMs;
    state.nextCheckpointIndex = system._route.totalCheckpoints;
    state.lastCheckpointAtMs = now;
    state.lastError = '';
    state.errorUntilMs = 0;

    const arcadeRacer = player?.isArcadeParcoursCompetitor === true;
    if (!arcadeRacer && !system._completionOrder.some((entry) => entry.playerIndex === player.index)) {
        system._completionOrder.push({
            playerIndex: player.index,
            completedAtMs: state.completedAtMs,
            completionTimeMs: state.completionTimeMs,
            penaltyTimeMs,
        });
        system._completionOrder.sort((left, right) => {
            if (left.completedAtMs !== right.completedAtMs) {
                return left.completedAtMs - right.completedAtMs;
            }
            return left.playerIndex - right.playerIndex;
        });
    }

    system._notifyPlayer(player, `Parcours abgeschlossen (${formatDurationMs(state.completionTimeMs)})`);
    system._logRecorderEvent(
        'PARCOURS_COMPLETE',
        player,
        `route=${system._route.routeId} timeMs=${Math.round(state.completionTimeMs)} penaltyMs=${penaltyTimeMs}`
    );
    system._playProgressAudio('PARCOURS_FINISH', player, { intensity: 1.15 });
    if (arcadeRacer) return;
    const finishXpResult = system._xpEventCallback?.('finish', player.index, { finishedAtMs: now });
    if (finishXpResult?.earned > 0) {
        system._notifyPlayer(player, `+${finishXpResult.earned} XP (Parcours)`);
    }
    const shouldFinalizeGhost = system._route.rules.showGhost && player?.isBot !== true;
    const recorderOwnedByPlayer = system._playerOwnsGhostRecording(player);
    const ghostClip = shouldFinalizeGhost && recorderOwnedByPlayer
        ? (system._ghostRecorder?.stopRecording?.(player.index) || null)
        : null;
    const ghostDurationMsFromClip = Math.max(0, Math.round(Number(ghostClip?.sourceDuration) * 1000));
    system._leaderboardCallback?.({
        type: 'finish',
        playerIndex: player.index,
        routeId: system._route.routeId,
        totalTimeMs: state.completionTimeMs,
        penaltyTimeMs,
        segmentSplitsMs: [...state.segmentSplitsMs],
        ghostDurationMs: ghostDurationMsFromClip > 0 ? ghostDurationMsFromClip : baseTimeMs,
        ghostClip,
    });
}

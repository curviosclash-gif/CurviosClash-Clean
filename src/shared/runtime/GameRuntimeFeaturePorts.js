export function createArcadePort({ getRuntimeCoordinator, getRuntimeFacade }) {
    return {
        getMenuSurfaceState() {
            return getRuntimeCoordinator()?.getArcadeMenuSurfaceState?.()
                ?? getRuntimeFacade()?.getArcadeMenuSurfaceState?.();
        },
        tickSuddenDeath(dt) {
            return getRuntimeCoordinator()?.tickArcadeSuddenDeath?.(dt)
                ?? getRuntimeFacade()?.tickArcadeSuddenDeath?.(dt);
        },
        selectIntermissionChoice(choiceId) {
            return getRuntimeCoordinator()?.selectArcadeIntermissionChoice?.(choiceId)
                ?? getRuntimeFacade()?.selectArcadeIntermissionChoice?.(choiceId);
        },
        selectReward(rewardId) {
            return getRuntimeCoordinator()?.selectArcadeReward?.(rewardId)
                ?? getRuntimeFacade()?.selectArcadeReward?.(rewardId);
        },
        requestReplayPlayback() {
            return getRuntimeCoordinator()?.requestArcadeReplayPlayback?.()
                ?? getRuntimeFacade()?.requestArcadeReplayPlayback?.();
        },
        applyParcoursEvent(data = null) {
            return getRuntimeCoordinator()?.applyArcadeParcoursEvent?.(data)
                ?? getRuntimeFacade()?.applyArcadeParcoursEvent?.(data);
        },
        applyPendingIntermissionEffects(players = []) {
            const safePlayers = Array.isArray(players) ? players : [];
            return getRuntimeFacade()?.arcadeRunRuntime?.applyPendingIntermissionEffects?.({
                players: safePlayers,
            });
        },
    };
}

export function createRecordingPort({ getRuntimeCoordinator, getRuntimeFacade }) {
    return {
        toggleCinematicRecordingFromHotkey() {
            return getRuntimeCoordinator()?.toggleCinematicRecordingFromHotkey?.()
                ?? getRuntimeFacade()?.toggleCinematicRecordingFromHotkey?.();
        },
        finalizeRound(winner, players, options = undefined) {
            return getRuntimeCoordinator()?.finalizeRoundRecording?.(winner, players, options)
                ?? getRuntimeFacade()?.finalizeRoundRecording?.(winner, players, options);
        },
        dump() {
            return getRuntimeCoordinator()?.dumpRoundRecording?.()
                ?? getRuntimeFacade()?.dumpRoundRecording?.();
        },
        getLastRoundMetrics() {
            return getRuntimeCoordinator()?.getLastRoundRecordingMetrics?.()
                ?? getRuntimeFacade()?.getLastRoundRecordingMetrics?.()
                ?? null;
        },
        getAggregateMetrics() {
            return getRuntimeCoordinator()?.getAggregateRecordingMetrics?.()
                ?? getRuntimeFacade()?.getAggregateRecordingMetrics?.()
                ?? null;
        },
        getLastRoundGhostClip(players, options = undefined) {
            return getRuntimeCoordinator()?.getLastRoundGhostClip?.(players, options)
                ?? getRuntimeFacade()?.getLastRoundGhostClip?.(players, options)
                ?? null;
        },
        recordRoundEndTelemetry(payload = null) {
            return getRuntimeCoordinator()?.recordRoundEndTelemetry?.(payload)
                ?? getRuntimeFacade()?.recordRoundEndTelemetry?.(payload);
        },
        recordMatchEndTelemetry(payload = null) {
            return getRuntimeCoordinator()?.recordMatchEndTelemetry?.(payload)
                ?? getRuntimeFacade()?.recordMatchEndTelemetry?.(payload);
        },
    };
}

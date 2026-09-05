import { resolveExpectedCheckpointEntries } from './ParcoursProgressUtils.js';

export function createPlayerProgressSnapshot(route, state, now) {
    const hasError = state.errorUntilMs > now && !!state.lastError;
    const segmentAnchor = state.lastCheckpointAtMs || state.startedAtMs || 0;
    const segmentElapsedMs = state.completed || segmentAnchor <= 0
        ? 0
        : Math.max(0, now - segmentAnchor);
    const expectedEntries = !state.completed
        ? resolveExpectedCheckpointEntries(route, state)
        : [];
    const passedCheckpointIds = state.stageCheckpointIds.filter((checkpointId) => (
        typeof checkpointId === 'string' && checkpointId.trim().length > 0
    ));
    return {
        routeId: route.routeId,
        totalCheckpoints: route.totalCheckpoints,
        nextCheckpointIndex: state.nextCheckpointIndex,
        passedMask: Array.from(state.passedMask),
        passedCheckpointIds,
        expectedCheckpointIds: expectedEntries.map((entry) => entry.id),
        expectedCheckpointLabels: expectedEntries
            .map((entry) => String(entry.params?.label || '').trim())
            .filter(Boolean),
        startedAtMs: state.startedAtMs,
        lastCheckpointAtMs: state.lastCheckpointAtMs,
        wrongOrderCount: state.wrongOrderCount,
        penaltyTimeMs: Math.max(0, Math.trunc(Number(state.penaltyTimeMs) || 0)),
        resetCount: state.resetCount,
        checkpointRespawnsUsed: Math.max(0, Math.trunc(Number(state.checkpointRespawnsUsed) || 0)),
        completed: state.completed,
        completedAtMs: state.completedAtMs,
        completionTimeMs: state.completionTimeMs,
        lastCheckpointId: state.lastCheckpointId,
        hasError,
        errorMessage: hasError ? state.lastError : '',
        segmentElapsedMs,
    };
}

export function createPlayerHudState(snapshot) {
    return {
        enabled: true,
        routeId: snapshot.routeId,
        totalCheckpoints: snapshot.totalCheckpoints,
        currentCheckpoint: snapshot.completed
            ? snapshot.totalCheckpoints
            : Math.max(0, Math.min(snapshot.totalCheckpoints, snapshot.nextCheckpointIndex)),
        completed: snapshot.completed,
        completionTimeMs: snapshot.completionTimeMs,
        penaltyTimeMs: snapshot.penaltyTimeMs,
        segmentElapsedMs: snapshot.segmentElapsedMs,
        passedCheckpointIds: [...snapshot.passedCheckpointIds],
        expectedCheckpointLabels: [...(snapshot.expectedCheckpointLabels || [])],
        hasError: snapshot.hasError,
        errorMessage: snapshot.errorMessage,
        wrongOrderCount: snapshot.wrongOrderCount,
        resetCount: snapshot.resetCount,
        checkpointRespawnsUsed: snapshot.checkpointRespawnsUsed,
    };
}

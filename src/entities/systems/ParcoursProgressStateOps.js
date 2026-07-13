export function resetParcoursProgressState(state, {
    countReset = true,
    preserveCounters = true,
    errorMessage = '',
    now = 0,
    setErrorState = null,
} = {}) {
    if (!state) return;
    const previousWrongOrderCount = state.wrongOrderCount;
    const previousPenaltyTimeMs = state.penaltyTimeMs;
    const previousResetCount = state.resetCount;
    state.nextCheckpointIndex = 0;
    state.passedMask.fill(0);
    state.stageCheckpointIds.fill('');
    state.startedAtMs = 0;
    state.lastCheckpointAtMs = 0;
    state.completed = false;
    state.completedAtMs = 0;
    state.completionTimeMs = 0;
    state.lastCheckpointId = '';
    state.lastWrongOrderAtMs = -Infinity;
    state.cooldownByCheckpointId.clear();
    state.insideCheckpointById?.clear?.();
    state.lastError = '';
    state.errorUntilMs = 0;
    state.segmentSplitsMs = [];
    state.wrongOrderCount = preserveCounters ? previousWrongOrderCount : 0;
    state.penaltyTimeMs = preserveCounters ? previousPenaltyTimeMs : 0;
    state.resetCount = preserveCounters ? previousResetCount : 0;
    if (countReset) {
        state.resetCount += 1;
    }
    if (errorMessage && typeof setErrorState === 'function') {
        setErrorState(state, errorMessage, now);
    }
}

export function rewindParcoursProgressState(state, route, {
    now = 0,
    errorMessage = '',
    setErrorState = null,
} = {}) {
    if (!state || !route) return;
    const previousWrongOrderCount = state.wrongOrderCount;
    const previousPenaltyTimeMs = state.penaltyTimeMs;
    const previousResetCount = state.resetCount;
    const currentNext = Math.max(0, Math.min(route.totalCheckpoints, state.nextCheckpointIndex));
    const fallbackNext = Math.max(0, currentNext - 1);

    for (let index = fallbackNext; index < state.passedMask.length; index += 1) {
        state.passedMask[index] = 0;
        state.stageCheckpointIds[index] = '';
    }
    state.nextCheckpointIndex = fallbackNext;
    state.completed = false;
    state.completedAtMs = 0;
    state.completionTimeMs = 0;
    state.lastCheckpointId = fallbackNext > 0
        ? (state.stageCheckpointIds[fallbackNext - 1] || route.sequence[fallbackNext - 1] || '')
        : '';
    state.lastCheckpointAtMs = fallbackNext > 0 ? now : 0;
    if (fallbackNext <= 0) {
        state.startedAtMs = 0;
    }
    state.lastWrongOrderAtMs = -Infinity;
    state.cooldownByCheckpointId.clear();
    state.insideCheckpointById?.clear?.();
    state.lastError = '';
    state.errorUntilMs = 0;
    state.wrongOrderCount = previousWrongOrderCount;
    state.penaltyTimeMs = previousPenaltyTimeMs;
    state.resetCount = previousResetCount + 1;
    if (errorMessage && typeof setErrorState === 'function') {
        setErrorState(state, errorMessage, now);
    }
}

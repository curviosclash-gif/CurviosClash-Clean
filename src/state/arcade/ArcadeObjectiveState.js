const OBJECTIVE_TYPES = new Set([
    'survive_window',
    'bounty_hunt',
    'clean_sector',
    'hazard_lane',
]);

function toSafeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveBountyTarget(participants) {
    const roster = Array.isArray(participants) ? participants : [];
    const bots = roster
        .filter((entry) => entry?.isBot === true && entry.alive !== false)
        .sort((left, right) => Number(left?.playerIndex) - Number(right?.playerIndex));
    if (bots[0]) return bots[0];
    const humanIndices = roster
        .filter((entry) => entry?.isBot !== true)
        .map((entry) => Math.max(0, Math.trunc(toSafeNumber(entry?.playerIndex, 0))));
    const fallbackIndex = humanIndices.length > 0 ? Math.max(...humanIndices) + 1 : 1;
    return { playerIndex: fallbackIndex, label: `Bot ${fallbackIndex + 1}`, isBot: true, alive: true };
}

function withHudProgress(state) {
    const durationSec = Math.max(1, state.durationSec);
    if (state.objectiveId === 'bounty_hunt') {
        return {
            ...state,
            progressFraction: state.completed ? 1 : 0,
            progressText: state.completed ? `${state.targetLabel} ausgeschaltet` : `Ziel: ${state.targetLabel}`,
        };
    }
    if (state.objectiveId === 'clean_sector') {
        return {
            ...state,
            progressFraction: state.completed ? 1 : 0,
            progressText: state.failed ? 'Bonus verloren: Eigencrash' : 'Keinen Eigencrash verursachen',
        };
    }
    const progress = state.objectiveId === 'hazard_lane' ? state.safeElapsedSec : state.elapsedSec;
    const suffix = state.objectiveId === 'hazard_lane' ? ' kollisionsfrei' : '';
    return {
        ...state,
        progressFraction: state.completed ? 1 : Math.max(0, Math.min(1, progress / durationSec)),
        progressText: `${Math.min(durationSec, progress).toFixed(0)} / ${durationSec.toFixed(0)}s${suffix}`,
    };
}

function completeObjective(state, shouldEnd) {
    return withHudProgress({
        ...state,
        completed: true,
        failed: false,
        status: 'completed',
        shouldEnd: shouldEnd === true,
    });
}

function failObjective(state) {
    return withHudProgress({
        ...state,
        completed: false,
        failed: true,
        status: 'failed',
        shouldEnd: false,
    });
}

export function createArcadeObjectiveState(definition = null, options = {}) {
    const objectiveId = String(definition?.id || '').trim().toLowerCase();
    if (!OBJECTIVE_TYPES.has(objectiveId)) return null;
    const durationSec = Math.max(1, toSafeNumber(definition?.durationSec, 1));
    const target = objectiveId === 'bounty_hunt' ? resolveBountyTarget(options.participants) : null;
    return withHudProgress({
        sectorIndex: Math.max(1, Math.trunc(toSafeNumber(options.sectorIndex, 1))),
        objectiveId,
        label: String(definition?.label || objectiveId.replace(/_/g, ' ')),
        durationSec,
        scoreWeight: Math.max(1, toSafeNumber(definition?.scoreWeight, 1)),
        elapsedSec: 0,
        safeElapsedSec: 0,
        lastCollisionAtSec: 0,
        targetPlayerIndex: target ? Math.max(0, Math.trunc(toSafeNumber(target.playerIndex, 0))) : null,
        targetLabel: target ? String(target.label || `Bot ${Number(target.playerIndex) + 1}`) : '',
        completed: false,
        failed: false,
        status: 'active',
        shouldEnd: false,
        roundEndRequested: false,
    });
}

export function updateArcadeObjectiveState(objectiveState = null, event = null) {
    if (!objectiveState || typeof objectiveState !== 'object' || !event || typeof event !== 'object') {
        return objectiveState;
    }
    if (objectiveState.completed || (objectiveState.failed && objectiveState.objectiveId !== 'clean_sector')) {
        return objectiveState;
    }
    let next = { ...objectiveState, shouldEnd: false };
    if (event.type === 'tick' || event.type === 'sector_complete') {
        next.elapsedSec = Math.max(next.elapsedSec, toSafeNumber(event.elapsed, next.elapsedSec));
        next.safeElapsedSec = Math.max(0, next.elapsedSec - next.lastCollisionAtSec);
    }

    if (next.objectiveId === 'survive_window' && event.type === 'tick' && next.elapsedSec >= next.durationSec) {
        return completeObjective(next, true);
    }
    if (next.objectiveId === 'bounty_hunt') {
        if (event.type === 'kill' && Number(event.victimIndex) === next.targetPlayerIndex) {
            return completeObjective(next, true);
        }
        if (event.type === 'tick' && next.elapsedSec >= next.durationSec) return failObjective(next);
    }
    if (next.objectiveId === 'clean_sector') {
        if (event.type === 'self_collision') return failObjective(next);
        if (event.type === 'sector_complete' && !next.failed) return completeObjective(next, false);
    }
    if (next.objectiveId === 'hazard_lane') {
        if (event.type === 'self_collision') {
            next.lastCollisionAtSec = next.elapsedSec;
            next.safeElapsedSec = 0;
        }
        if (event.type === 'tick' && next.safeElapsedSec >= next.durationSec) {
            return completeObjective(next, true);
        }
    }
    if (event.type === 'sector_complete' && !next.completed && !next.failed) {
        return failObjective(next);
    }
    return withHudProgress(next);
}

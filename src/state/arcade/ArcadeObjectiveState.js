const OBJECTIVE_TYPES = new Set([
    'survive_window',
    'bounty_hunt',
    'clean_sector',
    'hazard_lane',
    'destroy_units',
    'intercept',
    'breach_vault',
]);

const UNIT_KIND_LABELS = Object.freeze({
    tank: 'Panzer', swarm: 'Schwarm', boss: 'Boss', bomber: 'Bomber', creature: 'Kreatur',
});

function toSafeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveBountyTarget(participants) {
    const roster = Array.isArray(participants) ? participants : [];
    const bots = roster
        .filter((entry) => entry?.isBot === true && entry.isCompanion !== true && entry.alive !== false)
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
    if (state.objectiveId === 'intercept') {
        const counter = `Panzer gestoppt ${state.unitsDestroyed}/${state.unitTarget}`;
        return { ...state, progressFraction: state.completed ? 1 : state.unitsDestroyed / state.unitTarget,
            progressText: state.failed ? `${counter} · Ein Panzer ist durchgebrochen` : counter };
    }
    if (state.objectiveId === 'breach_vault') {
        return { ...state, progressFraction: state.completed ? 1 : state.breachComplete ? 0.5 : 0,
            progressText: state.completed ? 'Turmbein zerstört · Tresor-Boss besiegt'
                : state.breachComplete ? 'Turmbein zerstört · Tresor-Boss besiegen' : 'Zuerst ein Turmbein zerstören' };
    }
    if (state.objectiveId === 'destroy_units') {
        const counter = `${UNIT_KIND_LABELS[state.unitKind] || 'Einheit'} ${state.unitsDestroyed}/${state.unitTarget}`;
        const remainingSec = Math.ceil(Math.max(0, state.durationSec - state.elapsedSec));
        return {
            ...state,
            progressFraction: state.completed ? 1 : state.unitsDestroyed / state.unitTarget,
            progressText: state.timeLimited && !state.completed && !state.failed ? `${counter} · ${remainingSec} s` : counter,
        };
    }
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
    // destroy_units may run without a clock (a boss fight); every other objective needs one.
    const timeLimited = !['destroy_units', 'intercept', 'breach_vault'].includes(objectiveId)
        || toSafeNumber(definition?.durationSec, 0) > 0;
    const durationSec = Math.max(1, toSafeNumber(definition?.durationSec, 1));
    const target = objectiveId === 'bounty_hunt' ? resolveBountyTarget(options.participants) : null;
    return withHudProgress({
        sectorIndex: Math.max(1, Math.trunc(toSafeNumber(options.sectorIndex, 1))),
        objectiveId,
        label: String(definition?.label || objectiveId.replace(/_/g, ' ')),
        durationSec,
        timeLimited,
        unitKind: ['destroy_units', 'intercept', 'breach_vault'].includes(objectiveId)
            ? String(definition?.unitKind || 'creature') : '',
        unitTarget: Math.max(1, Math.trunc(toSafeNumber(definition?.count, 1))),
        unitsDestroyed: 0,
        breachComplete: false,
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
    if (next.objectiveId === 'destroy_units') {
        if ((event.type === 'unit_destroyed' || event.type === 'unit_disabled')
            && String(event.unitKind || '') === next.unitKind) {
            next.unitsDestroyed = Math.min(next.unitTarget, next.unitsDestroyed + Math.max(1, Math.trunc(toSafeNumber(event.count, 1))));
            if (next.unitsDestroyed >= next.unitTarget) return completeObjective(next, true);
        }
        // Out of time ends the sector without the bonus: a scenario without bots has no other end.
        if (event.type === 'tick' && next.timeLimited && next.elapsedSec >= next.durationSec) {
            return { ...failObjective(next), shouldEnd: true };
        }
    }
    if (next.objectiveId === 'intercept') {
        if (event.type === 'unit_goal_reached' && event.unitKind === next.unitKind) {
            return { ...failObjective(next), shouldEnd: true };
        }
        if (event.type === 'unit_destroyed' && event.unitKind === next.unitKind) {
            next.unitsDestroyed = Math.min(next.unitTarget, next.unitsDestroyed + Math.max(1, Math.trunc(toSafeNumber(event.count, 1))));
            if (next.unitsDestroyed >= next.unitTarget) return completeObjective(next, true);
        }
    }
    if (next.objectiveId === 'breach_vault') {
        if (event.type === 'structure_destroyed' && event.segmentKind === 'leg_lower') {
            next.breachComplete = true;
        }
        if (next.breachComplete && event.type === 'unit_destroyed' && event.unitKind === next.unitKind) {
            next.unitsDestroyed = Math.min(next.unitTarget, next.unitsDestroyed + Math.max(1, Math.trunc(toSafeNumber(event.count, 1))));
            if (next.unitsDestroyed >= next.unitTarget) return completeObjective(next, true);
        }
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

/**
 * True while the objective itself decides when the sector ends: the last bot falling must not
 * end a map-unit hunt or a timed survival window.
 */
export function doesArcadeObjectiveHoldRound(objectiveState = null) {
    return objectiveState?.status === 'active'
        && ['destroy_units', 'survive_window', 'intercept', 'breach_vault'].includes(objectiveState.objectiveId);
}

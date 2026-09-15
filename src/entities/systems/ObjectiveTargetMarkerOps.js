// ============================================
// ObjectiveTargetMarkerOps.js - renderer-free state logic for the objective target marker
// ============================================

const BOUNTY_OBJECTIVE_ID = 'bounty_hunt';

const PULSE_SPEED = 3.4;
const PULSE_SCALE_BASE = 0.94;
const PULSE_SCALE_RANGE = 0.18;
const PULSE_OPACITY_BASE = 0.38;
const PULSE_OPACITY_RANGE = 0.34;

/**
 * Normalizes a player index. Everything that is not a non-negative integer
 * becomes `null`, which is the "nothing is marked" value used everywhere here.
 */
export function normalizeObjectiveTargetIndex(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const index = Math.trunc(numeric);
    return index >= 0 ? index : null;
}

/**
 * Reads the player index that an arcade objective wants highlighted.
 * Only an active bounty hunt names a target; a completed or failed objective
 * resolves to `null` so the marker disappears.
 */
export function resolveObjectiveTargetIndex(objectiveState = null) {
    if (!objectiveState || typeof objectiveState !== 'object') return null;
    const objectiveId = String(objectiveState.objectiveId || '').trim().toLowerCase();
    if (objectiveId !== BOUNTY_OBJECTIVE_ID) return null;
    if (objectiveState.completed === true || objectiveState.failed === true) return null;
    const status = String(objectiveState.status || 'active').trim().toLowerCase();
    if (status !== 'active') return null;
    return normalizeObjectiveTargetIndex(objectiveState.targetPlayerIndex);
}

/**
 * Finds the entity that the marker should follow. Returns `null` when no such
 * player exists, when it is dead or when its runtime slot is inactive.
 */
export function findObjectiveTargetPlayer(players, targetIndex) {
    const index = normalizeObjectiveTargetIndex(targetIndex);
    if (index === null || !Array.isArray(players)) return null;
    for (let i = 0; i < players.length; i += 1) {
        const candidate = players[i];
        if (normalizeObjectiveTargetIndex(candidate?.index) !== index) continue;
        if (candidate.alive === false) return null;
        if (candidate.entitySlotActive === false) return null;
        return candidate;
    }
    return null;
}

export function createObjectiveTargetMarkerState() {
    return {
        targetIndex: null,
        activeIndex: null,
        elapsedSeconds: 0,
    };
}

/**
 * Stores the index the marker should aim for. The marker only becomes visible
 * once `updateObjectiveTargetMarkerState` finds a matching live player.
 */
export function setObjectiveTargetMarkerIndex(state, targetIndex) {
    if (!state || typeof state !== 'object') return null;
    const next = normalizeObjectiveTargetIndex(targetIndex);
    if (state.targetIndex !== next) state.elapsedSeconds = 0;
    state.targetIndex = next;
    return next;
}

/**
 * Advances the marker clock and resolves which index is marked this frame.
 * Reports the previously marked index so the caller can drop its mesh.
 */
export function updateObjectiveTargetMarkerState(state, options = {}) {
    if (!state || typeof state !== 'object') {
        return { activeIndex: null, previousIndex: null, changed: false, target: null, elapsedSeconds: 0 };
    }
    const players = Array.isArray(options.players) ? options.players : [];
    const dt = Math.max(0, Number(options.dt) || 0);
    const previousIndex = normalizeObjectiveTargetIndex(state.activeIndex);
    const target = findObjectiveTargetPlayer(players, state.targetIndex);
    const activeIndex = target ? normalizeObjectiveTargetIndex(target.index) : null;
    const changed = activeIndex !== previousIndex;

    state.activeIndex = activeIndex;
    state.elapsedSeconds = changed
        ? 0
        : Math.max(0, (Number(state.elapsedSeconds) || 0) + dt);

    return {
        activeIndex,
        previousIndex,
        changed,
        target,
        elapsedSeconds: state.elapsedSeconds,
    };
}

/**
 * Breathing animation for the ring: a slow sine between a slightly shrunk and
 * a slightly grown ring, plus the matching opacity so it never blocks the view.
 */
export function resolveObjectiveTargetMarkerPulse(elapsedSeconds = 0) {
    const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
    const wave = (Math.sin(elapsed * PULSE_SPEED) + 1) * 0.5;
    return {
        scale: PULSE_SCALE_BASE + wave * PULSE_SCALE_RANGE,
        opacity: PULSE_OPACITY_BASE + wave * PULSE_OPACITY_RANGE,
    };
}

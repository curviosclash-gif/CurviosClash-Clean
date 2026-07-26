const DEFAULT_SELF_TRAIL_SKIP_RECENT = 12;
const STEERING_EPSILON = 0.0001;

export function resolveHeuristicSelfTrailSkipRecentSegments(
    runtimeContext,
    player,
    fallback = DEFAULT_SELF_TRAIL_SKIP_RECENT
) {
    const owner = runtimeContext?.entityManager;
    const resolver = owner?.constructor?.deriveSelfTrailSkipRecentSegments;
    if (typeof resolver === 'function') {
        const resolved = Number(resolver.call(owner.constructor, player));
        if (Number.isFinite(resolved)) return Math.max(0, Math.floor(resolved));
    }
    return Math.max(0, Math.floor(Number(fallback) || 0));
}

export function checkTrailCollision(
    trailSpatialIndex,
    position,
    radius,
    player,
    skipRecent = DEFAULT_SELF_TRAIL_SKIP_RECENT
) {
    if (typeof trailSpatialIndex?.checkGlobalCollision !== 'function') return false;
    const playerIndex = Number.isInteger(player?.index) ? player.index : -1;
    const hit = trailSpatialIndex.checkGlobalCollision(
        position,
        radius,
        playerIndex,
        Math.max(0, Math.floor(Number(skipRecent) || 0)),
        null
    );
    return !!(hit && hit.hit !== false);
}

export function refreshHeuristicPlannedPathClearance(state, input) {
    let arenaClearance = state.frontArenaClearance;
    let trailClearance = state.frontTrailClearance;
    let clearance = state.frontClearance;
    const yawAxis = Number(input?.yawAxis) || 0;
    const pitchAxis = Number(input?.pitchAxis) || 0;

    if (input?.yawLeft === true || yawAxis > STEERING_EPSILON) {
        arenaClearance = Math.min(arenaClearance, state.leftArenaClearance);
        trailClearance = Math.min(trailClearance, state.leftTrailClearance);
        clearance = Math.min(clearance, state.leftClearance);
    }
    if (input?.yawRight === true || yawAxis < -STEERING_EPSILON) {
        arenaClearance = Math.min(arenaClearance, state.rightArenaClearance);
        trailClearance = Math.min(trailClearance, state.rightTrailClearance);
        clearance = Math.min(clearance, state.rightClearance);
    }
    if (!state.planarMode && (input?.pitchUp === true || pitchAxis > STEERING_EPSILON)) {
        arenaClearance = Math.min(arenaClearance, state.upArenaClearance);
        trailClearance = Math.min(trailClearance, state.upTrailClearance);
        clearance = Math.min(clearance, state.upClearance);
    }
    if (!state.planarMode && (input?.pitchDown === true || pitchAxis < -STEERING_EPSILON)) {
        arenaClearance = Math.min(arenaClearance, state.downArenaClearance);
        trailClearance = Math.min(trailClearance, state.downTrailClearance);
        clearance = Math.min(clearance, state.downClearance);
    }

    state.plannedArenaClearance = arenaClearance;
    state.plannedTrailClearance = trailClearance;
    state.plannedClearance = clearance;
}

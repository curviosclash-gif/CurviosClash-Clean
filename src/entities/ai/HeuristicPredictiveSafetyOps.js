import { clamp } from '../../shared/utils/MathOps.js';
import { checkTrailCollision } from './HeuristicTrailSafetyOps.js';

export function checkArenaCollision(arena, position, radius) {
    if (typeof arena?.checkBotCollisionFast === 'function') {
        return !!arena.checkBotCollisionFast(position, radius);
    }
    if (typeof arena?.checkCollisionFast === 'function') {
        return !!arena.checkCollisionFast(position, radius);
    }
    if (typeof arena?.checkCollision === 'function') {
        return !!arena.checkCollision(position, radius);
    }
    return false;
}

export function samplePredictivePath(
    policy,
    state,
    runtimeContext,
    player,
    direction,
    lookAhead,
    radius,
    skipRecent,
    sampleCount
) {
    state.sampleArenaClearance = 1;
    state.sampleTrailClearance = 1;
    for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
        const ratio = sampleIndex / sampleCount;
        const intervalStart = (sampleIndex - 1) / sampleCount;
        policy._tmpTarget.copy(player.position).addScaledVector(direction, lookAhead * ratio);
        if (
            state.sampleArenaClearance === 1
            && checkArenaCollision(runtimeContext?.arena, policy._tmpTarget, radius)
        ) {
            state.sampleArenaClearance = intervalStart;
        }
        if (
            state.sampleTrailClearance === 1
            && checkTrailCollision(runtimeContext?.trailSpatialIndex, policy._tmpTarget, radius, player, skipRecent)
        ) {
            state.sampleTrailClearance = intervalStart;
        }
        if (state.sampleArenaClearance < 1 && state.sampleTrailClearance < 1) break;
    }
}

export function resolvePredictiveSafetyScale(profile) {
    const bias = clamp(Number(profile?.predictiveSafetyBias) || 0.5, 0.25, 1);
    return clamp(1 + (bias - 0.5) * 5, 0.5, 3.5);
}

export function resolvePredictiveSafetySampleCount(scale, baseSampleCount) {
    return Math.max(2, Math.ceil(baseSampleCount * scale));
}

export function resolvePredictiveSafetyLookAhead(speed, config, scale) {
    return clamp(
        Math.abs(Number(speed) || 0) * config.probeSpeedSeconds * scale,
        config.probeMinLookAhead * scale,
        config.probeMaxLookAhead * scale
    );
}

export function resolvePredictiveDangerThreshold(baseThreshold, scale) {
    return clamp(baseThreshold * scale, 0, 0.9);
}

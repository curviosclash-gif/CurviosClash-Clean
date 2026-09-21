import { TEAM_IDS } from './TeamCombatContract.js';

export const ESCORT_DEFAULTS = Object.freeze({
    tankMaxHp: 600,
    baseSpeed: 6,
    escortedSpeed: 10,
    escortRadius: 30,
    pathSeconds: 180,
    roundSeconds: 300,
});

export const ESCORT_PHASES = Object.freeze({
    MOVING: 'MOVING',
    DOWNED: 'DOWNED',
    RECOVERING: 'RECOVERING',
    GOAL: 'GOAL',
    DESTROYED: 'DESTROYED',
});

export const ESCORT_RECOVERY_DEFAULTS = Object.freeze({
    checkpointRepairRatio: 0.2,
    downedSeconds: 12,
    repairSeconds: 5,
    reviveHpRatio: 0.35,
    reviveProtectionSeconds: 3,
    maxRecoveryCharges: 1,
    defaultCheckpointRatios: Object.freeze([1 / 3, 2 / 3]),
});

export function resolveEscortTankSpeed(hasAlphaEscort) {
    return hasAlphaEscort ? ESCORT_DEFAULTS.escortedSpeed : ESCORT_DEFAULTS.baseSpeed;
}

function segmentLength(from, to) {
    return Math.hypot(
        Number(to?.[0]) - Number(from?.[0]),
        Number(to?.[1]) - Number(from?.[1]),
        Number(to?.[2]) - Number(from?.[2]),
    );
}

export function createEscortPathMetrics(path = []) {
    const points = Array.isArray(path) ? path : [];
    const cumulative = new Array(points.length).fill(0);
    for (let index = 1; index < points.length; index += 1) {
        const length = segmentLength(points[index - 1], points[index]);
        cumulative[index] = cumulative[index - 1] + (Number.isFinite(length) ? length : 0);
    }
    return Object.freeze({
        cumulative: Object.freeze(cumulative),
        totalDistance: cumulative[cumulative.length - 1] || 0,
    });
}

export function resolveEscortCheckpointPathIndices(path, authoredIndices = null) {
    const points = Array.isArray(path) ? path : [];
    if (points.length < 3) return Object.freeze([]);
    const authored = Array.isArray(authoredIndices)
        ? [...new Set(authoredIndices
            .map((value) => Math.trunc(Number(value)))
            .filter((value) => value > 0 && value < points.length - 1))]
            .sort((left, right) => left - right)
        : [];
    if (authored.length > 0) return Object.freeze(authored);

    const metrics = createEscortPathMetrics(points);
    if (metrics.totalDistance <= 0) return Object.freeze([]);
    const indices = [];
    for (const ratio of ESCORT_RECOVERY_DEFAULTS.defaultCheckpointRatios) {
        const target = metrics.totalDistance * ratio;
        let bestIndex = 1;
        let bestDelta = Infinity;
        for (let index = 1; index < points.length - 1; index += 1) {
            const delta = Math.abs(metrics.cumulative[index] - target);
            if (delta < bestDelta) {
                bestDelta = delta;
                bestIndex = index;
            }
        }
        if (!indices.includes(bestIndex)) indices.push(bestIndex);
    }
    return Object.freeze(indices.sort((left, right) => left - right));
}

export function resolveEscortPathProgress(unit, metrics = null) {
    const pathMetrics = metrics || createEscortPathMetrics(unit?.path);
    const totalDistance = Math.max(0, Number(pathMetrics?.totalDistance) || 0);
    const fromIndex = Math.max(0, Math.min(
        Math.max(0, (pathMetrics?.cumulative?.length || 1) - 1),
        Math.trunc(Number(unit?.fromIndex) || 0),
    ));
    const distance = Math.max(0, Math.min(
        totalDistance,
        (Number(pathMetrics?.cumulative?.[fromIndex]) || 0) + Math.max(0, Number(unit?.progress) || 0),
    ));
    return {
        distance,
        totalDistance,
        ratio: totalDistance > 0 ? distance / totalDistance : 0,
    };
}

/** @param {{ tankAlive?: boolean, reachedGoal?: boolean, elapsedSeconds?: number, phase?: string }} [state] */
export function resolveEscortOutcome({ tankAlive, reachedGoal, elapsedSeconds, phase } = {}) {
    if (reachedGoal === true) return { shouldEnd: true, winnerTeamId: TEAM_IDS.ALPHA, reason: 'ESCORT_GOAL' };
    if (tankAlive === false || phase === ESCORT_PHASES.DESTROYED) {
        return { shouldEnd: true, winnerTeamId: TEAM_IDS.BRAVO, reason: 'ESCORT_TANK_DESTROYED' };
    }
    if (Math.max(0, Number(elapsedSeconds) || 0) >= ESCORT_DEFAULTS.roundSeconds) {
        return { shouldEnd: true, winnerTeamId: TEAM_IDS.BRAVO, reason: 'ESCORT_TIME_LIMIT' };
    }
    return null;
}

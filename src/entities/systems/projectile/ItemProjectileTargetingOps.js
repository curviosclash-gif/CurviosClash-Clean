import { canTargetEnemy } from '../../../shared/contracts/TeamCombatContract.js';

export const ITEM_PROJECTILE_TARGETING_PROFILE = Object.freeze({
    lockOnAngleDegrees: 45,
    range: 100,
    turnRate: 8,
    reacquireInterval: 0.08,
    leadTimeMax: 0.5,
});

const ITEM_PROJECTILE_TYPES = new Set([
    'SPEED_UP',
    'SLOW_DOWN',
    'THIN',
    'INVERT',
    'TRAIL_GAP',
    'SWAP',
]);

const TARGET_SCORE_EPSILON = 0.000001;

export function isItemProjectileType(type) {
    return ITEM_PROJECTILE_TYPES.has(String(type || '').trim().toUpperCase());
}

function isUsableTarget(target, owner, origin, maxRangeSq) {
    return !!target?.alive
        && canTargetEnemy(owner, target)
        && target.decoyActive !== true
        && !!target.position
        && origin.distanceToSquared(target.position) <= maxRangeSq;
}

export function resolveItemProjectileTarget({
    owner,
    players,
    origin,
    direction,
    scratch,
    currentTarget = null,
} = {}) {
    if (!origin || !direction || !scratch || !Array.isArray(players)) return null;
    const maxRangeSq = ITEM_PROJECTILE_TARGETING_PROFILE.range ** 2;
    if (isUsableTarget(currentTarget, owner, origin, maxRangeSq)) return currentTarget;

    const minDot = Math.cos(ITEM_PROJECTILE_TARGETING_PROFILE.lockOnAngleDegrees * Math.PI / 180);
    let bestTarget = null;
    let bestDot = minDot;
    let bestDistanceSq = Infinity;
    for (let i = 0; i < players.length; i += 1) {
        const candidate = players[i];
        if (!isUsableTarget(candidate, owner, origin, maxRangeSq)) continue;
        scratch.subVectors(candidate.position, origin);
        const distanceSq = scratch.lengthSq();
        if (distanceSq <= TARGET_SCORE_EPSILON) continue;
        const facingDot = direction.dot(scratch.multiplyScalar(1 / Math.sqrt(distanceSq)));
        if (facingDot + TARGET_SCORE_EPSILON < minDot) continue;
        if (facingDot > bestDot + TARGET_SCORE_EPSILON
            || (Math.abs(facingDot - bestDot) <= TARGET_SCORE_EPSILON && distanceSq < bestDistanceSq)) {
            bestTarget = candidate;
            bestDot = facingDot;
            bestDistanceSq = distanceSq;
        }
    }
    return bestTarget;
}

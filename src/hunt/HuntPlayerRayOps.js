// ============================================
// HuntPlayerRayOps.js - where an MG ray enters a player (split out of HuntTargetingOps).
// Arcade part hitbox (player.arcadeHitbox): the ray is tested against the part boxes, so a
// shot beside the wing tip misses. Everyone else: the hitboxRadius sphere as before.
// ============================================
import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';
import { rayHitsArcadePartBoxes } from '../entities/player/ArcadePartHitboxOps.js';

/**
 * @param {any} target
 * @param {any} origin
 * @param {any} direction   normalized
 * @param {number} maxRange
 * @param {any} toTarget     scratch vector
 * @returns {number} entry distance along the ray, or -1
 */
export function resolvePlayerRayEntryDistance(target, origin, direction, maxRange, toTarget) {
    if (target.arcadeHitbox) {
        const entry = rayHitsArcadePartBoxes(target, origin, direction, maxRange);
        return entry > maxRange ? -1 : entry;
    }
    const hitboxRadius = Math.max(
        0.2,
        Number(target.hitboxRadius) || Number(resolveGameplayConfig(target).PLAYER?.HITBOX_RADIUS) || 0.8
    );
    const hitboxRadiusSq = hitboxRadius * hitboxRadius;

    toTarget.subVectors(target.position, origin);
    const forwardDistance = direction.dot(toTarget);
    if (forwardDistance < -hitboxRadius || forwardDistance > maxRange + hitboxRadius) return -1;

    const toTargetLenSq = toTarget.lengthSq();
    const closestDistanceSq = Math.max(0, toTargetLenSq - forwardDistance * forwardDistance);
    if (closestDistanceSq > hitboxRadiusSq) return -1;

    const intersectionOffset = Math.sqrt(Math.max(0, hitboxRadiusSq - closestDistanceSq));
    const entryDistance = Math.max(0, forwardDistance - intersectionOffset);
    return entryDistance > maxRange ? -1 : entryDistance;
}

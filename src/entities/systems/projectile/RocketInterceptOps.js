import { getRocketTierTypes, isRocketTierType, normalizeRocketPickupType } from '../../../hunt/RocketPickupSystem.js';

/**
 * Rocket tiers from the weakest to the strongest, as the pickup registry lists them.
 * Built once at module load: the registry is frozen, so the ranking never changes.
 */
const ROCKET_TIER_RANK = (() => {
    const rank = new Map();
    const types = getRocketTierTypes();
    for (let i = 0; i < types.length; i += 1) rank.set(types[i], i);
    return rank;
})();

/**
 * Index of the weakest rocket in a magazine (E77).
 *
 * Defending costs a rocket, so it costs the cheapest one - never the front one and
 * never the mega rocket the player saved up. Ties and unknown entries keep the
 * earliest slot, so the order of the remaining rockets stays untouched.
 */
export function pickWeakestRocketIndex(rocketInventory) {
    if (!Array.isArray(rocketInventory) || rocketInventory.length === 0) return 0;
    let bestIndex = 0;
    let bestRank = Infinity;
    for (let i = 0; i < rocketInventory.length; i += 1) {
        const type = normalizeRocketPickupType(rocketInventory[i], { fallback: rocketInventory[i] });
        const rank = ROCKET_TIER_RANK.has(type) ? ROCKET_TIER_RANK.get(type) : Infinity;
        if (rank < bestRank) {
            bestRank = rank;
            bestIndex = i;
        }
    }
    return bestIndex;
}

/**
 * The rocket a player may shoot down right now, or '' when there is none.
 *
 * A9: exclusion zone rockets cannot be intercepted, so the tracker hands out the
 * nearest *interceptable* rocket separately from the nearest threat. Nothing here
 * fires by itself (E76) - the caller is already inside a real shot.
 */
export function resolveInterceptTargetId(system, player) {
    const index = Number(player?.index);
    if (!Number.isInteger(index) || index < 0) return '';
    if (typeof system?.getRocketThreat !== 'function') return '';
    const threat = system.getRocketThreat(index);
    if (!threat?.active) return '';
    return String(threat.nearestInterceptableId || '');
}

/** Whether a fired projectile of this type may defend at all (never item projectiles). */
export function canRocketIntercept(type, itemHomingProfile) {
    return !itemHomingProfile && isRocketTierType(type);
}

/**
 * Find a live projectile by its id. The list holds a handful of entries, so a linear
 * scan is cheaper than any index - and it never allocates.
 *
 * Ids are the only safe handle: projectile states come from a pool, so a held object
 * reference would point at a completely different rocket after recycling.
 */
export function findProjectileByTraversalId(projectiles, traversalId) {
    if (!Array.isArray(projectiles) || !traversalId) return null;
    for (let i = 0; i < projectiles.length; i += 1) {
        const candidate = projectiles[i];
        if (candidate && candidate.traversalId === traversalId) return candidate;
    }
    return null;
}

/** A3: the chased rocket is gone, so the interceptor becomes a normal homing rocket again. */
export function clearInterceptState(projectile) {
    if (!projectile) return;
    projectile.isInterceptor = false;
    projectile.interceptTargetId = '';
}

/**
 * Aim point for an interceptor: the chased rocket's position plus a short lead along
 * its own velocity, capped exactly like the player lead (`homingLeadTimeMax`).
 * Writes into `out` and returns it. The limits are plain arguments, not an options
 * object: this runs every tick per interceptor and must not allocate.
 */
export function resolveInterceptAimPosition(projectile, targetRocket, out, leadTimeMax = 0, speedEpsilon = 0.0001) {
    if (!projectile || !targetRocket || !out) return null;
    out.copy(targetRocket.position);
    const velocity = targetRocket.velocity;
    if (!velocity || leadTimeMax <= 0) return out;
    const speed = projectile.velocity?.length?.() || 0;
    if (speed <= speedEpsilon) return out;
    const distance = out.distanceTo(projectile.position);
    out.addScaledVector(velocity, Math.min(leadTimeMax, distance / speed));
    return out;
}

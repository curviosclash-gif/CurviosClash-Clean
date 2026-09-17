import { getRocketTierTypes, isRocketTierType, normalizeRocketPickupType } from '../../../hunt/RocketPickupSystem.js';
import { HUNT_CONFIG } from '../../../hunt/HuntConfig.js';
import { resolveEntityRuntimeConfig } from '../../../shared/contracts/EntityRuntimeConfig.js';

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

function clamp01(value) {
    if (!(value > 0)) return 0;
    return value > 1 ? 1 : value;
}

/**
 * Where the two frame paths come closest, as a share of the first path (0 = its start,
 * 1 = its end) plus that smallest distance squared. Reused instead of returned fresh:
 * this runs for every interceptor in every frame and must not allocate.
 */
const SWEEP_APPROACH = { distanceSquared: Infinity, alongFirst: 1 };

/**
 * Smallest distance between two straight frame paths (Ericson, closest points of two
 * segments). Both rockets move during the frame, so a check against end points alone
 * would let two rockets swap places without ever noticing each other. Comparing whole
 * paths is exact at any speed and any frame length, costs no loop, and is deliberately
 * generous: which of the two rockets was stepped first this frame may shift the timing
 * by one frame, and "the interceptor always hits" (E35) is the wanted side to err on.
 */
function measurePathApproach(firstStart, firstEnd, secondStart, secondEnd) {
    const EPSILON = 0.000001;
    const d1x = firstEnd.x - firstStart.x, d1y = firstEnd.y - firstStart.y, d1z = firstEnd.z - firstStart.z;
    const d2x = secondEnd.x - secondStart.x, d2y = secondEnd.y - secondStart.y, d2z = secondEnd.z - secondStart.z;
    const rx = firstStart.x - secondStart.x, ry = firstStart.y - secondStart.y, rz = firstStart.z - secondStart.z;
    const a = d1x * d1x + d1y * d1y + d1z * d1z;
    const e = d2x * d2x + d2y * d2y + d2z * d2z;
    const f = d2x * rx + d2y * ry + d2z * rz;
    const c = d1x * rx + d1y * ry + d1z * rz;
    let s = 0;
    let t = 0;
    if (a <= EPSILON && e <= EPSILON) {
        s = 0;
        t = 0;
    } else if (a <= EPSILON) {
        t = clamp01(f / e);
    } else if (e <= EPSILON) {
        s = clamp01(-c / a);
    } else {
        const b = d1x * d2x + d1y * d2y + d1z * d2z;
        const denominator = a * e - b * b;
        s = denominator > EPSILON ? clamp01((b * f - c * e) / denominator) : 0;
        t = (b * s + f) / e;
        if (t < 0) {
            t = 0;
            s = clamp01(-c / a);
        } else if (t > 1) {
            t = 1;
            s = clamp01((b - c) / a);
        }
    }
    const gapX = (firstStart.x + d1x * s) - (secondStart.x + d2x * t);
    const gapY = (firstStart.y + d1y * s) - (secondStart.y + d2y * t);
    const gapZ = (firstStart.z + d1z * s) - (secondStart.z + d2z * t);
    SWEEP_APPROACH.distanceSquared = gapX * gapX + gapY * gapY + gapZ * gapZ;
    SWEEP_APPROACH.alongFirst = s;
    return SWEEP_APPROACH;
}

/** How close a defence rocket has to pass the rocket it chases to destroy it. */
export function resolveInterceptHitRadius(system) {
    const rocketConfig = resolveEntityRuntimeConfig(system)?.HUNT?.ROCKET || HUNT_CONFIG.ROCKET;
    const configured = Number(rocketConfig?.INTERCEPT_HIT_RADIUS);
    return Number.isFinite(configured) && configured > 0 ? configured : 3;
}

/**
 * E35: a defence rocket that reaches the rocket it chases takes both of them out.
 *
 * Only the rocket named by `interceptTargetId` counts - a defence rocket never shoots
 * down anything it happens to fly past, and never another defence rocket (E37). Both
 * rockets blow up the normal way, but nothing around them is damaged: no blast, no
 * trail damage, no turret damage, not even for a player standing right next to it.
 *
 * Removal goes through the system's deferral, because the chased rocket can sit either
 * before or after the interceptor in the list the update loop is walking backwards.
 */
export function resolveInterceptHit(system, projectile, hitResolver) {
    if (!system || system.networkReplica === true) return false;
    if (!projectile?.isInterceptor || !projectile.interceptTargetId) return false;
    const target = findProjectileByTraversalId(system.projectiles, projectile.interceptTargetId);
    // A3: target gone (wall, trail, lifetime) or already hit by another defence rocket
    // in this very frame - so this one flies on as a normal homing rocket.
    if (!target || target === projectile || target.isInterceptor === true || system._isPendingRemoval?.(target)) {
        clearInterceptState(projectile);
        return false;
    }

    const hitRadius = resolveInterceptHitRadius(system);
    const approach = measurePathApproach(
        projectile.previousPosition || projectile.position,
        projectile.position,
        target.previousPosition || target.position,
        target.position,
    );
    if (approach.distanceSquared > hitRadius * hitRadius) return false;

    // Both blasts share the meeting point, so the two explosions read as one event.
    const start = projectile.previousPosition || projectile.position;
    projectile.position.set(
        start.x + (projectile.position.x - start.x) * approach.alongFirst,
        start.y + (projectile.position.y - start.y) * approach.alongFirst,
        start.z + (projectile.position.z - start.z) * approach.alongFirst,
    );
    projectile.mesh?.position.copy(projectile.position);
    hitResolver?.detonateProjectile?.(projectile, projectile.position);
    hitResolver?.detonateProjectile?.(target, projectile.position);
    const targetIndex = system.projectiles.indexOf(target);
    if (targetIndex >= 0) system._removeProjectileAt(targetIndex);
    // One report per hit for the credit and the announcement (S2.3). The position is the
    // live vector of a pooled state, so a listener copies it instead of keeping it.
    system.onRocketIntercepted?.({
        defender: projectile.owner,
        interceptor: projectile,
        target,
        position: projectile.position,
    });
    return true;
}

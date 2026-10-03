import { BOMBER_STRIKE_FORMATION } from '../../../shared/contracts/BomberStrikeFormationContract.js';
import { canDamage, TEAM_WEAPON_KINDS } from '../../../shared/contracts/TeamCombatContract.js';

// Bombs fall with this acceleration (BomberBombOps sets projectile.gravity = -24).
const BOMB_GRAVITY = 24;
// How far from the predicted impact an enemy may be for a release to count as aimed.
const DROP_TOLERANCE = 1.5;

/**
 * A called strike hunts for its whole lifetime (user decision 03.10.2026): every aircraft picks an
 * enemy no other aircraft of the same strike is after, flies over it, bombs it on the way and then
 * picks the next one. The host steers; a replica only takes the pose from the snapshot.
 */
export function startBomberHunt(unit, strikeId) {
    unit.bomberHunt = { strikeId, target: null, last: null, exiting: false };
    unit.summonRemaining = BOMBER_STRIKE_FORMATION.durationSeconds;
}

/** Players a strike may hunt: alive, not its caller, and damageable by the caller's items. */
export function isBomberHuntTarget(owner, player) {
    return !!player?.position && player.alive === true && player !== owner
        && canDamage(owner, player, TEAM_WEAPON_KINDS.ITEM_PROJECTILE);
}

/**
 * Nearest target nobody else of the strike claims, never the one just overflown. Falls back to a
 * claimed target, then to the last one, so a lone enemy is still hunted again and again.
 * @param {{x:number,z:number}} from
 * @param {Array<{position:{x:number,z:number}}>} candidates
 * @param {Set<object>} claimed
 * @param {object|null} last
 */
export function chooseBomberTarget(from, candidates, claimed, last) {
    let best = null; let bestRank = Infinity; let bestDistance = Infinity;
    for (const candidate of candidates) {
        const rank = (claimed.has(candidate) ? 1 : 0) + (candidate === last ? 2 : 0);
        const distance = Math.hypot(candidate.position.x - from.x, candidate.position.z - from.z);
        if (rank < bestRank || (rank === bestRank && distance < bestDistance)) {
            best = candidate; bestRank = rank; bestDistance = distance;
        }
    }
    return best;
}

/** Turns `current` towards `desired` by at most `maxStep` radians along the shorter way. */
export function turnYawTowards(current, desired, maxStep) {
    let delta = desired - current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return current + Math.max(-maxStep, Math.min(maxStep, delta));
}

function collectTargets(system, unit, out) {
    out.length = 0;
    for (const player of system.entityManager?.players || []) {
        if (isBomberHuntTarget(unit.attackSourcePlayer, player)) out.push(player);
    }
    return out;
}

function claimedByOthers(system, unit, out) {
    out.clear();
    for (const other of system.units) {
        if (other === unit || !other.alive || other.bomberHunt?.strikeId !== unit.bomberHunt.strikeId) continue;
        if (other.bomberHunt.target) out.add(other.bomberHunt.target);
    }
    return out;
}

/** Host-only flight step of a hunting aircraft: retarget, turn, keep inside the arena, move. */
export function steerHuntingBomber(system, unit, dt) {
    const hunt = unit.bomberHunt;
    const bounds = system.entityManager?.arena?.bounds || {};
    const pos = unit.groundPosition;
    const speed = Number(unit.speed) || BOMBER_STRIKE_FORMATION.speed;
    if (!hunt.exiting && unit.summonRemaining <= BOMBER_STRIKE_FORMATION.exitSeconds) {
        hunt.exiting = true;
        hunt.target = null;
    }
    let desired = unit.yaw;
    if (hunt.exiting) {
        // The strike breaks off upwards and leaves through the ceiling instead of vanishing mid-air.
        pos.y += BOMBER_STRIKE_FORMATION.exitClimbSpeed * dt;
    } else {
        const targets = collectTargets(system, unit, system._bomberHuntTargets || (system._bomberHuntTargets = []));
        const passed = hunt.target
            && Math.hypot(hunt.target.position.x - pos.x, hunt.target.position.z - pos.z) < BOMBER_STRIKE_FORMATION.passRadius;
        if (passed) hunt.last = hunt.target;
        if (passed || !hunt.target || !targets.includes(hunt.target)) {
            const claimed = claimedByOthers(system, unit, system._bomberHuntClaims || (system._bomberHuntClaims = new Set()));
            hunt.target = chooseBomberTarget(pos, targets, claimed, hunt.last);
        }
        if (hunt.target) desired = Math.atan2(hunt.target.position.x - pos.x, hunt.target.position.z - pos.z);
        const margin = BOMBER_STRIKE_FORMATION.edgeMargin;
        const minX = Number(bounds.minX ?? bounds.min?.x); const maxX = Number(bounds.maxX ?? bounds.max?.x);
        const minZ = Number(bounds.minZ ?? bounds.min?.z); const maxZ = Number(bounds.maxZ ?? bounds.max?.z);
        const nearEdge = [minX, maxX, minZ, maxZ].every(Number.isFinite)
            && (pos.x < minX + margin || pos.x > maxX - margin || pos.z < minZ + margin || pos.z > maxZ - margin);
        if (nearEdge && !hunt.target) desired = Math.atan2((minX + maxX) / 2 - pos.x, (minZ + maxZ) / 2 - pos.z);
    }
    unit.yaw = turnYawTowards(unit.yaw, desired, BOMBER_STRIKE_FORMATION.turnRate * dt);
    pos.x += Math.sin(unit.yaw) * speed * dt;
    pos.z += Math.cos(unit.yaw) * speed * dt;
    const minX = Number(bounds.minX ?? bounds.min?.x); const maxX = Number(bounds.maxX ?? bounds.max?.x);
    const minZ = Number(bounds.minZ ?? bounds.min?.z); const maxZ = Number(bounds.maxZ ?? bounds.max?.z);
    if (Number.isFinite(minX) && Number.isFinite(maxX)) pos.x = Math.max(minX, Math.min(maxX, pos.x));
    if (Number.isFinite(minZ) && Number.isFinite(maxZ)) pos.z = Math.max(minZ, Math.min(maxZ, pos.z));
}

/**
 * Whether a hunting aircraft should release now: the bomb, falling from here with the aircraft's
 * own speed, would land within reach of an enemy. A strike that breaks off drops nothing.
 */
export function shouldDropHuntingBomb(system, unit, blastRadius) {
    if (unit.bomberHunt?.exiting) return false;
    const targets = collectTargets(system, unit, system._bomberHuntTargets || (system._bomberHuntTargets = []));
    const speed = Number(unit.speed) || 0;
    const reach = blastRadius * DROP_TOLERANCE;
    for (const target of targets) {
        const drop = unit.position.y - 1 - target.position.y;
        if (drop <= 0) continue;
        const fallSeconds = Math.sqrt((2 * drop) / BOMB_GRAVITY);
        const impactX = unit.position.x + Math.sin(unit.yaw) * speed * fallSeconds;
        const impactZ = unit.position.z + Math.cos(unit.yaw) * speed * fallSeconds;
        if (Math.hypot(target.position.x - impactX, target.position.z - impactZ) <= reach) return true;
    }
    return false;
}

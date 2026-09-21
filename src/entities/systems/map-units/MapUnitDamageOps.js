import { rewardMapUnitDestruction } from './MapUnitRewardOps.js';
import { beginBomberCrash } from './MapUnitBomberCrashOps.js';
import { areTeammates } from '../../../shared/contracts/TeamCombatContract.js';
import { ESCORT_PHASES, ESCORT_RECOVERY_DEFAULTS } from '../../../shared/contracts/EscortObjectiveContract.js';
import { stopHydra } from './MapUnitHydraOps.js';

/**
 * Hit points, destruction and return of map units (E19, E34).
 *
 * A destroyed tank explodes: 40 damage at the centre falling to half at the edge of a 20 unit
 * radius. The blast hurts everyone in reach - players including the shooter, other tanks and
 * turrets - except players under spawn protection. Kills by the blast are credited to whoever
 * destroyed the tank. After `respawnSeconds` a fresh tank starts again at the beginning of its path;
 * 0 keeps it destroyed for the rest of the round.
 */

export const MAP_UNIT_BLAST = Object.freeze({
    damage: 40,
    radius: 20,
    edgeFactor: 0.5,
    cause: 'TANK_EXPLOSION',
});

const BLAST_COLOR = 0xff8a3d;
const HIT_COLOR = 0xffc36b;

function emptyResult(unit) {
    return { applied: 0, hpApplied: 0, absorbedByShield: 0, remainingHp: Math.max(0, Number(unit?.hp) || 0), isDead: !unit?.alive };
}

export function applyMapUnitDamage(system, unit, amount, options = {}) {
    if (!unit?.alive || system.networkReplica) return emptyResult(unit);
    if (unit.escortTank === true && areTeammates(unit, options.sourcePlayer)) return emptyResult(unit);
    if (unit.escortTank === true && (
        unit.escortPhase === ESCORT_PHASES.DOWNED
        || unit.escortPhase === ESCORT_PHASES.RECOVERING
        || (Number(unit.escortProtectionRemaining) || 0) > 0
    )) return emptyResult(unit);
    const requested = Math.max(0, Number(amount) || 0);
    const hpBefore = unit.hp;
    unit.hp = Math.max(0, hpBefore - requested);
    const hpApplied = hpBefore - unit.hp;
    const owner = system.entityManager;
    if (hpApplied > 0) {
        if (unit.escortTank === true && Number.isInteger(options.sourcePlayer?.index)) {
            owner?._huntScoring?.registerEscortTankDamage?.(options.sourcePlayer.index, hpApplied);
        }
        owner?.particles?.spawnHit?.(unit.position, HIT_COLOR);
        owner?.recorder?.logEvent?.(
            'MAP_UNIT_DAMAGED',
            Number.isInteger(options.sourcePlayer?.index) ? options.sourcePlayer.index : -1,
            `${unit.id}:cause=${String(options.cause || 'UNKNOWN')}:damage=${Math.round(hpApplied)}:hp=${Math.round(unit.hp)}`,
        );
    }
    const isDead = unit.hp <= 0;
    if (isDead && unit.escortTank === true && (Number(unit.escortRecoveryCharges) || 0) > 0) {
        unit.escortRecoveryCharges = Math.max(0, unit.escortRecoveryCharges - 1);
        unit.escortPhase = ESCORT_PHASES.DOWNED;
        unit.speed = 0;
        unit.escortDownedRemaining = ESCORT_RECOVERY_DEFAULTS.downedSeconds;
        unit.escortRepairProgress = 0;
        unit.escortLastDamageSource = options.sourcePlayer || null;
        unit.escortDownCredited = true;
        owner?.recorder?.logEvent?.(
            'ESCORT_TANK_DOWNED',
            Number.isInteger(options.sourcePlayer?.index) ? options.sourcePlayer.index : -1,
            unit.id,
        );
        owner?._huntScoring?.registerEscortTankDown?.(options.sourcePlayer?.index, false);
        return { applied: requested, hpApplied, absorbedByShield: 0, remainingHp: 0, isDead: false, isDowned: true };
    }
    if (isDead && unit.kind === 'bomber') beginBomberCrash(unit, options.sourcePlayer || null);
    else if (isDead) destroyMapUnit(system, unit, options.sourcePlayer || null);
    return { applied: requested, hpApplied, absorbedByShield: 0, remainingHp: unit.hp, isDead };
}

function isSpawnProtected(player) {
    return (Number(player?.spawnProtectionTimer) || 0) > 0;
}

function blastDamageAt(distance, radius) {
    if (distance > radius) return 0;
    const falloff = 1 - (distance / radius) * (1 - MAP_UNIT_BLAST.edgeFactor);
    return MAP_UNIT_BLAST.damage * falloff;
}

function applyBlast(system, unit, sourcePlayer) {
    const owner = system.entityManager;
    const radius = MAP_UNIT_BLAST.radius * unit.scale;
    const centre = unit.position;
    for (const player of owner?.players || []) {
        if (!player?.alive || !player.position || isSpawnProtected(player)) continue;
        const damage = blastDamageAt(player.position.distanceTo(centre), radius);
        if (damage <= 0 || typeof player.takeDamage !== 'function') continue;
        const damageResult = player.takeDamage(damage);
        owner?._emitHuntDamageEvent?.({
            target: player,
            sourcePlayer,
            cause: MAP_UNIT_BLAST.cause,
            damageResult,
            impactPoint: centre,
        });
        if (damageResult?.isDead) {
            owner?._killPlayer?.(player, 'PROJECTILE', {
                // Caught in the blast of your own kill is no kill for anyone.
                killer: sourcePlayer === player ? null : sourcePlayer,
                impactPoint: centre,
                projectileType: MAP_UNIT_BLAST.cause,
            });
        }
    }
    // Other tanks and turrets take the blast too, so a column of tanks can go up in a chain.
    const targets = [...(owner?._targetableRegistry?.collect?.() || [])];
    for (const target of targets) {
        if (target === unit || !target?.position || !(Number(target.hp) > 0)) continue;
        const damage = blastDamageAt(target.position.distanceTo(centre), radius);
        if (damage > 0) target.takeDamage?.(damage, { sourcePlayer, cause: MAP_UNIT_BLAST.cause });
    }
}

export function destroyMapUnit(system, unit, sourcePlayer) {
    const owner = system.entityManager;
    if (unit.hydra) stopHydra(system, unit);
    unit.alive = false;
    unit.hp = 0;
    if (unit.escortTank === true) unit.escortPhase = ESCORT_PHASES.DESTROYED;
    if (unit.escortTank === true) {
        owner?._huntScoring?.registerEscortTankDown?.(
            sourcePlayer?.index,
            true,
            unit.escortDownCredited !== true,
        );
    }
    unit.respawnRemaining = unit.definition.respawnSeconds > 0 ? unit.definition.respawnSeconds : Infinity;
    if (unit.root) unit.root.visible = false;
    owner?.particles?.spawnExplosion?.(unit.position, BLAST_COLOR, {
        cause: 'PROJECTILE', projectileType: unit.hydra ? 'HYDRA_DEATH' : 'ROCKET_HEAVY',
    });
    owner?.audio?.play?.('HIT', { intensity: 1 });
    owner?.recorder?.logEvent?.(
        'MAP_UNIT_DESTROYED',
        Number.isInteger(sourcePlayer?.index) ? sourcePlayer.index : -1,
        `${unit.id}:${unit.kind}`,
    );
    unit.deaths = (Number(unit.deaths) || 0) + 1;
    system.setBossRoomClock?.(unit, false);
    if (!unit.hydra) applyBlast(system, unit, sourcePlayer);
    if (unit.escortTank !== true) rewardMapUnitDestruction(system, unit, sourcePlayer);
}

/** Counts down destroyed units and answers the ones due to come back this tick. */
export function tickMapUnitRespawns(units, dt, out) {
    out.length = 0;
    for (const unit of units) {
        if (unit.alive || !Number.isFinite(unit.respawnRemaining)) continue;
        unit.respawnRemaining -= dt;
        if (unit.respawnRemaining <= 0) out.push(unit);
    }
    return out;
}

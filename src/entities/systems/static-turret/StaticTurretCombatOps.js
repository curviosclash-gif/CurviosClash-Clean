import { isDestructibleTurret } from '../../../shared/contracts/TurretCombatContract.js';
import { isStaticTurretRocketThreatTarget } from './StaticTurretTargetingOps.js';

const TURRET_MG_COLOR = 0xffb347;

function resolveOwnerIndex(turret) {
    return Number.isInteger(turret?.ownerIndex)
        ? turret.ownerIndex
        : (Number.isInteger(turret?.ownerPlayer?.index) ? turret.ownerPlayer.index : -1);
}

export function applyStaticTurretMgHit(system, turret, target) {
    const owner = system.entityManager;
    if (isStaticTurretRocketThreatTarget(system, turret, target)) {
        owner?._projectileSystem?.interceptRocket?.(target, turret.source, turret);
        return;
    }
    if (target?.isTrail) {
        const trailSpatialIndex = owner?._trailSpatialIndex;
        if (!trailSpatialIndex?.damageTrailSegment || !target.entry) return;
        const damageResult = trailSpatialIndex.damageTrailSegment(target.entry, turret.damage);
        owner.particles?.spawnTrailImpact?.(target.position, TURRET_MG_COLOR, {
            destroyed: damageResult?.destroyed === true,
        });
        if (damageResult?.hit) {
            owner.recorder?.logEvent?.('TURRET_TRAIL_HIT', resolveOwnerIndex(turret), turret.id);
            if (!turret.ownerPlayer?.isBot) owner.audio?.play?.('MG_HIT', { intensity: 0.5 });
        }
        return;
    }
    if (isDestructibleTurret(target)) {
        target.takeDamage?.(turret.damage, {
            sourcePlayer: turret.source,
            cause: 'STATIC_TURRET_MG',
        });
        return;
    }
    if (!owner || typeof target?.takeDamage !== 'function') return;
    const damageResult = target.takeDamage(turret.damage);
    owner._emitHuntDamageEvent?.({
        target,
        sourcePlayer: turret.source,
        cause: 'STATIC_TURRET_MG',
        damageResult,
        projectileType: null,
        impactPoint: target.position,
    });
    const appliedDamage = Math.max(
        0,
        Number(damageResult?.hpApplied) || 0,
        Number(damageResult?.absorbedByShield) || 0
    );
    if (appliedDamage > 0) {
        owner.recorder?.logEvent?.('TURRET_PLAYER_HIT', resolveOwnerIndex(turret), turret.id);
    }
    if (damageResult?.isDead) {
        owner.recorder?.logEvent?.('TURRET_KILL', resolveOwnerIndex(turret), turret.id);
        owner._killPlayer?.(target, 'STATIC_TURRET_MG', {
            killer: turret.source,
            impactPoint: target.position,
            projectileType: 'STATIC_TURRET_MG',
        });
    }
}

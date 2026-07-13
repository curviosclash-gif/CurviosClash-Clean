import { isRocketTierType } from './RocketPickupSystem.js';

function shouldEmitLocalFeedback(event) {
    const sourcePlayer = event?.sourcePlayer || null;
    const target = event?.target || null;
    if (target && !target.isBot) return true;
    if (sourcePlayer && !sourcePlayer.isBot) return true;
    return !sourcePlayer && !!target;
}

function resolveHpDamage(damageResult) {
    const explicitHpApplied = Number(damageResult?.hpApplied);
    if (Number.isFinite(explicitHpApplied)) {
        return Math.max(0, explicitHpApplied);
    }
    const requested = Math.max(0, Number(damageResult?.applied) || 0);
    const absorbed = Math.max(0, Number(damageResult?.absorbedByShield) || 0);
    return Math.max(0, requested - absorbed);
}

function resolveImpactPoint(event) {
    return event?.impactPoint || event?.target?.position || null;
}

function resolveAudioIntensity(totalDamage) {
    return Math.max(0.3, Math.min(1, totalDamage / 40));
}

export function emitHuntDamageFeedback(event, services = {}) {
    if (!shouldEmitLocalFeedback(event)) return;

    const audio = services.audio || null;
    const particles = services.particles || null;
    if (!audio && !particles) return;

    const damageResult = event?.damageResult || {};
    const absorbedByShield = Math.max(0, Number(damageResult.absorbedByShield) || 0);
    const hpDamage = resolveHpDamage(damageResult);
    const totalDamage = Math.max(absorbedByShield, hpDamage);
    const impactPoint = resolveImpactPoint(event);
    const target = event?.target || null;

    if (absorbedByShield > 0 && impactPoint) {
        const shieldBroken = !target?.hasShield || (Number(target?.shieldHP) || 0) <= 0;
        particles?.spawnShieldImpact(impactPoint, target?.color, { broken: shieldBroken });
        audio?.play('SHIELD_HIT', {
            intensity: resolveAudioIntensity(absorbedByShield),
            depleted: shieldBroken,
        });
    }

    if (hpDamage <= 0 || !impactPoint) {
        return;
    }

    const cause = String(event?.cause || '').toUpperCase();
    if (cause === 'MG_BULLET') {
        particles?.spawnMgImpact(impactPoint, event?.sourcePlayer?.color);
        audio?.play('MG_HIT', { intensity: resolveAudioIntensity(totalDamage) });
        return;
    }

    if (isRocketTierType(event?.projectileType)) {
        return;
    }

    if (
        cause === 'WALL'
        || cause === 'PROJECTILE'
        || cause === 'TRAIL'
        || cause === 'TRAIL_SELF'
        || cause === 'TRAIL_OTHER'
    ) {
        particles?.spawnHit(impactPoint, target?.color);
        audio?.play('HIT', { intensity: resolveAudioIntensity(totalDamage) });
    }
}

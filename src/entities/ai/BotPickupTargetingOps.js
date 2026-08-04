import { getPickupDefinition } from '../PickupRegistry.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';

function healthRatio(player) {
    const maxHp = Math.max(1, Number(player?.maxHp) || 1);
    return Math.max(0, Math.min(1, (Number(player?.hp) || 0) / maxHp));
}

function hasDebuff(player) {
    return (player?.activeEffects || []).some(
        (effect) => getPickupDefinition(effect?.type)?.actionRole === 'debuff'
    );
}

export function findPreferredPickupTarget(player, runtimeContext, {
    pressure = 0,
    maxDistance = 90,
} = {}) {
    const inventory = Array.isArray(player?.inventory) ? player.inventory : [];
    const capacity = Math.max(1, Number(resolveGameplayConfig(player).POWERUP?.MAX_INVENTORY) || 1);
    if (!player?.position || inventory.length >= capacity) return null;

    const pickups = Array.isArray(runtimeContext?.powerups) ? runtimeContext.powerups : [];
    const hpRatio = healthRatio(player);
    const urgent = pressure >= 0.7;
    const maxDistanceSq = maxDistance * maxDistance;
    let best = null;
    let bestScore = 0;
    for (const item of pickups) {
        if (!item?.mesh?.position || item.predictedCollected || item.telegraphRemaining > 0) continue;
        const definition = getPickupDefinition(item.type);
        if (!definition) continue;
        const distanceSq = player.position.distanceToSquared(item.mesh.position);
        if (distanceSq > maxDistanceSq) continue;

        let need = 0.35;
        if (item.type === 'HEALTH') need += (1 - hpRatio) * 2.4;
        else if (item.type === 'SHIELD') need += player.hasShield ? -0.3 : 1.0;
        else if (item.type === 'PURGE') need += hasDebuff(player) ? 1.4 : -0.2;
        else if (item.type === 'TRAIL_GAP' || item.type === 'GHOST') need += pressure * 0.9;
        else if (definition.offensive) need += runtimeContext?.players?.length > 1 ? 0.45 : 0;
        if (urgent && !['HEALTH', 'SHIELD', 'PURGE', 'TRAIL_GAP', 'GHOST'].includes(item.type)) {
            need -= 0.8;
        }
        const score = need + (1 - distanceSq / maxDistanceSq) * 0.75;
        if (score > bestScore) {
            best = item;
            bestScore = score;
        }
    }
    return best;
}

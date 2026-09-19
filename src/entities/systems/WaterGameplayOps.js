import { extinguishBurning } from '../player/PlayerEffectOps.js';

function positiveMultiplier(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
}

export function resolveWaterAdjustedDelta(waterZoneSystem, position, deltaSeconds) {
    const seconds = Math.max(0, Number(deltaSeconds) || 0);
    if (waterZoneSystem?.isPositionUnderwater?.(position) !== true) return seconds;
    return seconds * positiveMultiplier(waterZoneSystem?.getEffects?.()?.projectileSpeedMultiplier);
}

export function resolveWaterWeaponCooldown(player, cooldownSeconds) {
    const seconds = Math.max(0, Number(cooldownSeconds) || 0);
    if (player?.waterSubmerged !== true) return seconds;
    return seconds / positiveMultiplier(player.waterProjectileSpeedMultiplier);
}

export function applyWaterGameplayState(player, waterZoneSystem, deltaSeconds = 0) {
    if (!player) return false;
    const submerged = waterZoneSystem?.isPositionUnderwater?.(player.position) === true;
    const effects = submerged ? waterZoneSystem?.getEffects?.() : null;

    player.waterSubmerged = submerged;
    player.waterSpeedMultiplier = submerged ? positiveMultiplier(effects?.speedMultiplier) : 1;
    player.waterTurnMultiplier = submerged ? positiveMultiplier(effects?.turnMultiplier) : 1;
    player.waterVisibilityMultiplier = submerged ? positiveMultiplier(effects?.visibilityMultiplier) : 1;
    player.waterProjectileSpeedMultiplier = submerged
        ? positiveMultiplier(effects?.projectileSpeedMultiplier)
        : 1;
    player.waterBuoyancy = submerged ? Math.max(0, Number(effects?.buoyancy) || 0) : 0;

    if (!submerged) return false;
    if (effects?.extinguishesFire !== false) {
        player.flameActive = false;
        extinguishBurning(player);
    }
    if (effects?.createTrails === false && player.trail) {
        player.trail.forceGap?.(Math.max(0.1, Math.max(0, Number(deltaSeconds) || 0) * 2));
    }
    return true;
}

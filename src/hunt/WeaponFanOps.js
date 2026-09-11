import {
    getPickupDefinition,
    isPickupTypeAllowedForMode,
} from '../shared/contracts/PickupRegistryContract.js';

export const WEAPON_FAN_MAX_PROJECTILES = 12;
export const WEAPON_FAN_TOTAL_ANGLE_RADIANS = Math.PI / 6;

export function resolveWeaponFanProjectileCount(activeEffects, modeType = 'HUNT') {
    if (String(modeType || '').trim().toUpperCase() !== 'HUNT' || !Array.isArray(activeEffects)) return 1;
    let total = 0;
    for (let i = 0; i < activeEffects.length; i += 1) {
        const effect = activeEffects[i];
        if (!effect || Number(effect.remaining) <= 0 || !isPickupTypeAllowedForMode(effect.type, 'HUNT')) continue;
        const fanProjectiles = Number(getPickupDefinition(effect.type)?.fanProjectiles);
        if (Number.isFinite(fanProjectiles) && fanProjectiles > 0) total += Math.floor(fanProjectiles);
    }
    return total > 0 ? Math.min(WEAPON_FAN_MAX_PROJECTILES, total) : 1;
}

export function resolveWeaponFanAngleRadians(index, projectileCount) {
    const count = Math.max(1, Math.floor(Number(projectileCount) || 1));
    if (count === 1) return 0;
    const clampedIndex = Math.max(0, Math.min(count - 1, Math.floor(Number(index) || 0)));
    return -WEAPON_FAN_TOTAL_ANGLE_RADIANS * 0.5
        + (WEAPON_FAN_TOTAL_ANGLE_RADIANS * clampedIndex) / (count - 1);
}

export function applyWeaponFanDirection(centerDirection, fanAxis, index, projectileCount, out) {
    out.copy(centerDirection);
    const angle = resolveWeaponFanAngleRadians(index, projectileCount);
    if (angle !== 0) out.applyAxisAngle(fanAxis, angle);
    return out.normalize();
}

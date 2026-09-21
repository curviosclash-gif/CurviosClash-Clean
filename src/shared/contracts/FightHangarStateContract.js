import { FIGHT_HANGAR_STAT_LIMITS } from './FightHangarBalanceContract.js';
import { normalizeFightMachineGunId } from './FightMachineGunContract.js';

const VEHICLE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UNSAFE_KEYS = new Set(['constructor', 'prototype', '__proto__']);

function normalizeBonus(value, limits) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.max(limits.min, Math.min(limits.max, Math.round(number * 10) / 10));
}

export function normalizeFightHangarState(source = null) {
    const entries = source?.activeBonusesByVehicle;
    const activeBonusesByVehicle = {};
    if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
        let acceptedCount = 0;
        for (const [vehicleId, bonuses] of Object.entries(entries)) {
            if (acceptedCount >= 64) break;
            if (!VEHICLE_ID_PATTERN.test(vehicleId) || UNSAFE_KEYS.has(vehicleId)) continue;
            const value = bonuses && typeof bonuses === 'object' && !Array.isArray(bonuses) ? bonuses : {};
            activeBonusesByVehicle[vehicleId] = {
                speedBonusPct: normalizeBonus(value.speedBonusPct, FIGHT_HANGAR_STAT_LIMITS.speedBonusPct),
                turningBonusPct: normalizeBonus(value.turningBonusPct, FIGHT_HANGAR_STAT_LIMITS.turningBonusPct),
                maxHpBonus: normalizeBonus(value.maxHpBonus, FIGHT_HANGAR_STAT_LIMITS.maxHpBonus),
                machineGunId: normalizeFightMachineGunId(value.machineGunId),
            };
            acceptedCount += 1;
        }
    }
    return { activeBonusesByVehicle };
}

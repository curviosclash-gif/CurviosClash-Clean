import {
    addXp,
    getOrCreateProfile,
    loadVehicleProfiles,
    saveVehicleProfiles,
} from './ArcadeVehicleProfile.js';

export const ARCADE_VEHICLE_XP_RUN_TYPES = Object.freeze([
    'gauntlet',
    'endless_parcours',
    'five_portals',
    'arena_waves',
    'weapon_race',
]);

const ARCADE_VEHICLE_XP_RUN_TYPE_SET = new Set(ARCADE_VEHICLE_XP_RUN_TYPES);

export function bindArcadeVehicleRewards({ runType, vehicleId } = {}) {
    const normalizedRunType = String(runType || '').trim().toLowerCase();
    if (!ARCADE_VEHICLE_XP_RUN_TYPE_SET.has(normalizedRunType)) return null;
    return Object.freeze({
        runType: normalizedRunType,
        vehicleId: String(vehicleId || 'ship1').trim() || 'ship1',
    });
}

export function awardBoundArcadeVehicleXp(profiles, binding, amount, nowMs = Date.now()) {
    if (!profiles || typeof profiles !== 'object' || !binding) return null;
    if (!ARCADE_VEHICLE_XP_RUN_TYPE_SET.has(String(binding.runType || ''))) return null;
    const vehicleId = String(binding.vehicleId || '').trim();
    const earned = Math.max(0, Number(amount) || 0);
    if (!vehicleId || earned <= 0) return null;

    const result = addXp(getOrCreateProfile(profiles, vehicleId, nowMs), earned, nowMs);
    profiles[vehicleId] = result.profile;
    return {
        ...result,
        earned,
        vehicleId,
    };
}

export function awardBoundArcadeVehicleXpInStore(store, binding, amount, nowMs = Date.now()) {
    if (!store?.loadJsonRecord || !store?.saveJsonRecord) return null;
    const profiles = loadVehicleProfiles(store);
    const result = awardBoundArcadeVehicleXp(profiles, binding, amount, nowMs);
    if (!result) return null;
    return {
        ...result,
        persisted: saveVehicleProfiles(store, profiles) !== false,
    };
}

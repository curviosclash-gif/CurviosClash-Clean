import {
    addXp,
    getOrCreateProfile,
    loadVehicleProfiles,
    saveVehicleProfiles,
} from './ArcadeVehicleProfile.js';
import { loadArcadeVehicleProfileRecord } from '../../shared/contracts/ArcadeVehicleProfileContract.js';

export const ARCADE_VEHICLE_XP_RUN_TYPES = Object.freeze([
    'gauntlet',
    'endless_parcours',
    'five_portals',
    'arena_waves',
    'weapon_race',
    'demolition',
    'hunt_parcours',
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
    if (!store?.loadJsonRecord || !store?.saveJsonRecord || !binding) return null;
    const record = loadArcadeVehicleProfileRecord(store);
    // An opaque future/malformed target survives the save merge unchanged. Saving
    // that record successfully must never be mistaken for persisting new XP.
    if (!record.canPersist || Object.hasOwn(record.preservedProfiles || {}, binding.vehicleId)) return null;
    const profiles = loadVehicleProfiles(store);
    const result = awardBoundArcadeVehicleXp(profiles, binding, amount, nowMs);
    if (!result) return null;
    const saveResult = saveVehicleProfiles(store, profiles);
    return {
        ...result,
        persisted: saveResult === true || saveResult?.success === true || saveResult?.ok === true,
    };
}

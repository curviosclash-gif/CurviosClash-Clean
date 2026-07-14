import {
    ARCADE_VEHICLE_PROFILE_MAX_LEVEL,
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    getArcadeVehicleProfileRecord,
    readArcadeVehicleProfileRecord,
} from '../../shared/contracts/ArcadeVehicleProfileContract.js';
import { createDefaultHangarBuild, normalizeHangarBuild } from './HangarBuildDraftState.js';

const HITBOX_TO_CONTRACT = Object.freeze({ kompakt: 'compact', standard: 'standard', schwer: 'heavy' });

export function createFallbackProfilePort(store) {
    const xpForLevel = (level) => level <= 1 ? 0 : Math.floor(100 * Math.pow(level, 1.5));
    return Object.freeze({
        load() {
            const raw = store?.loadJsonRecord?.(ARCADE_VEHICLE_PROFILE_STORAGE_KEY, {}) || {};
            return readArcadeVehicleProfileRecord(raw).profiles;
        },
        save(profiles) { return store?.saveJsonRecord?.(ARCADE_VEHICLE_PROFILE_STORAGE_KEY, profiles); },
        getOrCreate: (profiles, vehicleId) => getArcadeVehicleProfileRecord(profiles, vehicleId),
        getSpendableUpgradeXp: (profile) => Math.max(0, Number(profile?.xpBank ?? profile?.xp) || 0),
        xpForLevel,
        xpToNextLevel(profile) {
            const level = Math.max(1, Math.min(ARCADE_VEHICLE_PROFILE_MAX_LEVEL, Number(profile?.level) || 1));
            if (level >= ARCADE_VEHICLE_PROFILE_MAX_LEVEL) return { current: 0, required: 0, progress: 1 };
            const floor = xpForLevel(level);
            const required = xpForLevel(level + 1) - floor;
            const current = Math.max(0, (Number(profile?.xp) || 0) - floor);
            return { current, required, progress: required > 0 ? Math.min(1, current / required) : 1 };
        },
    });
}

export function mapHangarHitboxClass(entry) {
    return HITBOX_TO_CONTRACT[String(entry?.hitboxKlasse || '').toLowerCase()] || 'standard';
}

export function createHangarBuildFromProfile(vehicleId, entry, profile) {
    return normalizeHangarBuild({
        ...createDefaultHangarBuild(vehicleId, { hitboxClass: mapHangarHitboxClass(entry) }),
        upgrades: profile?.upgrades || {},
    });
}

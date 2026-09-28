import {
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    arcadeVehicleXpForLevel as xpForLevel,
    clampArcadeProfileCount,
    getArcadeVehicleProfileRecord,
    loadArcadeVehicleProfileRecord,
} from '../../shared/contracts/ArcadeVehicleProfileContract.js';
import { createDefaultHangarBuild, normalizeHangarBuild } from './HangarBuildDraftState.js';

const HITBOX_TO_CONTRACT = Object.freeze({ kompakt: 'compact', standard: 'standard', schwer: 'heavy' });

export function createFallbackProfilePort(store) {
    return Object.freeze({
        load() {
            return loadArcadeVehicleProfileRecord(store).profiles;
        },
        save(profiles) { return store?.saveJsonRecord?.(ARCADE_VEHICLE_PROFILE_STORAGE_KEY, profiles); },
        getOrCreate: (profiles, vehicleId) => getArcadeVehicleProfileRecord(profiles, vehicleId),
        getSpendableUpgradeXp: (profile) => Math.max(0, Number(profile?.xpBank ?? profile?.xp) || 0),
        xpForLevel,
        xpToNextLevel(profile) {
            const level = Math.max(1, clampArcadeProfileCount(profile?.level, 1));
            const floor = xpForLevel(level);
            const required = xpForLevel(level + 1) - floor;
            const current = Math.max(0, clampArcadeProfileCount(profile?.xp) - floor);
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

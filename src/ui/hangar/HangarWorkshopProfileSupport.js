import {
    arcadeVehicleXpForLevel as xpForLevel,
    clampArcadeProfileCount,
    getArcadeVehicleProfileRecord,
    loadArcadeVehicleProfileRecord,
} from '../../shared/contracts/ArcadeVehicleProfileContract.js';
import { saveVehicleProfiles } from '../../state/arcade/ArcadeVehicleProfile.js';
import { createDefaultHangarBuild, normalizeHangarBuild } from './HangarBuildDraftState.js';

const HITBOX_TO_CONTRACT = Object.freeze({ kompakt: 'compact', standard: 'standard', schwer: 'heavy' });

export function createFallbackProfilePort(store) {
    return Object.freeze({
        load() {
            return loadArcadeVehicleProfileRecord(store).profiles;
        },
        save(profiles) { return saveVehicleProfiles(store, profiles); },
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

// Arcade catalog entries carry a fixed role instead of the old hitbox class. The build chassis
// classes compact/standard/heavy belong to Lab builds (Paket 6), so factory ships use standard.
export function mapHangarHitboxClass(entry) {
    if (entry?.rolle) return 'standard';
    return HITBOX_TO_CONTRACT[String(entry?.hitboxKlasse || '').toLowerCase()] || 'standard';
}

export function createHangarBuildFromProfile(vehicleId, entry, profile) {
    return normalizeHangarBuild({
        ...createDefaultHangarBuild(vehicleId, { hitboxClass: mapHangarHitboxClass(entry) }),
        upgrades: profile?.upgrades || {},
    });
}

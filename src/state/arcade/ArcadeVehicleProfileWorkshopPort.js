import {
    getOrCreateProfile,
    getSpendableUpgradeXp,
    loadVehicleProfiles,
    saveVehicleProfiles,
    xpForLevel,
    xpToNextLevel,
} from './ArcadeVehicleProfile.js';

export function createArcadeVehicleProfileWorkshopPort(store) {
    return Object.freeze({
        load: () => loadVehicleProfiles(store),
        save(profiles) {
            saveVehicleProfiles(store, profiles);
            return true;
        },
        getOrCreate: (profiles, vehicleId) => getOrCreateProfile(profiles, vehicleId),
        getSpendableUpgradeXp,
        xpForLevel,
        xpToNextLevel,
    });
}

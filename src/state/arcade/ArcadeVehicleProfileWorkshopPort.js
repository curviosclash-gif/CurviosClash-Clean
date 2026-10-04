import {
    getOrCreateProfile,
    getSpendableUpgradeXp,
    loadVehicleProfiles,
    saveVehicleProfiles,
    xpForLevel,
    xpToNextLevel,
} from './ArcadeVehicleProfile.js';
import { syncArcadeLabUnlock } from '../../shared/contracts/ArcadeLabUnlockContract.js';

export function createArcadeVehicleProfileWorkshopPort(store) {
    return Object.freeze({
        load: () => loadVehicleProfiles(store),
        save: (profiles) => {
            const result = saveVehicleProfiles(store, profiles);
            const saved = result === true || result?.success === true || result?.ok === true;
            if (saved) syncArcadeLabUnlock(store, profiles);
            return saved;
        },
        getOrCreate: (profiles, vehicleId) => getOrCreateProfile(profiles, vehicleId),
        getSpendableUpgradeXp,
        xpForLevel,
        xpToNextLevel,
    });
}

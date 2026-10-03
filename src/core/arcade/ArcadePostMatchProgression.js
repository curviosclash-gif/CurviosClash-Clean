import { listArcadeStoneUnlocksBetween } from '../../shared/contracts/ArcadeStoneWorkshopContract.js';
import {
    ARCADE_TRAIL_STYLE_LABELS,
    ARCADE_TRAIL_STYLE_UNLOCKS,
    ARCADE_WEAPON_STYLE_LABELS,
    ARCADE_WEAPON_STYLE_UNLOCKS,
} from '../../shared/contracts/ArcadeVehicleCosmeticContract.js';
import { arcadeVehicleLevelForXp as levelForXp } from '../../shared/contracts/ArcadeVehicleProfileContract.js';
import { getOrCreateProfile, loadVehicleProfiles } from '../../state/arcade/ArcadeVehicleProfile.js';

function cosmeticUnlocks(priorLevel, newLevel) {
    const unlocked = [];
    for (const [styleId, level] of Object.entries(ARCADE_TRAIL_STYLE_UNLOCKS)) {
        if (level > priorLevel && level <= newLevel) unlocked.push(`Spur ${ARCADE_TRAIL_STYLE_LABELS[styleId]}`);
    }
    for (const [styleId, level] of Object.entries(ARCADE_WEAPON_STYLE_UNLOCKS)) {
        if (level > priorLevel && level <= newLevel) unlocked.push(`Waffenstil ${ARCADE_WEAPON_STYLE_LABELS[styleId]}`);
    }
    return unlocked;
}

export function resolveArcadePostMatchProgression(store, runState = null) {
    const vehicleId = String(runState?.vehicleId || '').trim();
    const xpEarned = Math.max(0, Number(runState?.xpEarned ?? runState?.postRunSummary?.xpEarned) || 0);
    if (!vehicleId || !store?.loadJsonRecord) return null;
    const profile = getOrCreateProfile(loadVehicleProfiles(store), vehicleId);
    const newLevel = Math.max(1, Number(profile.level) || 1);
    const priorLevel = levelForXp(Math.max(0, Number(profile.xp) - xpEarned));
    // Paket 3: the level-up opens stone slot packages for purchase and makes stone tiers usable.
    const stoneUnlocks = listArcadeStoneUnlocksBetween(priorLevel, newLevel);
    return {
        vehicleId,
        xpEarned,
        priorLevel,
        newLevel,
        xpBank: Math.max(0, Number(profile.xpBank) || 0),
        unlockedStonePackages: stoneUnlocks.packages,
        unlockedStoneTiers: stoneUnlocks.tiers,
        unlockedCosmetics: cosmeticUnlocks(priorLevel, newLevel),
    };
}

import { resolveArcadeHangarProgressionSnapshot } from '../../shared/contracts/ArcadeHangarRulesContract.js';
import {
    ARCADE_TRAIL_STYLE_LABELS,
    ARCADE_TRAIL_STYLE_UNLOCKS,
    ARCADE_WEAPON_STYLE_LABELS,
    ARCADE_WEAPON_STYLE_UNLOCKS,
} from '../../shared/contracts/ArcadeVehicleCosmeticContract.js';
import { getOrCreateProfile, loadVehicleProfiles, xpForLevel, XP_CONFIG } from '../../state/arcade/ArcadeVehicleProfile.js';

function levelForXp(xp) {
    const value = Math.max(0, Number(xp) || 0);
    let level = 1;
    while (level < XP_CONFIG.MAX_LEVEL && value >= xpForLevel(level + 1)) level += 1;
    return level;
}
function difference(next, previous) {
    const oldValues = new Set(previous || []);
    return (next || []).filter((value) => !oldValues.has(value));
}

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
    const before = resolveArcadeHangarProgressionSnapshot(priorLevel);
    const after = resolveArcadeHangarProgressionSnapshot(newLevel);
    return {
        vehicleId,
        xpEarned,
        priorLevel,
        newLevel,
        xpBank: Math.max(0, Number(profile.xpBank) || 0),
        unlockedSlots: difference(after.unlockedSlots, before.unlockedSlots),
        unlockedTiers: difference(after.allowedTiers, before.allowedTiers),
        unlockedFamilies: difference(after.allowedPartFamilies, before.allowedPartFamilies),
        unlockedCosmetics: cosmeticUnlocks(priorLevel, newLevel),
    };
}

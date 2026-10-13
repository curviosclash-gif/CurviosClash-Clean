import { listArcadeStoneUnlocksBetween } from '../../shared/contracts/ArcadeStoneWorkshopContract.js';
import { ARCADE_TRAIL_STYLE_LABELS } from '../../shared/contracts/ArcadeVehicleCosmeticContract.js';
import { arcadeVehicleLevelForXp as levelForXp } from '../../shared/contracts/ArcadeVehicleProfileContract.js';
import { createArcadeHangarGuideSnapshot } from '../../shared/contracts/ArcadeHangarGuideContract.js';
import { getOrCreateProfile, loadVehicleProfiles } from '../../state/arcade/ArcadeVehicleProfile.js';

function cosmeticUnlocks(priorLevel, newLevel) {
    const unlocked = [];
    for (let level = (Math.floor(priorLevel / 10) + 1) * 10; level <= newLevel && unlocked.length < 10; level += 10) unlocked.push(`Meilenstein Level ${level}: Titel und Abzeichen`);
    return unlocked;
}

export function resolveArcadePostMatchProgression(store, runState = null) {
    const vehicleId = String(runState?.vehicleId || '').trim();
    // xpEarned can include split-screen partners' planes; the level jump belongs to the run vehicle alone.
    const xpEarned = Math.max(0, Number(runState?.vehicleXpEarned ?? runState?.xpEarned ?? runState?.postRunSummary?.xpEarned) || 0);
    if (!vehicleId || !store?.loadJsonRecord) return null;
    const profiles = loadVehicleProfiles(store);
    const profile = getOrCreateProfile(profiles, vehicleId);
    const newLevel = Math.max(1, Number(profile.level) || 1);
    const priorLevel = levelForXp(Math.max(0, Number(profile.xp) - xpEarned));
    // Paket 3: the level-up opens stone slot packages for purchase and makes stone tiers usable.
    const stoneUnlocks = listArcadeStoneUnlocksBetween(priorLevel, newLevel);
    // This is a fresh post-run read: no transient Hangar draft or prior-visit announcements leak
    // into the match-end summary, while the existing Guide contracts choose the next goal.
    const hangarGuide = createArcadeHangarGuideSnapshot({
        store,
        profile,
        profiles,
        draft: null,
        previousVisitAt: 0,
    });
    return {
        vehicleId,
        xpEarned,
        priorLevel,
        newLevel,
        xpBank: Math.max(0, Number(profile.xpBank) || 0),
        unlockedStonePackages: stoneUnlocks.packages,
        unlockedStoneTiers: stoneUnlocks.tiers,
        offers: hangarGuide.offers,
        levelGates: hangarGuide.levelGates,
        hangarGuide,
        unlockedCosmetics: [...new Set(runState?.postRunSummary?.colorsUnlocked || [])].map(id => `Farbe ${ARCADE_TRAIL_STYLE_LABELS[id] || id}`).concat(cosmeticUnlocks(priorLevel, newLevel)),
    };
}

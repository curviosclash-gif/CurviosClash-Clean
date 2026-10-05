import { ARCADE_PART_SIZE_GROUPS } from '../../shared/contracts/ArcadeVehicleSizeContract.js';
import { normalizeArcadeSizeProfileFields, resolveArcadeSpendableXp, evaluateArcadeSizeUnlock, evaluateArcadeSizeStepPurchase, resolveArcadeStorageOffer } from '../../shared/contracts/ArcadeVehicleBuildContract.js';
import { ARCADE_STONE_SLOT_IDS, ARCADE_STONE_PACKAGE_IDS, readArcadeStoneWorkshopRecord, resolveArcadeStoneSlotStatus, evaluateArcadeStonePurchase, evaluateArcadeStoneSlotPackagePurchase, evaluateArcadeStoneUpgrade } from '../../shared/contracts/ArcadeStoneWorkshopContract.js';
import { ARCADE_COLOR_REQUIREMENTS, loadArcadeColors, listUnlockedArcadeColors } from '../../shared/contracts/ArcadeColorProgressContract.js';
import { loadArcadeDifficultyProgress, ARCADE_DIFFICULTY_TIERS } from '../../shared/contracts/ArcadeDifficultyContract.js';
import { evaluateArcadeLabUnlock, normalizeArcadeLabUnlockRecord, ARCADE_LAB_UNLOCK_STORAGE_KEY } from '../../shared/contracts/ArcadeLabUnlockContract.js';
import { arcadeVehicleXpForLevel } from '../../shared/contracts/ArcadeVehicleProfileContract.js';
import { ARCADE_MACHINE_GUN_MODELS, evaluateArcadeWeaponLevelPurchase, resolveArcadeMachineGunUnlockLevel } from '../../shared/contracts/ArcadeMachineGunContract.js';
import { toArcadeGuideTimeMs } from '../../shared/contracts/ArcadeHangarGuideContract.js';

/** Snapshot reads contracts only; it never initializes or saves records.
 * @param {{store:any, profile:any, profiles:any, draft:any, previousVisitAt:any}} options */
export function createHangarGuideSnapshot({ store, profile, profiles, draft, previousVisitAt }) {
    const previous = toArcadeGuideTimeMs(previousVisitAt);
    const isNew = value => Number.isFinite(previous) && previous > 0 && toArcadeGuideTimeMs(value) > previous;
    const sizes = normalizeArcadeSizeProfileFields(profile);
    const spent = ARCADE_PART_SIZE_GROUPS.reduce((sum, group) => sum + Math.max(0, (sizes.partSizes[group] - 100) / 5), 0);
    const read = readArcadeStoneWorkshopRecord(store);
    const available = read.status !== 'unavailable';
    const stones = read.pool?.stones || [];
    const draftStoneIds = new Set(Object.values(draft?.stoneSlots || {}).filter(Boolean));
    const unplacedCount = stones.filter(stone => !stone.placement && !draftStoneIds.has(stone.stoneId)).length;
    const freeSlots = ARCADE_STONE_SLOT_IDS.filter(id => resolveArcadeStoneSlotStatus(profile, id).unlocked && !draft?.stoneSlots?.[id]);
    const offers = [], levelGates = [];
    const offer = (id, system, areaId, label, result) => { if (result.cost > 0 && ['ok','insufficient_xp'].includes(result.reason)) offers.push({ id, system, areaId, label, costXp: result.cost }); };
    if (!sizes.sizeWorkshopUnlocked) offer('size-unlock', 'size', 'size', 'Größenumbau freischalten', evaluateArcadeSizeUnlock(profile));
    else {
        offer('size-step', 'size', 'size', 'Einen Größenschritt kaufen', evaluateArcadeSizeStepPurchase(profile));
        for (const storage of ['items','rockets']) {
            const next = resolveArcadeStorageOffer(profile, storage);
            if (next?.utilityReached) offers.push({ id: storage, system: 'storage', areaId: 'storage', label: `${storage === 'items' ? 'Item' : 'Raketen'}-Lager erweitern`, costXp: next.cost });
        }
    }
    const gate = (id, system, areaId, label, level) => { if (level > profile.level) levelGates.push({ id, system, areaId, label, xpNeeded: Math.max(0, arcadeVehicleXpForLevel(level) - profile.xp) }); };
    const milestoneLevel = Math.min(Number.MAX_SAFE_INTEGER, (Math.floor(profile.level / 10) + 1) * 10);
    gate('next-milestone', 'cosmetics', 'colors', `Nächsten Meilenstein auf Level ${milestoneLevel} erreichen`, milestoneLevel);
    for (const gun of ARCADE_MACHINE_GUN_MODELS) gate(`unlock-${gun.id}`, 'weapons', 'weapons', `${gun.label} freischalten`, resolveArcadeMachineGunUnlockLevel(profile.vehicleId, gun.id));
    if (available) {
        if (unplacedCount === 0 && freeSlots.length) offer('buy-stone', 'stones', 'stones', 'Einen Stein für eine freie Fassung kaufen', evaluateArcadeStonePurchase(read.pool, profile));
        for (const id of ARCADE_STONE_PACKAGE_IDS) {
            const result = evaluateArcadeStoneSlotPackagePurchase(profile, id);
            offer(`slots-${id}`, 'stones', 'stones', `Weitere ${id === 'wings' ? 'Flügel' : id === 'engines' ? 'Antrieb' : 'Utility'}-Fassungen kaufen`, result);
            if (result.reason === 'package_level_locked') gate(`slots-${id}`, 'stones', 'stones', `Neue Fassungen ab Level ${result.requiredLevel}`, result.requiredLevel);
        }
        for (const stone of stones.filter(stone => stone.placement?.vehicleId === profile.vehicleId || draftStoneIds.has(stone.stoneId))) {
            const result = evaluateArcadeStoneUpgrade(read.pool, profile, stone.stoneId);
            offer(`stone-${stone.stoneId}`, 'stones', 'stones', 'Einen eingebauten Stein aufwerten', result);
            if (result.reason === 'stone_level_locked') gate(`stone-${stone.stoneId}`, 'stones', 'stones', `Steine aufwerten ab Level ${result.requiredLevel}`, result.requiredLevel);
        }
    }
    for (const [kind, label] of [['mg', 'MG'], ['rocket', 'Raketen'], ['shield', 'Schild']]) {
        const result = evaluateArcadeWeaponLevelPurchase(profile, kind);
        if (result.cost > 0) offers.push({ id: `weapon-${kind}`, system: 'weapons', areaId: 'weapons', label: `${label} um eine Stufe ausbauen`, costXp: result.cost, finite: false });
    }
    const colors = loadArcadeColors(store);
    const unlockedColors = listUnlockedArcadeColors(colors);
    const missingColor = Object.keys(ARCADE_COLOR_REQUIREMENTS).find(id => !unlockedColors.includes(id));
    const difficulty = loadArcadeDifficultyProgress(store).progress;
    const newDifficulty = ARCADE_DIFFICULTY_TIERS.findLast(tier => difficulty?.unlockedTierIds.includes(tier.id) && isNew(difficulty.unlockedAt?.[tier.id]));
    let lab = null;
    try { lab = normalizeArcadeLabUnlockRecord(store?.loadJsonRecord?.(ARCADE_LAB_UNLOCK_STORAGE_KEY, null)); } catch { /* unavailable */ }
    const fleet = evaluateArcadeLabUnlock(profiles);
    return { vehicleId: profile.vehicleId, xpBank: resolveArcadeSpendableXp(profile),
        stones: { available, unplacedCount, freeSlotCount: freeSlots.length },
        size: { unlocked: sizes.sizeWorkshopUnlocked, freeSteps: Math.max(0, sizes.purchasedSizeSteps - spent), canPlace: ARCADE_PART_SIZE_GROUPS.some(group => sizes.partSizes[group] < 125) },
        offers, levelGates, newDifficulty, newColorIds: unlockedColors.filter(id => isNew(colors?.unlockedAt?.[id])),
        labUnlockedNew: lab?.unlocked === true && isNew(lab.unlockedAtMs), labUnlocked: lab?.unlocked === true, fleet,
        achievement: missingColor ? { id: missingColor, system: 'cosmetics', areaId: 'colors', label: `${missingColor[0].toUpperCase() + missingColor.slice(1)} freispielen`, detail: ARCADE_COLOR_REQUIREMENTS[missingColor] } : null,
        lockedSummary: `Hart/Albtraum: vorherige Stufe gewinnen (Gauntlet: 5 Sektoren, Arena: 8 abgeschlossene Wellen, Endless: 5). Lab: ${fleet.qualifiedIds.length}/${fleet.required} Werksschiffe in allen Gruppen bei 125 %.` };
}

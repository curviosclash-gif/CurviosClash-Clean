// Arcade Vehicle Profile: XP, mastery, unlocks and upgrade progression.

import {
    ARCADE_VEHICLE_PROFILE_MAX_LEVEL,
    ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION,
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    createArcadeVehicleProfileRecord,
    getArcadeVehicleProfileRecord,
    readArcadeVehicleProfileRecord,
} from '../../shared/contracts/ArcadeVehicleProfileContract.js';
import {
    ARCADE_HANGAR_SLOT_UNLOCK_GATES,
    resolveArcadeHangarProgressionSnapshot,
    resolveArcadeHangarUnlockedSlots,
} from '../../shared/contracts/ArcadeHangarRulesContract.js';
import { toSafeNumber, clampInteger as clampInt } from '../../shared/utils/ArcadeUtils.js';
import {
    buildUpgradeState,
    computeLevel,
    ensureProfile,
    isValidTier,
    normalizeSlotName,
    normalizeTier,
    normalizeVehicleProfile,
    profileEquals,
    resolveNextTier,
    resolveArcadeHangarPartFamily,
    toIsoString,
    toObject,
    warnPersistenceFailure,
    xpForLevel as xpForLevelInternal,
} from './ArcadeVehicleProfileInternals.js';

const VEHICLE_PROFILE_SCHEMA_VERSION = ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION;
const STORAGE_KEY = ARCADE_VEHICLE_PROFILE_STORAGE_KEY;
const MAX_UPGRADE_XP_BANK = 9_999_999;
const MAX_LOADOUT_PRESET_UPGRADE_ENTRIES = 64;

export const XP_CONFIG = Object.freeze({
    BASE_XP: 100,
    EXPONENT: 1.5,
    MAX_LEVEL: ARCADE_VEHICLE_PROFILE_MAX_LEVEL,
});

export const SLOT_UNLOCK_LEVELS = ARCADE_HANGAR_SLOT_UNLOCK_GATES;

export const XP_REWARD_TABLE = Object.freeze({
    sectorComplete: 50,
    killBase: 15,
    missionComplete: 80,
    allMissionsBonus: 120,
    cleanSector: 40,
    comboMultiplierCap: 3.0,
    parcoursCheckpoint: 10,
    parcoursFinish: 80,
    parcoursNewBestTime: 40,
});

export const UPGRADE_PURCHASE_CODES = Object.freeze({
    APPLIED: 'applied',
    INVALID_PROFILE: 'invalid_profile',
    INVALID_SLOT: 'invalid_slot',
    INVALID_TIER: 'invalid_tier',
    INVALID_TIER_SEQUENCE: 'invalid_tier_sequence',
    SLOT_LOCKED: 'slot_locked',
    PART_FAMILY_LOCKED: 'part_family_locked',
    TIER_LOCKED: 'tier_locked',
    LEVEL_LOCKED: 'level_locked',
    INSUFFICIENT_XP: 'insufficient_xp',
    COST_INVALID: 'cost_invalid',
});

function normalizeVehicleProfileSafe(profile) {
    return normalizeVehicleProfile(profile, {
        xpConfig: XP_CONFIG,
        maxUpgradeXpBank: MAX_UPGRADE_XP_BANK,
    });
}

function ensureProfileSafe(profile) {
    return ensureProfile(profile, {
        xpConfig: XP_CONFIG,
        maxUpgradeXpBank: MAX_UPGRADE_XP_BANK,
    });
}

function buildUpgradeStateSafe(profile, slotName, targetTier) {
    return buildUpgradeState(profile, slotName, targetTier, {
        xpConfig: XP_CONFIG,
        maxUpgradeXpBank: MAX_UPGRADE_XP_BANK,
        upgradePurchaseCodes: UPGRADE_PURCHASE_CODES,
    });
}


// XP Curve

export function xpForLevel(level) {
    return xpForLevelInternal(level, XP_CONFIG);
}

export function xpToNextLevel(profile) {
    if (!profile || typeof profile !== 'object') return { current: 0, required: 100, progress: 0 };
    const normalized = normalizeVehicleProfileSafe(profile);
    const level = clampInt(normalized.level, 1, XP_CONFIG.MAX_LEVEL, 1);
    if (level >= XP_CONFIG.MAX_LEVEL) return { current: 0, required: 0, progress: 1 };
    const currentLevelXp = xpForLevel(level);
    const nextLevelXp = xpForLevel(level + 1);
    const required = nextLevelXp - currentLevelXp;
    const current = Math.max(0, toSafeNumber(normalized.xp, 0) - currentLevelXp);
    return {
        current,
        required,
        progress: required > 0 ? Math.min(1, current / required) : 1,
    };
}


// Slot stat bonuses

export function getSlotStatBonuses(upgrades) {
    const u = upgrades && typeof upgrades === 'object' ? upgrades : {};
    const hasWingT2 = u.wing_left_t2 === 'T2' || u.wing_right_t2 === 'T2';
    const hasEngineT2 = u.engine_left_t2 === 'T2' || u.engine_right_t2 === 'T2';
    const hasCoreT2 = u.core_t2 === 'T2';
    return {
        turningBonusPct: hasWingT2 ? 10 : 0,
        speedBonusPct: hasEngineT2 ? 8 : 0,
        maxHpBonus: hasCoreT2 ? 15 : 0,
    };
}

// Mastery perks

export function getMasteryPerks(level) {
    const lvl = Math.max(1, Math.floor(clampInt(level, 1, XP_CONFIG.MAX_LEVEL, 1)));
    const perks = {
        scoreBonusPct: 0,
        comboDecaySlowPct: 0,
        xpBonusPct: 0,
    };
    if (lvl >= 5) perks.scoreBonusPct = 5;
    if (lvl >= 10) perks.comboDecaySlowPct = 20;
    if (lvl >= 15) perks.xpBonusPct = 10;
    return perks;
}

// Slot unlocks

export function getUnlockedSlots(level) {
    return resolveArcadeHangarUnlockedSlots(level);
}

// Profile CRUD

export function createArcadeVehicleProfile(vehicleId, nowMs = Date.now()) {
    const base = createArcadeVehicleProfileRecord(vehicleId, nowMs);
    return normalizeVehicleProfileSafe(base);
}

export function addXp(profile, amount, nowMs = Date.now()) {
    if (!profile || typeof profile !== 'object') {
        return {
            profile,
            leveledUp: false,
            newLevel: 1,
            unlocksGained: [],
            partFamiliesGained: [],
            tiersGained: [],
            masteryMilestonesGained: [],
            xpBank: 0,
        };
    }
    const normalized = normalizeVehicleProfileSafe(profile);
    const prevLevel = clampInt(normalized.level, 1, XP_CONFIG.MAX_LEVEL, 1);
    const gain = Math.max(0, toSafeNumber(amount, 0));
    const totalXp = Math.max(0, toSafeNumber(normalized.xp, 0) + gain);
    const newLevel = computeLevel(totalXp, XP_CONFIG);
    const leveledUp = newLevel > prevLevel;

    const prevSnapshot = resolveArcadeHangarProgressionSnapshot(prevLevel);
    const nextSnapshot = resolveArcadeHangarProgressionSnapshot(newLevel);

    const prevSlots = new Set(prevSnapshot.unlockedSlots);
    const nextSlots = nextSnapshot.unlockedSlots.slice();
    const unlocksGained = nextSlots.filter((slotId) => !prevSlots.has(slotId));

    const prevPartFamilies = new Set(prevSnapshot.allowedPartFamilies);
    const partFamiliesGained = nextSnapshot.allowedPartFamilies.filter((familyId) => !prevPartFamilies.has(familyId));

    const prevTiers = new Set(prevSnapshot.allowedTiers);
    const tiersGained = nextSnapshot.allowedTiers.filter((tierId) => !prevTiers.has(tierId));

    const prevMilestones = new Set(prevSnapshot.masteryMilestones);
    const masteryMilestonesGained = nextSnapshot.masteryMilestones.filter((milestoneId) => !prevMilestones.has(milestoneId));

    const xpBank = clampInt((toSafeNumber(normalized.xpBank, 0) + gain), 0, MAX_UPGRADE_XP_BANK, 0);
    const priorTotalXpEarned = Math.max(
        toSafeNumber(normalized.totalXpEarned, normalized.xp),
        toSafeNumber(normalized.xp, 0)
    );
    return {
        profile: {
            ...normalized,
            xp: totalXp,
            level: newLevel,
            unlockedSlots: nextSnapshot.unlockedSlots.slice(),
            unlockedPartFamilies: nextSnapshot.allowedPartFamilies.slice(),
            unlockedUpgradeTiers: nextSnapshot.allowedTiers.slice(),
            masteryMilestones: nextSnapshot.masteryMilestones.slice(),
            xpBank,
            totalXpEarned: Math.max(totalXp, priorTotalXpEarned + gain),
            updatedAt: toIsoString(nowMs),
        },
        leveledUp,
        newLevel,
        unlocksGained,
        partFamiliesGained,
        tiersGained,
        masteryMilestonesGained,
        xpBank,
    };
}

export function applyUpgrade(profile, slotName, tier, nowMs = Date.now()) {
    if (!profile || typeof profile !== 'object') return profile;
    const normalized = normalizeVehicleProfileSafe(profile);
    const slotKey = normalizeSlotName(slotName);
    if (!slotKey) return normalized;
    const upgrades = { ...normalized.upgrades };
    upgrades[slotKey] = normalizeTier(tier);
    return normalizeVehicleProfileSafe({
        ...normalized,
        upgrades,
        upgradesApplied: Math.max(0, toSafeNumber(normalized.upgradesApplied, 0)),
        updatedAt: toIsoString(nowMs),
    });
}

export function evaluateUpgradePurchase(profile, slotName, targetTier) {
    return buildUpgradeStateSafe(profile, slotName, targetTier);
}

export function purchaseUpgrade(profile, slotName, targetTier, nowMs = Date.now()) {
    const upgradeState = buildUpgradeStateSafe(profile, slotName, targetTier);
    if (!upgradeState.ok) {
        return {
            ...upgradeState,
            profile: upgradeState.profile,
        };
    }

    const normalized = upgradeState.profile;
    const upgrades = { ...toObject(normalized.upgrades) };
    upgrades[upgradeState.slotName] = upgradeState.targetTier;
    const nextProfile = normalizeVehicleProfileSafe({
        ...normalized,
        upgrades,
        xpBank: Math.max(0, upgradeState.spendableXp - upgradeState.cost),
        spentUpgradeXp: Math.max(0, toSafeNumber(normalized.spentUpgradeXp, 0) + upgradeState.cost),
        upgradesApplied: Math.max(0, toSafeNumber(normalized.upgradesApplied, 0)) + 1,
        lastUpgrade: {
            slotName: upgradeState.slotName,
            tier: upgradeState.targetTier,
            cost: upgradeState.cost,
            at: toIsoString(nowMs),
        },
        updatedAt: toIsoString(nowMs),
    });

    return {
        ...upgradeState,
        ok: true,
        code: UPGRADE_PURCHASE_CODES.APPLIED,
        profile: nextProfile,
        remainingXp: nextProfile.xpBank,
    };
}

export function getSpendableUpgradeXp(profile) {
    const normalized = ensureProfileSafe(profile);
    return Math.max(0, toSafeNumber(normalized?.xpBank, 0));
}

export function sanitizeLoadoutPresetUpgrades(profile, upgrades) {
    const normalizedProfile = ensureProfileSafe(profile);
    if (!normalizedProfile) {
        return {
            upgrades: {},
            rejectedEntries: [{
                slotName: '',
                targetTier: 'T1',
                code: UPGRADE_PURCHASE_CODES.INVALID_PROFILE,
            }],
            acceptedCount: 0,
        };
    }

    const source = toObject(upgrades);
    const entries = Object.entries(source).slice(0, MAX_LOADOUT_PRESET_UPGRADE_ENTRIES);
    const rejectedEntries = [];
    let simulatedProfile = normalizeVehicleProfileSafe({
        ...normalizedProfile,
        upgrades: {},
        xpBank: MAX_UPGRADE_XP_BANK,
    });

    for (let index = 0; index < entries.length; index += 1) {
        const [rawSlotName, rawTargetTier] = entries[index];
        const slotName = normalizeSlotName(rawSlotName);
        const targetTier = normalizeTier(rawTargetTier);

        if (!slotName || !resolveArcadeHangarPartFamily(slotName)) {
            rejectedEntries.push({
                slotName,
                targetTier,
                code: UPGRADE_PURCHASE_CODES.INVALID_SLOT,
            });
            continue;
        }
        if (!isValidTier(targetTier)) {
            rejectedEntries.push({
                slotName,
                targetTier,
                code: UPGRADE_PURCHASE_CODES.INVALID_TIER,
            });
            continue;
        }
        if (targetTier === 'T1') {
            continue;
        }

        let currentTier = 'T1';
        let blockedCode = '';
        while (currentTier !== targetTier) {
            const nextTier = resolveNextTier(currentTier);
            if (!nextTier) {
                blockedCode = UPGRADE_PURCHASE_CODES.INVALID_TIER_SEQUENCE;
                break;
            }
            const upgradeResult = purchaseUpgrade(simulatedProfile, slotName, nextTier, 0);
            if (!upgradeResult.ok) {
                blockedCode = upgradeResult.code || UPGRADE_PURCHASE_CODES.INVALID_TIER_SEQUENCE;
                break;
            }
            simulatedProfile = upgradeResult.profile;
            currentTier = nextTier;
        }

        if (blockedCode) {
            rejectedEntries.push({
                slotName,
                targetTier,
                code: blockedCode,
            });
        }
    }

    return {
        upgrades: { ...toObject(simulatedProfile.upgrades) },
        rejectedEntries,
        acceptedCount: Object.keys(toObject(simulatedProfile.upgrades)).length,
    };
}

export function applyLoadoutPreset(profile, upgrades, nowMs = Date.now()) {
    const normalizedProfile = ensureProfileSafe(profile);
    if (!normalizedProfile) {
        return {
            profile: profile || null,
            upgrades: {},
            rejectedEntries: [{
                slotName: '',
                targetTier: 'T1',
                code: UPGRADE_PURCHASE_CODES.INVALID_PROFILE,
            }],
            acceptedCount: 0,
        };
    }

    const sanitized = sanitizeLoadoutPresetUpgrades(normalizedProfile, upgrades);
    const nextProfile = normalizeVehicleProfileSafe({
        ...normalizedProfile,
        upgrades: { ...sanitized.upgrades },
        updatedAt: toIsoString(nowMs),
    });
    return {
        profile: nextProfile,
        upgrades: { ...toObject(nextProfile.upgrades) },
        rejectedEntries: sanitized.rejectedEntries.slice(),
        acceptedCount: sanitized.acceptedCount,
    };
}

// XP Reward Calculation

export function calculateSectorXp(telemetry) {
    if (!telemetry || typeof telemetry !== 'object') return 0;
    const kills = Math.max(0, toSafeNumber(telemetry.kills, 0));
    const comboMultiplier = Math.min(
        XP_REWARD_TABLE.comboMultiplierCap,
        Math.max(1, toSafeNumber(telemetry.multiplier, 1))
    );
    const missionsCompleted = Math.max(0, toSafeNumber(telemetry.missionsCompleted, 0));
    const totalMissions = Math.max(0, toSafeNumber(telemetry.totalMissions, 0));
    const isClean = telemetry.cleanSector === true;

    let xp = XP_REWARD_TABLE.sectorComplete;
    xp += kills * XP_REWARD_TABLE.killBase;
    xp += missionsCompleted * XP_REWARD_TABLE.missionComplete;
    if (totalMissions > 0 && missionsCompleted >= totalMissions) {
        xp += XP_REWARD_TABLE.allMissionsBonus;
    }
    if (isClean) xp += XP_REWARD_TABLE.cleanSector;

    return Math.floor(xp * comboMultiplier);
}

// Persistence

export function loadVehicleProfiles(store) {
    if (!store || typeof store.loadJsonRecord !== 'function') return {};
    const raw = store.loadJsonRecord(STORAGE_KEY, {});
    const { profiles: contractProfiles, shouldPersist } = readArcadeVehicleProfileRecord(raw);
    const normalizedProfiles = {};
    let shouldRewrite = shouldPersist;

    Object.entries(contractProfiles).forEach(([vehicleId, profile]) => {
        const normalized = normalizeVehicleProfileSafe(profile);
        normalizedProfiles[vehicleId] = normalized;
        if (!profileEquals(profile, normalized)) shouldRewrite = true;
    });

    if (shouldRewrite && typeof store.saveJsonRecord === 'function') {
        const saveResult = store.saveJsonRecord(STORAGE_KEY, normalizedProfiles);
        warnPersistenceFailure('canonical write-back', saveResult);
    }
    return normalizedProfiles;
}

export function saveVehicleProfiles(store, profiles) {
    if (!store || typeof store.saveJsonRecord !== 'function') return;
    const sourceProfiles = profiles && typeof profiles === 'object' ? profiles : {};
    const normalizedProfiles = {};
    Object.entries(sourceProfiles).forEach(([vehicleId, profile]) => {
        normalizedProfiles[vehicleId] = normalizeVehicleProfileSafe(profile);
    });
    const saveResult = store.saveJsonRecord(STORAGE_KEY, normalizedProfiles);
    warnPersistenceFailure('saveVehicleProfiles', saveResult);
}

export function getOrCreateProfile(profiles, vehicleId, nowMs = Date.now()) {
    const record = getArcadeVehicleProfileRecord(profiles, vehicleId, nowMs);
    return normalizeVehicleProfileSafe(record);
}

export default {
    VEHICLE_PROFILE_SCHEMA_VERSION,
    XP_CONFIG,
    SLOT_UNLOCK_LEVELS,
    XP_REWARD_TABLE,
    UPGRADE_PURCHASE_CODES,
    xpForLevel,
    xpToNextLevel,
    getSlotStatBonuses,
    getMasteryPerks,
    getUnlockedSlots,
    createArcadeVehicleProfile,
    addXp,
    applyUpgrade,
    evaluateUpgradePurchase,
    purchaseUpgrade,
    getSpendableUpgradeXp,
    sanitizeLoadoutPresetUpgrades,
    applyLoadoutPreset,
    calculateSectorXp,
    loadVehicleProfiles,
    saveVehicleProfiles,
    getOrCreateProfile,
};

// Arcade Vehicle Profile: XP, levels, unlocks and upgrade progression.

import {
    ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION,
    ARCADE_VEHICLE_PROFILE_STORAGE_KEY,
    arcadeVehicleLevelForXp,
    arcadeVehicleXpForLevel,
    clampArcadeProfileCount as clampCount,
    createArcadeVehicleProfileRecord,
    getArcadeVehicleProfileRecord,
    loadArcadeVehicleProfileRecord,
    normalizeArcadeVehicleProfileRecord,
} from '../../shared/contracts/ArcadeVehicleProfileContract.js';
import {
    ARCADE_HANGAR_SLOT_UNLOCK_GATES,
    resolveArcadeHangarProgressionSnapshot,
    resolveArcadeHangarUnlockedSlots,
} from '../../shared/contracts/ArcadeHangarRulesContract.js';
import { normalizeArcadeSizeProfileFields } from '../../shared/contracts/ArcadeVehicleBuildContract.js';
import { resolveArcadeVehicleActiveStats } from '../../shared/contracts/ArcadeVehicleActiveStatsContract.js';
import { normalizeArcadeWeaponProfileFields } from '../../shared/contracts/ArcadeMachineGunContract.js';
import { resolveArcadeVehicleBaseStats } from '../../shared/contracts/ArcadeVehicleBalanceContract.js';
import {
    listArcadeStoneUnlocksBetween,
    normalizeArcadeStoneSlotPackages,
    readArcadeStoneWorkshopRecord,
} from '../../shared/contracts/ArcadeStoneWorkshopContract.js';
import { resolveArcadeStoneExtraSteps } from '../../shared/contracts/ArcadeStonePlacementContract.js';
import { toSafeNumber } from '../../shared/utils/ArcadeUtils.js';
import { XP_REWARD_TABLE, calculateSectorXp } from './ArcadeXpRewards.js';
import {
    buildUpgradeState,
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
} from './ArcadeVehicleProfileInternals.js';

const VEHICLE_PROFILE_SCHEMA_VERSION = ARCADE_VEHICLE_PROFILE_SCHEMA_VERSION;
const STORAGE_KEY = ARCADE_VEHICLE_PROFILE_STORAGE_KEY;
const MAX_LOADOUT_PRESET_UPGRADE_ENTRIES = 64;

export const SLOT_UNLOCK_LEVELS = ARCADE_HANGAR_SLOT_UNLOCK_GATES;

export { XP_REWARD_TABLE, calculateSectorXp };

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
    const contractProfile = normalizeArcadeVehicleProfileRecord(profile?.vehicleId, profile);
    return normalizeVehicleProfile(contractProfile);
}

function ensureProfileSafe(profile) {
    return ensureProfile(profile);
}

function buildUpgradeStateSafe(profile, slotName, targetTier) {
    return buildUpgradeState(profile, slotName, targetTier, {
        upgradePurchaseCodes: UPGRADE_PURCHASE_CODES,
    });
}

function sameValue(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

function mergePreservedCosmetics(rawProfile, runtimeProfile) {
    const normalizedRaw = normalizeArcadeVehicleProfileRecord(rawProfile?.vehicleId, rawProfile);
    const baseline = normalizeVehicleProfileSafe(normalizedRaw);
    const current = normalizeVehicleProfileSafe(runtimeProfile);
    const merged = { ...rawProfile };
    const cosmeticFields = new Set(['trailStyleId', 'weaponStyleIds', 'partStyle']);
    let progressionChanged = false;
    for (const key of Object.keys(current)) {
        if (cosmeticFields.has(key) || ['schemaVersion', 'vehicleId', 'createdAt', 'updatedAt'].includes(key)
            || sameValue(current[key], baseline[key])) continue;
        merged[key] = current[key];
        progressionChanged = true;
    }
    // Version migration is safe for supported records; preserve opaque cosmetic values
    // while still allowing the ordinary v1/v2-to-v3 migration to complete.
    merged.schemaVersion = current.schemaVersion;
    merged.vehicleId = current.vehicleId;
    if (progressionChanged && Object.prototype.hasOwnProperty.call(current, 'updatedAt')) {
        merged.updatedAt = current.updatedAt;
    }

    if (sameValue(current.trailStyleId, baseline.trailStyleId)) {
        if (Object.prototype.hasOwnProperty.call(rawProfile, 'trailStyleId')) merged.trailStyleId = rawProfile.trailStyleId;
    } else {
        merged.trailStyleId = current.trailStyleId;
    }

    if (!sameValue(current.weaponStyleIds, baseline.weaponStyleIds)) {
        const styles = rawProfile.weaponStyleIds && typeof rawProfile.weaponStyleIds === 'object'
            && !Array.isArray(rawProfile.weaponStyleIds)
            ? { ...rawProfile.weaponStyleIds }
            : {};
        for (const [familyId, fallbackStyleId] of Object.entries(baseline.weaponStyleIds)) {
            const nextStyleId = current.weaponStyleIds?.[familyId];
            if (sameValue(nextStyleId, fallbackStyleId)) continue;
            if (typeof nextStyleId === 'string') styles[familyId] = nextStyleId;
            else delete styles[familyId];
        }
        merged.weaponStyleIds = styles;
    } else if (Object.prototype.hasOwnProperty.call(rawProfile, 'weaponStyleIds')) {
        merged.weaponStyleIds = rawProfile.weaponStyleIds;
    }

    if (!sameValue(current.partStyle, baseline.partStyle)) {
        const styles = rawProfile.partStyle && typeof rawProfile.partStyle === 'object'
            && !Array.isArray(rawProfile.partStyle)
            ? { ...rawProfile.partStyle }
            : {};
        const partNames = new Set([...Object.keys(baseline.partStyle), ...Object.keys(current.partStyle || {})]);
        for (const partName of partNames) {
            const fallbackStyle = baseline.partStyle[partName];
            const nextStyle = current.partStyle?.[partName];
            if (sameValue(nextStyle, fallbackStyle)) continue;
            const rawStyle = styles[partName] && typeof styles[partName] === 'object' && !Array.isArray(styles[partName])
                ? { ...styles[partName] }
                : {};
            for (const field of ['color', 'scale', 'variant']) {
                if (sameValue(nextStyle?.[field], fallbackStyle?.[field])) continue;
                if (Object.prototype.hasOwnProperty.call(nextStyle || {}, field)) rawStyle[field] = nextStyle[field];
                else delete rawStyle[field];
            }
            if (Object.keys(rawStyle).length) styles[partName] = rawStyle;
            else delete styles[partName];
        }
        merged.partStyle = styles;
    } else if (Object.prototype.hasOwnProperty.call(rawProfile, 'partStyle')) {
        merged.partStyle = rawProfile.partStyle;
    }

    return merged;
}

function mergeStoredCosmeticRecords(runtimeProfiles, preservedCosmeticProfiles = {}) {
    const result = { ...runtimeProfiles, ...preservedCosmeticProfiles };
    for (const [vehicleId, rawProfile] of Object.entries(preservedCosmeticProfiles)) {
        const runtimeProfile = runtimeProfiles[vehicleId];
        if (runtimeProfile) result[vehicleId] = mergePreservedCosmetics(rawProfile, runtimeProfile);
    }
    return result;
}

// XP Curve (no level ceiling since arcade-vehicle-profile.v3)

export function xpForLevel(level) {
    return arcadeVehicleXpForLevel(level);
}

export function xpToNextLevel(profile) {
    if (!profile || typeof profile !== 'object') return { current: 0, required: 100, progress: 0 };
    const normalized = normalizeVehicleProfileSafe(profile);
    const currentLevelXp = xpForLevel(normalized.level);
    const required = xpForLevel(normalized.level + 1) - currentLevelXp;
    const current = Math.max(0, normalized.xp - currentLevelXp);
    return {
        current,
        required,
        progress: required > 0 ? Math.min(1, current / required) : 1,
    };
}

/**
 * Run-Start-Boni eines Fahrzeugs: nur der Build aus den Größenfeldern des Profils (Paket 2a), den
 * gekauften Steinplatz-Paketen und den eingefrorenen Stein-Schritten aus dem Werkstatt-Pool (Paket 3).
 * Der Pool ist die einzige Wahrheit für den Run und wird hier nur gelesen; ohne Speicher oder bei
 * einem Lesefehler rechnet der Run ohne Steine. Die Strategie rechnet daraus mit
 * resolveArcadeVehicleActiveStats die Werte.
 * @param {any} profile
 * @param {any} [store] Spieler-Speicherport mit readJsonRecordResult
 * @param {any} [runStoneSteps] schon eingefrorene Stein-Schritte dieses Runs: Hangar-Änderungen und
 *   Level-Aufstiege während eines Runs wirken erst im nächsten Run; der Pool wird dann nicht gelesen
 */
export function getArcadeRunVehicleBonuses(profile, store = null, runStoneSteps = null, runWeaponFields = null) {
    if (!profile || typeof profile !== 'object') return { build: null };
    const vehicleId = String(profile.vehicleId || '');
    const pool = store && !runStoneSteps ? readArcadeStoneWorkshopRecord(store).pool : null;
    const level = runWeaponFields?.vehicleLevel ?? profile.level;
    const weapons = normalizeArcadeWeaponProfileFields({ ...profile, ...runWeaponFields, level });
    return {
        build: {
            vehicleId,
            level,
            ...normalizeArcadeSizeProfileFields(profile),
            stoneSlotPackages: normalizeArcadeStoneSlotPackages(profile.stoneSlotPackages),
            stoneSteps: runStoneSteps || resolveArcadeStoneExtraSteps(pool, vehicleId, profile),
            ...weapons,
        },
    };
}

const NO_PROFILE_HUD_STATS = Object.freeze({ level: 1, speedBonusPct: 0, turningBonusPct: 0, maxHpBonus: 0 });
const HUD_STATS_BY_PROFILE = new WeakMap();

/**
 * Werte-Banner zum Sektorstart (82.8.3, Gauntlet): Wirkung von Größen-Build und Steinen auf Tempo
 * und Wendigkeit (Prozentpunkte über dem Tabellenwert) und Leben (Modus-Basis 100 HP), gerechnet
 * mit derselben Rechenstelle wie die Strategie im Run. Pro kanonischem Profil gecacht: der HUD-Pfad
 * läuft jedes Bild, ein geändertes Profil ist ein neues Objekt, und ein Treffer verlangt dasselbe
 * stoneSteps-Objekt. Daily: feste Startbedingungen, also keine Boni.
 * @param {any} profile
 * @param {string} vehicleId
 * @param {boolean} dailyChallenge
 * @param {any} [stoneSteps] eingefrorene Stein-Schritte des Runs (getArcadeRunVehicleBonuses)
 */
export function resolveArcadeRunHudVehicleStats(profile, vehicleId, dailyChallenge, stoneSteps = null) {
    if (!profile || typeof profile !== 'object') return NO_PROFILE_HUD_STATS;
    const key = dailyChallenge ? '' : String(vehicleId || '');
    const steps = dailyChallenge ? null : stoneSteps;
    const cached = HUD_STATS_BY_PROFILE.get(profile);
    if (cached?.key === key && cached.stoneSteps === steps) return cached.stats;
    const base = resolveArcadeVehicleBaseStats(key);
    const build = dailyChallenge ? base : resolveArcadeVehicleActiveStats(key, profile, steps);
    const delta = (/** @type {number} */ after, /** @type {number} */ before) => Math.round((after - before) * 100) / 100;
    const stats = Object.freeze({
        level: profile.level ?? 1,
        speedBonusPct: delta(build.speedPct, base.speedPct),
        turningBonusPct: delta(build.turnPct, base.turnPct),
        maxHpBonus: Math.round(build.maxHpPct) - Math.round(base.maxHpPct),
    });
    HUD_STATS_BY_PROFILE.set(profile, { key, stoneSteps: steps, stats });
    return stats;
}

// Kept as a compatibility shape; vehicle levels grant no passive perks.

export function getMasteryPerks(level) {
    void level;
    return {
        scoreBonusPct: 0,
        comboDecaySlowPct: 0,
        xpBonusPct: 0,
    };
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
    const prevLevel = normalized.level;
    const gain = clampCount(amount);
    const totalXp = clampCount(normalized.xp + gain);
    const newLevel = arcadeVehicleLevelForXp(totalXp);
    const leveledUp = newLevel > prevLevel;

    const prevSnapshot = resolveArcadeHangarProgressionSnapshot(prevLevel);
    const nextSnapshot = resolveArcadeHangarProgressionSnapshot(newLevel);

    // Paket 3: a level-up opens stone slot packages for purchase and makes stone tiers usable.
    // The stored legacy snapshot fields below stay for older readers.
    const stoneUnlocks = listArcadeStoneUnlocksBetween(prevLevel, newLevel);
    const unlocksGained = stoneUnlocks.packages;
    const partFamiliesGained = [];
    const tiersGained = stoneUnlocks.tiers;

    const prevMilestones = new Set(prevSnapshot.masteryMilestones);
    const masteryMilestonesGained = nextSnapshot.masteryMilestones.filter((milestoneId) => !prevMilestones.has(milestoneId));

    const xpBank = clampCount(normalized.xpBank + gain);
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
            totalXpEarned: clampCount(Math.max(totalXp, normalized.totalXpEarned + gain)),
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
        xpBank: Number.MAX_SAFE_INTEGER,
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

// Persistence

export function loadVehicleProfiles(store) {
    if (!store || typeof store.loadJsonRecord !== 'function') return {};
    const {
        profiles: contractProfiles,
        preservedProfiles = {},
        preservedCosmeticProfiles = {},
        shouldPersist,
        canPersist = true,
        usedLegacyFallback,
    } = loadArcadeVehicleProfileRecord(store);
    const normalizedProfiles = {};
    let shouldRewrite = shouldPersist;

    Object.entries(contractProfiles).forEach(([vehicleId, profile]) => {
        const normalized = normalizeVehicleProfileSafe(profile);
        normalizedProfiles[vehicleId] = normalized;
        if (!profileEquals(profile, normalized)) shouldRewrite = true;
    });

    if (shouldRewrite && canPersist && !usedLegacyFallback && typeof store.saveJsonRecord === 'function') {
        const saveResult = store.saveJsonRecord(STORAGE_KEY, {
            ...mergeStoredCosmeticRecords(normalizedProfiles, preservedCosmeticProfiles),
            ...preservedProfiles,
        });
        warnPersistenceFailure('canonical write-back', saveResult);
    }
    return normalizedProfiles;
}

export function saveVehicleProfiles(store, profiles) {
    if (!store || typeof store.saveJsonRecord !== 'function') return false;
    const {
        preservedProfiles = {},
        preservedCosmeticProfiles = {},
        canPersist = true,
    } = loadArcadeVehicleProfileRecord(store);
    // A malformed top-level record cannot be safely merged with writable profiles.
    if (!canPersist) return false;
    const sourceProfiles = profiles && typeof profiles === 'object' ? profiles : {};
    const normalizedProfiles = {};
    Object.entries(sourceProfiles).forEach(([vehicleId, profile]) => {
        normalizedProfiles[vehicleId] = normalizeVehicleProfileSafe(profile);
    });
    // Rejected or malformed per-vehicle records stay byte-for-byte equivalent at the
    // JSON value level, including when a fresh runtime profile has the same vehicle ID.
    const saveResult = store.saveJsonRecord(STORAGE_KEY, {
        ...mergeStoredCosmeticRecords(normalizedProfiles, preservedCosmeticProfiles),
        ...preservedProfiles,
    });
    warnPersistenceFailure('saveVehicleProfiles', saveResult);
    return saveResult;
}

export function getOrCreateProfile(profiles, vehicleId, nowMs = Date.now()) {
    const record = getArcadeVehicleProfileRecord(profiles, vehicleId, nowMs);
    return normalizeVehicleProfileSafe(record);
}

export default {
    VEHICLE_PROFILE_SCHEMA_VERSION,
    SLOT_UNLOCK_LEVELS,
    XP_REWARD_TABLE,
    UPGRADE_PURCHASE_CODES,
    xpForLevel,
    xpToNextLevel,
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

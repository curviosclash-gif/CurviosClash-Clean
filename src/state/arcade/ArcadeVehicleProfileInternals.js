import {
    ARCADE_HANGAR_TIER_UNLOCK_GATES,
    resolveArcadeHangarAllowedPartFamilies,
    resolveArcadeHangarAllowedTiers,
    resolveArcadeHangarPartFamily,
    resolveArcadeHangarProgressionSnapshot,
    resolveArcadeHangarUnlockedSlots,
} from '../../shared/contracts/ArcadeHangarRulesContract.js';
import {
    canUpgrade,
    getUpgradeCost,
} from '../../entities/arcade/ArcadeBlueprintSchema.js';
import { toSafeNumber, clampInteger as clampInt } from '../../shared/utils/ArcadeUtils.js';

export function isPersistenceSuccess(result) {
    return result === undefined || result === true || result?.success === true;
}

export function warnPersistenceFailure(contextLabel, result) {
    if (isPersistenceSuccess(result)) return;
    if (typeof console === 'undefined' || typeof console.warn !== 'function') return;
    console.warn(`[ArcadeVehicleProfile] ${String(contextLabel || 'save')} failed`, {
        reason: String(result?.reason || ''),
        metadata: result?.metadata && typeof result.metadata === 'object'
            ? { ...result.metadata }
            : null,
    });
}

export function toIsoString(nowMs) {
    return new Date(Math.max(0, toSafeNumber(nowMs, Date.now()))).toISOString();
}

export function toObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uniqueList(values) {
    return [...new Set((Array.isArray(values) ? values : []).map((entry) => String(entry || '').trim()).filter(Boolean))];
}

export function normalizeSlotName(slotName) {
    return String(slotName || '').trim().toLowerCase();
}

export function normalizeTier(tier) {
    const normalized = String(tier || '').trim().toUpperCase();
    return normalized || 'T1';
}

export function isValidTier(tier) {
    return tier === 'T1' || tier === 'T2' || tier === 'T3';
}

export function resolveNextTier(tier) {
    const normalized = normalizeTier(tier);
    if (normalized === 'T1') return 'T2';
    if (normalized === 'T2') return 'T3';
    return null;
}

export { resolveArcadeHangarPartFamily };

export function profileEquals(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

export function normalizeVehicleProfile(profile, {
    xpConfig,
    maxUpgradeXpBank,
} = {}) {
    const source = toObject(profile);
    const level = clampInt(source.level, 1, xpConfig.MAX_LEVEL, 1);
    const xp = Math.max(0, toSafeNumber(source.xp, 0));
    const progression = resolveArcadeHangarProgressionSnapshot(level);
    const upgrades = toObject(source.upgrades);
    const spentUpgradeXp = Math.max(0, toSafeNumber(source.spentUpgradeXp, 0));
    const fallbackBank = Math.max(0, xp - spentUpgradeXp);
    const xpBank = clampInt(source.xpBank, 0, maxUpgradeXpBank, fallbackBank);
    const totalXpEarned = Math.max(xp, toSafeNumber(source.totalXpEarned, xp));
    const upgradesApplied = Math.max(0, clampInt(source.upgradesApplied, 0, 100_000, Object.keys(upgrades).length));
    const masteryMilestones = uniqueList(source.masteryMilestones).length
        ? uniqueList(source.masteryMilestones)
        : progression.masteryMilestones;
    return {
        ...source,
        xp,
        level,
        unlockedSlots: progression.unlockedSlots.slice(),
        upgrades: { ...upgrades },
        xpBank,
        spentUpgradeXp,
        totalXpEarned,
        upgradesApplied,
        unlockedPartFamilies: progression.allowedPartFamilies.slice(),
        unlockedUpgradeTiers: progression.allowedTiers.slice(),
        masteryMilestones: masteryMilestones.slice(),
    };
}

export function ensureProfile(profile, options = {}) {
    if (!profile || typeof profile !== 'object') return null;
    return normalizeVehicleProfile(profile, options);
}

function finalizeUpgradeState(baseState, code, ok = false) {
    return { ...baseState, ok, code };
}

export function buildUpgradeState(
    profile,
    slotName,
    targetTier,
    {
        xpConfig,
        maxUpgradeXpBank,
        upgradePurchaseCodes,
    } = {}
) {
    const normalizedProfile = ensureProfile(profile, { xpConfig, maxUpgradeXpBank });
    if (!normalizedProfile) {
        return finalizeUpgradeState({
            profile,
            slotName: normalizeSlotName(slotName),
            targetTier: normalizeTier(targetTier),
            currentTier: 'T1',
            nextTier: 'T2',
            cost: Infinity,
            spendableXp: 0,
            remainingXp: 0,
            partFamily: null,
            requiredLevel: 1,
        }, upgradePurchaseCodes.INVALID_PROFILE);
    }

    const normalizedSlot = normalizeSlotName(slotName);
    const normalizedTargetTier = normalizeTier(targetTier);
    const currentTier = normalizeTier(normalizedProfile.upgrades?.[normalizedSlot] || 'T1');
    const nextTier = resolveNextTier(currentTier);
    const partFamily = resolveArcadeHangarPartFamily(normalizedSlot);
    const allowedPartFamilies = new Set(resolveArcadeHangarAllowedPartFamilies(normalizedProfile.level));
    const allowedTiers = new Set(resolveArcadeHangarAllowedTiers(normalizedProfile.level));
    const unlockedSlots = new Set(resolveArcadeHangarUnlockedSlots(normalizedProfile.level));
    const tierUnlockKey = `${normalizedSlot}_${normalizedTargetTier.toLowerCase()}`;
    const requiredLevelByTier = Number(ARCADE_HANGAR_TIER_UNLOCK_GATES[normalizedTargetTier]) || 1;
    const cost = Number(getUpgradeCost(normalizedSlot, normalizedTargetTier));
    const spendableXp = Math.max(0, toSafeNumber(normalizedProfile.xpBank, 0));
    const remainingXp = spendableXp - (Number.isFinite(cost) ? cost : 0);
    const baseState = {
        profile: normalizedProfile,
        slotName: normalizedSlot,
        targetTier: normalizedTargetTier,
        currentTier,
        nextTier,
        cost,
        spendableXp,
        remainingXp,
        partFamily,
        requiredLevel: requiredLevelByTier,
    };

    if (!normalizedSlot) return finalizeUpgradeState(baseState, upgradePurchaseCodes.INVALID_SLOT);
    if (normalizedTargetTier !== 'T2' && normalizedTargetTier !== 'T3') {
        return finalizeUpgradeState(baseState, upgradePurchaseCodes.INVALID_TIER);
    }
    if (!nextTier || normalizedTargetTier !== nextTier) {
        return finalizeUpgradeState(baseState, upgradePurchaseCodes.INVALID_TIER_SEQUENCE);
    }
    if (!unlockedSlots.has(normalizedSlot) && !unlockedSlots.has(tierUnlockKey)) {
        return finalizeUpgradeState(baseState, upgradePurchaseCodes.SLOT_LOCKED);
    }
    if (partFamily && !allowedPartFamilies.has(partFamily)) {
        return finalizeUpgradeState(baseState, upgradePurchaseCodes.PART_FAMILY_LOCKED);
    }
    if (!allowedTiers.has(normalizedTargetTier)) {
        return finalizeUpgradeState(baseState, upgradePurchaseCodes.TIER_LOCKED);
    }
    if (!canUpgrade(normalizedSlot, normalizedTargetTier, normalizedProfile.level)) {
        return finalizeUpgradeState(baseState, upgradePurchaseCodes.LEVEL_LOCKED);
    }
    if (!Number.isFinite(cost) || cost < 0) {
        return finalizeUpgradeState(baseState, upgradePurchaseCodes.COST_INVALID);
    }
    if (spendableXp < cost) {
        return finalizeUpgradeState(baseState, upgradePurchaseCodes.INSUFFICIENT_XP);
    }
    return finalizeUpgradeState(baseState, upgradePurchaseCodes.APPLIED, true);
}

export function computeLevel(totalXp, xpConfig) {
    let level = 1;
    while (level < xpConfig.MAX_LEVEL && totalXp >= xpForLevel(level + 1, xpConfig)) {
        level += 1;
    }
    return level;
}

export function xpForLevel(level, xpConfig) {
    const n = Math.max(1, Math.min(xpConfig.MAX_LEVEL, Math.floor(level)));
    if (n <= 1) return 0;
    return Math.floor(xpConfig.BASE_XP * Math.pow(n, xpConfig.EXPONENT));
}

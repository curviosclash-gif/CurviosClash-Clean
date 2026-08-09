// Read-only projection of the arcade vehicle progression for the hangar surface:
// level, collected XP, what is still missing and the per-slot unlock/purchase state.
// Pure data — the renderer only formats what this returns.

import { ARCADE_HANGAR_SLOT_UNLOCK_GATES } from '../../shared/contracts/ArcadeHangarRulesContract.js';
import { HANGAR_SLOT_DEFINITIONS, resolveHangarPart } from './HangarPartCatalog.js';
import { resolveHangarStoneAvailability } from './HangarStoneInventory.js';

const EMPTY_NEXT_TIER = Object.freeze({
    stoneId: '',
    label: '',
    tier: '',
    priceXrp: 0,
    purchasable: false,
    reason: '',
});

function toCount(value) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function resolveHangarSlotUnlockLevel(slotId) {
    return Math.max(1, Number(ARCADE_HANGAR_SLOT_UNLOCK_GATES[slotId]) || 1);
}

function projectNextTier(part, profile, build) {
    const nextStone = resolveHangarPart(part?.upgradeTo || '');
    if (!nextStone) return EMPTY_NEXT_TIER;
    const availability = resolveHangarStoneAvailability(nextStone, profile, build);
    let reason = '';
    if (!availability.levelAllowsPurchase) {
        reason = `Kauf ab Level ${availability.purchaseLevel}`;
    } else if (!availability.canAfford) {
        reason = `Noch ${Math.max(0, availability.priceXrp - availability.xrp)} XRP nötig`;
    } else if (availability.owned >= availability.maxOwned) {
        reason = 'Bestand ist voll';
    }
    return {
        stoneId: nextStone.id,
        label: nextStone.label,
        tier: nextStone.tier,
        priceXrp: availability.priceXrp,
        purchasable: availability.canPurchase === true,
        reason,
    };
}

function projectSlot(slot, profile, build, level) {
    const unlockLevel = resolveHangarSlotUnlockLevel(slot.id);
    const unlocked = level >= unlockLevel;
    const part = resolveHangarPart(build?.slots?.[slot.id] || '');
    return {
        id: slot.id,
        label: slot.label,
        required: slot.required === true,
        unlocked,
        unlockLevel,
        lockReason: unlocked ? '' : `Freischaltung auf Level ${unlockLevel}`,
        installedPartId: part?.id || '',
        installedLabel: part?.label || '',
        tier: part?.tier || '',
        nextTier: unlocked ? projectNextTier(part, profile, build) : EMPTY_NEXT_TIER,
    };
}

/**
 * @param {any} profile arcade vehicle profile record
 * @param {any} build current hangar build draft
 * @param {any} xp result of the profile port's xpToNextLevel(profile)
 */
export function projectHangarProgression(profile, build, xp) {
    const level = Math.max(1, Math.floor(Number(profile?.level) || 1));
    const xpIntoLevel = toCount(xp?.current);
    const xpForNextLevel = toCount(xp?.required);
    const progressSource = Number(xp?.progress);
    return {
        level,
        xpIntoLevel,
        xpForNextLevel,
        xpRemaining: Math.max(0, xpForNextLevel - xpIntoLevel),
        progress: Number.isFinite(progressSource) ? Math.max(0, Math.min(1, progressSource)) : 0,
        spendableXrp: Math.max(0, Math.floor(Number(profile?.xpBank ?? profile?.xp) || 0)),
        masteryCount: Array.isArray(profile?.masteryMilestones) ? profile.masteryMilestones.length : 0,
        slots: HANGAR_SLOT_DEFINITIONS.map((slot) => projectSlot(slot, profile, build, level)),
    };
}

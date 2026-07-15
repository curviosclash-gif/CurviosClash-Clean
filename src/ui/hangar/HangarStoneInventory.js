import { HANGAR_SLOT_DEFINITIONS, listHangarParts, resolveHangarPart } from './HangarPartCatalog.js';

export const HANGAR_STONE_INVENTORY_VERSION = 'hangar-stone-inventory.v1';

function defaultCounts() {
    return Object.fromEntries(listHangarParts().filter((part) => part.kind === 'stone' && !part.published)
        .map((part) => [part.id, Number(part.inventory?.initialCount) || 0]));
}

export function normalizeHangarStoneInventory(profile) {
    const source = profile?.hangarStoneInventory?.counts && typeof profile.hangarStoneInventory.counts === 'object'
        ? profile.hangarStoneInventory.counts
        : {};
    const counts = defaultCounts();
    Object.entries(source).forEach(([stoneId, count]) => {
        const stone = resolveHangarPart(stoneId);
        if (!stone || stone.kind !== 'stone') return;
        counts[stone.id] = Math.max(counts[stone.id] || 0, Math.min(7, Math.floor(Number(count) || 0)));
    });
    return { schemaVersion: HANGAR_STONE_INVENTORY_VERSION, counts };
}

export function countEquippedHangarStones(build) {
    const counts = {};
    for (const slot of HANGAR_SLOT_DEFINITIONS) {
        const stone = resolveHangarPart(build?.slots?.[slot.id]);
        if (stone?.kind === 'stone') counts[stone.id] = (counts[stone.id] || 0) + 1;
    }
    return counts;
}

export function resolveHangarStoneAvailability(stone, profile, build) {
    if (!stone || stone.kind !== 'stone') return { owned: Infinity, equipped: 0, available: Infinity, unlocked: true, canInstall: true, canPurchase: false };
    if (profile?.fightUnlimitedInventory === true) {
        const equipped = countEquippedHangarStones(build)[stone.id] || 0;
        return {
            owned: Infinity, equipped, available: Infinity, level: 30, xrp: 0,
            unlockLevel: 1, purchaseLevel: 1, priceXrp: 0, maxOwned: Infinity,
            unlocked: true, canInstall: true, canPurchase: false,
            levelAllowsPurchase: true, canAfford: true,
        };
    }
    const inventory = normalizeHangarStoneInventory(profile);
    const equipped = countEquippedHangarStones(build)[stone.id] || 0;
    const owned = inventory.counts[stone.id] || 0;
    const available = Math.max(0, owned - equipped);
    const level = Math.max(1, Number(profile?.level) || 1);
    const xrp = Math.max(0, Number(profile?.xpBank ?? profile?.xp) || 0);
    const unlockLevel = Math.max(1, Number(stone.minLevel) || 1);
    const purchaseLevel = Math.max(unlockLevel, Number(stone.inventory?.purchaseUnlockLevel) || unlockLevel);
    const priceXrp = Math.max(0, Number(stone.inventory?.priceXrp) || 0);
    const maxOwned = Math.max(1, Number(stone.inventory?.maxOwned) || 7);
    return {
        owned, equipped, available, level, xrp, unlockLevel, purchaseLevel, priceXrp, maxOwned,
        unlocked: level >= unlockLevel,
        canInstall: level >= unlockLevel && available > 0,
        canPurchase: level >= purchaseLevel && xrp >= priceXrp && owned < maxOwned,
        levelAllowsPurchase: level >= purchaseLevel,
        canAfford: xrp >= priceXrp,
    };
}

export function purchaseHangarStone(profile, stoneId, nowMs = Date.now()) {
    const stone = resolveHangarPart(stoneId);
    const availability = resolveHangarStoneAvailability(stone, profile, null);
    if (!stone || stone.kind !== 'stone') return { ok: false, code: 'unknown_stone', profile };
    if (!availability.levelAllowsPurchase) return { ok: false, code: 'level_locked', requiredLevel: availability.purchaseLevel, profile };
    if (!availability.canAfford) return { ok: false, code: 'insufficient_xrp', priceXrp: availability.priceXrp, profile };
    if (availability.owned >= availability.maxOwned) return { ok: false, code: 'inventory_full', profile };
    const inventory = normalizeHangarStoneInventory(profile);
    inventory.counts[stone.id] = availability.owned + 1;
    const nextProfile = {
        ...profile,
        hangarStoneInventory: inventory,
        xpBank: availability.xrp - availability.priceXrp,
        spentUpgradeXp: Math.max(0, Number(profile?.spentUpgradeXp) || 0) + availability.priceXrp,
        lastStonePurchase: { stoneId: stone.id, priceXrp: availability.priceXrp, at: new Date(Math.max(0, Number(nowMs) || Date.now())).toISOString() },
        updatedAt: new Date(Math.max(0, Number(nowMs) || Date.now())).toISOString(),
    };
    return { ok: true, code: 'purchased', profile: nextProfile, stone, remainingXrp: nextProfile.xpBank };
}

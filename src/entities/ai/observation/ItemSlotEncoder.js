// ============================================
// ItemSlotEncoder.js - stable 20-slot item encoding for bot observations
// ============================================

import {
    PICKUP_SLOT_COUNT,
    PICKUP_SLOT_UNKNOWN_INDEX,
    getPickupObservationSlotIndex,
    getPickupTypes,
    normalizePickupType,
} from '../../PickupRegistry.js';

export const ITEM_SLOT_COUNT = PICKUP_SLOT_COUNT;
export const ITEM_SLOT_UNKNOWN_INDEX = PICKUP_SLOT_UNKNOWN_INDEX;

export const ITEM_SLOT_BY_TYPE = Object.freeze(
    getPickupTypes().reduce((acc, type) => {
        acc[type] = getPickupObservationSlotIndex(type);
        return acc;
    }, {})
);

function normalizeItemType(type) {
    return normalizePickupType(type);
}

export function resolveItemSlotIndex(itemType) {
    const normalized = normalizeItemType(itemType);
    if (!normalized) return ITEM_SLOT_UNKNOWN_INDEX;
    return getPickupObservationSlotIndex(normalized);
}

export function clearItemSlots(target, offset = 0) {
    for (let i = 0; i < ITEM_SLOT_COUNT; i++) {
        target[offset + i] = 0;
    }
    return target;
}

export function encodeItemSlots(items, target = new Array(ITEM_SLOT_COUNT), offset = 0) {
    clearItemSlots(target, offset);
    if (!Array.isArray(items) || items.length === 0) {
        return target;
    }

    for (let i = 0; i < items.length; i++) {
        const slotIndex = resolveItemSlotIndex(items[i]);
        if (slotIndex < 0 || slotIndex >= ITEM_SLOT_COUNT) continue;
        target[offset + slotIndex] = 1;
    }
    return target;
}

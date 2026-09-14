import {
    isPickupTypeSelfUsable,
    isRocketPickupType,
    normalizePickupType,
    getPickupDefinition,
} from '../PickupRegistry.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import {
    GAMEPLAY_ACTION_RESULT_CODES,
    buildGameplayActionResult,
} from '../../shared/contracts/GameplayActionResultContract.js';

export function ensurePlayerInventoryCollections(player) {
    if (!player) return { inventory: [], rocketInventory: [] };
    if (!Array.isArray(player.inventory)) player.inventory = [];
    if (!Array.isArray(player.rocketInventory)) player.rocketInventory = [];

    // Accept old saves/network frames without ever exposing their rockets as selectable items.
    for (let i = 0; i < player.inventory.length;) {
        const type = normalizePickupType(player.inventory[i], { fallback: player.inventory[i] });
        if (!isRocketPickupType(type)) {
            i += 1;
            continue;
        }
        player.rocketInventory.push(type);
        player.inventory.splice(i, 1);
    }
    if (player.inventory.length === 0 || player.selectedItemIndex >= player.inventory.length) {
        player.selectedItemIndex = 0;
    }
    return { inventory: player.inventory, rocketInventory: player.rocketInventory };
}

export function addPlayerInventoryItem(player, type) {
    if (!player) return false;
    const normalized = normalizePickupType(type, { fallback: type });
    if (!normalized || !getPickupDefinition(normalized)) {
        return false;
    }
    const collections = ensurePlayerInventoryCollections(player);
    const destination = isRocketPickupType(normalized)
        ? collections.rocketInventory
        : collections.inventory;
    if (destination.length < resolveGameplayConfig(player).POWERUP.MAX_INVENTORY) {
        destination.push(normalized);
        return true;
    }
    return false;
}

export function cyclePlayerInventoryItem(player) {
    if (!player) return;
    ensurePlayerInventoryCollections(player);
    if (player.inventory.length > 0) {
        player.selectedItemIndex = (player.selectedItemIndex + 1) % player.inventory.length;
    } else {
        player.selectedItemIndex = 0;
    }
}

export function usePlayerInventoryItem(player, modeType = null) {
    if (!player) {
        return buildGameplayActionResult({
            ok: false,
            code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_EMPTY,
            message: 'Kein Spieler',
        });
    }
    ensurePlayerInventoryCollections(player);
    if (player.inventory.length === 0 || player.selectedItemIndex >= player.inventory.length) {
        return buildGameplayActionResult({
            ok: false,
            code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_EMPTY,
            message: 'Kein Item verfuegbar',
        });
    }
    const rawType = player.inventory[player.selectedItemIndex];
    const normalizedType = normalizePickupType(rawType, { fallback: rawType });
    if (!normalizedType || !getPickupDefinition(normalizedType)) {
        return buildGameplayActionResult({
            ok: false,
            code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_INVALID_TYPE,
            message: 'Item ungueltig',
            type: rawType || null,
        });
    }
    if (!isPickupTypeSelfUsable(normalizedType, modeType)) {
        return buildGameplayActionResult({
            ok: false,
            code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_FORBIDDEN,
            message: 'Item kann nicht direkt genutzt werden',
            type: normalizedType,
        });
    }
    player.inventory.splice(player.selectedItemIndex, 1);
    if (player.selectedItemIndex >= player.inventory.length && player.inventory.length > 0) {
        player.selectedItemIndex = 0;
    }
    player.applyPowerup(normalizedType);
    return buildGameplayActionResult({
        ok: true,
        code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_USE_SUCCESS,
        type: normalizedType,
        mode: 'use',
    });
}

export function dropPlayerInventoryItem(player) {
    if (!player) return null;
    ensurePlayerInventoryCollections(player);
    if (player.inventory.length > 0) {
        return player.inventory.pop();
    }
    return null;
}

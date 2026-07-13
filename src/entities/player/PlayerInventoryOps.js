import {
    isPickupTypeSelfUsable,
    normalizePickupType,
    getPickupDefinition,
} from '../PickupRegistry.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import {
    GAMEPLAY_ACTION_RESULT_CODES,
    buildGameplayActionResult,
} from '../../shared/contracts/GameplayActionResultContract.js';

export function addPlayerInventoryItem(player, type) {
    if (!player) return false;
    const normalized = normalizePickupType(type, { fallback: type });
    if (!normalized || !getPickupDefinition(normalized)) {
        return false;
    }
    if (player.inventory.length < resolveGameplayConfig(player).POWERUP.MAX_INVENTORY) {
        player.inventory.push(normalized);
        return true;
    }
    return false;
}

export function cyclePlayerInventoryItem(player) {
    if (!player) return;
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
    const lastIdx = player.inventory.length - 1;
    if (player.selectedItemIndex !== lastIdx) {
        player.inventory[player.selectedItemIndex] = player.inventory[lastIdx];
    }
    player.inventory.length = lastIdx;
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
    if (player.inventory.length > 0) {
        return player.inventory.pop();
    }
    return null;
}

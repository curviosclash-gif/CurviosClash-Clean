import {
    isPickupTypeSelfUsable,
    isPickupTypeShootable,
    isRocketPickupType,
    normalizePickupType,
} from './PickupRegistryContract.js';

export const GAMEPLAY_ACTION_COOLDOWN_EPSILON = 0.001;

function normalizeModeType(modeType, fallback = 'CLASSIC') {
    const normalized = String(modeType || '').trim().toUpperCase();
    return normalized || fallback;
}

function normalizeCooldownSeconds(value) {
    return Math.max(0, Number(value) || 0);
}

function resolveActionHintLabel(canUse, canShoot) {
    if (canUse && canShoot) return 'DUAL';
    if (canShoot) return 'SHOT';
    if (canUse) return 'USE';
    return '';
}

export function resolvePickupActionAvailability({
    type = '',
    fallbackType = '',
    modeType = 'CLASSIC',
    useCooldownRemaining = 0,
    shootCooldownRemaining = 0,
} = {}) {
    const normalizedType = normalizePickupType(type, { fallback: fallbackType });
    const normalizedModeType = normalizeModeType(modeType);
    const normalizedUseCooldown = normalizeCooldownSeconds(useCooldownRemaining);
    const normalizedShootCooldown = normalizeCooldownSeconds(shootCooldownRemaining);
    const canUse = !!normalizedType && isPickupTypeSelfUsable(normalizedType, normalizedModeType);
    const canShoot = !!normalizedType && isPickupTypeShootable(normalizedType, normalizedModeType);
    const useOnCooldown = canUse && normalizedUseCooldown > GAMEPLAY_ACTION_COOLDOWN_EPSILON;
    const shootOnCooldown = canShoot && normalizedShootCooldown > GAMEPLAY_ACTION_COOLDOWN_EPSILON;

    return {
        type: normalizedType,
        modeType: normalizedModeType,
        canUse,
        canShoot,
        canUseNow: canUse && !useOnCooldown,
        canShootNow: canShoot && !shootOnCooldown,
        useCooldownRemaining: normalizedUseCooldown,
        shootCooldownRemaining: normalizedShootCooldown,
        useOnCooldown,
        shootOnCooldown,
        hasCooldown: useOnCooldown || shootOnCooldown,
        actionHintLabel: resolveActionHintLabel(canUse, canShoot),
    };
}

export function resolveInventoryActionAvailability({
    player = null,
    modeType = 'CLASSIC',
    showMg = false,
} = {}) {
    const sourceInventory = Array.isArray(player?.inventory) ? player.inventory : [];
    const inventory = sourceInventory.some((type) => isRocketPickupType(type))
        ? sourceInventory.filter((type) => !isRocketPickupType(type))
        : sourceInventory;
    const inventoryLength = inventory.length;
    const selectedIndex = inventoryLength > 0
        ? Math.max(0, Math.min(Number(player?.selectedItemIndex) || 0, inventoryLength - 1))
        : -1;
    const rawType = selectedIndex >= 0 ? inventory[selectedIndex] : '';
    const rocketInventory = Array.isArray(player?.rocketInventory)
        ? player.rocketInventory
        : (inventory === sourceInventory ? [] : sourceInventory.filter((type) => isRocketPickupType(type)));
    const nextRocketType = rocketInventory[0] || '';
    const selectedState = resolvePickupActionAvailability({
        type: rawType,
        fallbackType: rawType,
        modeType,
        useCooldownRemaining: player?.itemUseCooldownRemaining,
        shootCooldownRemaining: player?.shootCooldown,
    });
    const rocketState = nextRocketType ? resolvePickupActionAvailability({
        type: nextRocketType,
        fallbackType: nextRocketType,
        modeType,
        useCooldownRemaining: player?.itemUseCooldownRemaining,
        shootCooldownRemaining: player?.shootCooldown,
    }) : null;
    const canShoot = rocketState?.canShoot === true || selectedState.canShoot;
    const canShootNow = rocketState?.canShootNow === true || selectedState.canShootNow;
    const canUse = selectedState.canUse;
    const canUseNow = selectedState.canUseNow;

    return {
        ...selectedState,
        type: rocketState?.type || selectedState.type,
        canUse,
        canUseNow,
        canShoot,
        canShootNow,
        selectedCanShoot: selectedState.canShoot,
        selectedCanShootNow: selectedState.canShootNow,
        canShootRocket: rocketState?.canShoot === true,
        canShootRocketNow: rocketState?.canShootNow === true,
        shootOnCooldown: canShoot && Math.max(0, Number(player?.shootCooldown) || 0) > GAMEPLAY_ACTION_COOLDOWN_EPSILON,
        hasCooldown: selectedState.useOnCooldown || (canShoot && Math.max(0, Number(player?.shootCooldown) || 0) > GAMEPLAY_ACTION_COOLDOWN_EPSILON),
        actionHintLabel: resolveActionHintLabel(canUse, canShoot),
        rawType,
        nextRocketType: rocketState?.type || '',
        rocketInventoryLength: rocketInventory.length,
        hasItem: selectedIndex >= 0,
        hasRocket: rocketInventory.length > 0,
        selectedIndex,
        inventoryLength,
        canCycle: inventoryLength > 1,
        showMg: showMg === true,
    };
}

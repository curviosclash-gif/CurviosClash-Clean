import { normalizePickupType } from '../shared/contracts/PickupRegistryContract.js';

// How much higher an enemy has to fly before the bot calls the strike. With less, the bot itself
// may be among the highest fifth - it never is a target (E47), but then the strike is wasted on
// someone barely above it.
const HEIGHT_MARGIN = 8;

/**
 * S6.5: a bot holding the lightning item calls the strike as soon as an enemy flies clearly
 * higher than itself. The generic item scorer cannot express "someone is above me", so the item
 * keeps a zero bot rule there and is used from this one place, like the flamethrower.
 * Answers the inventory slot to use, or -1.
 */
export function findLightningCastIndex(player, players) {
    if (!player?.position) return -1;
    const inventory = Array.isArray(player.inventory) ? player.inventory : [];
    const index = inventory.findIndex((item) => normalizePickupType(item, { fallback: item }) === 'LIGHTNING');
    if (index < 0) return -1;
    for (const other of players || []) {
        if (!other || other === player || other.alive !== true || !other.position) continue;
        if ((Number(other.spawnProtectionTimer) || 0) > 0) continue;
        if (other.position.y >= player.position.y + HEIGHT_MARGIN) return index;
    }
    return -1;
}

export function applyBotLightningInput(input, player, runtimeContext) {
    if (!input || Number.isInteger(input.useItem) && input.useItem >= 0) return;
    const players = Array.isArray(runtimeContext?.players) ? runtimeContext.players : [];
    const index = findLightningCastIndex(player, players);
    if (index >= 0) input.useItem = index;
}

import { normalizePickupType } from '../shared/contracts/PickupRegistryContract.js';
import { resolveEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';
import { HUNT_CONFIG } from './HuntConfig.js';

// A bot releases once the shot is worth 70 % of a full one and a target sits on its line.
const RELEASE_CHARGE_SHARE = 0.7;
// How straight a target has to sit in front of the nose to count as "on the line".
const LINE_DOT_MIN = 0.985;
// The item is armed when an enemy is within this share of the beam range.
const ARM_RANGE_SHARE = 0.6;

function railgunConfig(player) {
    return resolveEntityRuntimeConfig(player)?.HUNT?.RAILGUN || HUNT_CONFIG.RAILGUN;
}

function isEnemyTarget(player, target) {
    if (!target?.position || target === player) return false;
    if ('alive' in target && target.alive !== true) return false;
    if ('hp' in target && !(Number(target.hp) > 0)) return false;
    if ((Number(target.spawnProtectionTimer) || 0) > 0) return false;
    return target.ownerPlayer !== player && !(Number.isInteger(player.index) && target.ownerIndex === player.index);
}

/** Is any enemy (player or registry target) on the bot's line within beam range? */
export function hasRailgunLine(player, candidates, range, aim, offset) {
    for (const target of candidates) {
        if (!isEnemyTarget(player, target)) continue;
        offset.subVectors(target.position, player.position);
        const distance = offset.length();
        if (distance <= 0.001 || distance > range) continue;
        if (offset.dot(aim) / distance >= LINE_DOT_MIN) return true;
    }
    return false;
}

/** The inventory slot to arm the railgun from, or -1: only when an enemy is close enough. */
export function findRailgunArmIndex(player, players) {
    if (!player?.position || player.hasRailgun === true || player.hasFlamethrower === true) return -1;
    const inventory = Array.isArray(player.inventory) ? player.inventory : [];
    const index = inventory.findIndex((item) => normalizePickupType(item, { fallback: item }) === 'RAILGUN');
    if (index < 0) return -1;
    const armRange = (Number(railgunConfig(player)?.RANGE) || 250) * ARM_RANGE_SHARE;
    for (const other of players || []) {
        if (isEnemyTarget(player, other) && other.position.distanceTo(player.position) <= armRange) return index;
    }
    return -1;
}

/**
 * S6.10: an armed bot holds the key (charging) until the shot is worth 70 % of a full one, then
 * lets go as soon as an enemy sits on its line; without a target it keeps the charge. The scratch
 * vectors are the flamethrower ones every bot policy owns.
 */
export function applyBotRailgunInput(policy, input, player, runtimeContext) {
    if (!input || !player) return;
    const players = Array.isArray(runtimeContext?.players) ? runtimeContext.players : [];
    if (player.hasRailgun !== true) {
        const armIndex = findRailgunArmIndex(player, players);
        if (armIndex >= 0 && !(Number.isInteger(input.useItem) && input.useItem >= 0)) input.useItem = armIndex;
        return;
    }
    if (player.hasFlamethrower === true) return;
    const config = railgunConfig(player);
    const releaseAt = (Number(config?.CHARGE_SECONDS) || 1.5) * RELEASE_CHARGE_SHARE;
    if ((Number(player.railCharge) || 0) < releaseAt) {
        input.shootMG = true;
        return;
    }
    const aim = player.getAimDirection?.(policy._tmpFlameAim);
    if (!aim || aim.lengthSq() <= 0.000001) {
        input.shootMG = true;
        return;
    }
    aim.normalize();
    const range = Number(config?.RANGE) || 250;
    const registry = runtimeContext?.entityManager?._targetableRegistry?.collect?.() || [];
    const onLine = hasRailgunLine(player, players, range, aim, policy._tmpFlameOffset)
        || hasRailgunLine(player, registry, range, aim, policy._tmpFlameOffset);
    input.shootMG = !onLine;
}

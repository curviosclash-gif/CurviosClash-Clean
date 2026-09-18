import { isInsideFlameCone } from './FlamethrowerSystem.js';
import { resolveEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';
import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';
import { normalizePickupType } from '../shared/contracts/PickupRegistryContract.js';

const DEFAULT_RANGE = 18;
const DEFAULT_CONE_DEGREES = 30;
const DEFAULT_HITBOX_RADIUS = 0.8;
// Two cone lengths of warning: close enough that the thirty second item is not spent on an
// empty corridor, far enough that the tank is lit before the enemy is in reach.
const ARM_RANGE_FACTOR = 2;

function positiveNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Two plain numbers instead of one result object: this runs once per bot per frame.
function resolveFlameRange(player) {
    return positiveNumber(resolveEntityRuntimeConfig(player)?.HUNT?.FLAMETHROWER?.RANGE, DEFAULT_RANGE);
}

function resolveFlameTanHalfAngle(player) {
    const coneDegrees = positiveNumber(resolveEntityRuntimeConfig(player)?.HUNT?.FLAMETHROWER?.CONE_DEGREES, DEFAULT_CONE_DEGREES);
    return Math.tan((Math.min(179, coneDegrees) * 0.5 * Math.PI) / 180);
}

function readAimDirection(player, scratch) {
    if (!scratch) return null;
    if (typeof player?.getAimDirection === 'function') player.getAimDirection(scratch);
    else if (typeof player?.getDirection === 'function') player.getDirection(scratch);
    else return null;
    if (scratch.lengthSq() <= 0.000001) return null;
    return scratch.normalize();
}

/**
 * E79: with a lit tank the held machine gun key sprays fire instead of bullets, so a bot may only
 * hold it while the enemy stands inside the flame cone. Outside it the key would burn the six
 * second tank on empty air - and in Classic, where there is no machine gun at all, the same key
 * is the only way to burn a gap into a trail (E14).
 *
 * The cone test is the very one the flame itself uses, so the bot never claims a hit the system
 * would refuse. Both scratch vectors belong to the calling policy: nothing is allocated per frame.
 */
export function shouldBotHoldFlame(player, enemy, aimScratch, offsetScratch) {
    if (player?.hasFlamethrower !== true || !player.position) return false;
    if (enemy?.alive !== true || !enemy.position) return false;
    const aim = readAimDirection(player, aimScratch);
    if (!aim) return false;
    const range = resolveFlameRange(player);
    const tanHalfAngle = resolveFlameTanHalfAngle(player);
    const radius = Math.max(
        0.2,
        Number(enemy.hitboxRadius) || Number(resolveGameplayConfig(enemy).PLAYER?.HITBOX_RADIUS) || DEFAULT_HITBOX_RADIUS,
    );
    return isInsideFlameCone(player.position, aim, enemy.position, radius, range, tanHalfAngle, offsetScratch);
}

/**
 * Answers the inventory slot the bot should activate, or -1. The generic item scorer cannot
 * express "two cone lengths away", which is why the flamethrower keeps a zero bot rule there and
 * is armed from this one place instead.
 */
export function findFlamethrowerArmIndex(player, enemyDistanceSq) {
    if (!player || player.hasFlamethrower === true) return -1;
    const distanceSq = Number(enemyDistanceSq);
    if (!Number.isFinite(distanceSq)) return -1;
    const inventory = Array.isArray(player.inventory) ? player.inventory : [];
    let index = -1;
    for (let i = 0; i < inventory.length; i += 1) {
        if (normalizePickupType(inventory[i], { fallback: inventory[i] }) !== 'FLAMETHROWER') continue;
        index = i;
        break;
    }
    if (index < 0) return -1;
    const armRange = resolveFlameRange(player) * ARM_RANGE_FACTOR;
    return distanceSq <= armRange * armRange ? index : -1;
}

/**
 * Both decisions in one call, because every caller needs them together: hold the key while the
 * enemy burns, and light the tank while he is still closing in.
 */
export function applyBotFlamethrowerInput(policy, input, player, enemy, enemyDistanceSq) {
    if (!input || !player) return;
    if (player.hasFlamethrower === true) {
        input.shootMG = shouldBotHoldFlame(player, enemy, policy?._tmpFlameAim, policy?._tmpFlameOffset);
        return;
    }
    const armIndex = findFlamethrowerArmIndex(player, enemyDistanceSq);
    if (armIndex >= 0 && !(Number.isInteger(input.useItem) && input.useItem >= 0)) {
        input.useItem = armIndex;
    }
}

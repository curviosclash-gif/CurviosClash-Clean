// ============================================
// PlayerChargeOps.js - boost and slow-motion reserves
// ============================================
//
// Contract:
// - Inputs: player entity, game-time dt, resolved control state
// - Outputs: boost/slow-motion charge, timers and active flags on the player
// - Side effects: mutates the player reserve fields only
// - Hotpath guardrail: no per-frame object creation, primitive parameters only

import { resolveEntityRuntimeConfig } from '../../shared/contracts/EntityRuntimeConfig.js';

const MIN_CAPACITY = 0.001;
const MIN_CLOCK_SCALE = 0.05;
const EMPTY_CHARGE_EPSILON = 0.0001;

function resolvePlayerConfigValue(player, key, fallback) {
    const value = Number(resolveEntityRuntimeConfig(player)?.PLAYER?.[key]);
    return Number.isFinite(value) && value !== 0 ? value : fallback;
}

function resolveBoostCapacity(player) {
    return Math.max(MIN_CAPACITY, resolvePlayerConfigValue(player, 'BOOST_DURATION', 1));
}

function resolveBoostRechargeTime(player) {
    return Math.max(MIN_CAPACITY, resolvePlayerConfigValue(player, 'BOOST_COOLDOWN', 1));
}

function resolveSlowMoCapacity(player) {
    return Math.max(MIN_CAPACITY, resolvePlayerConfigValue(player, 'SLOWMO_DURATION', 1));
}

function resolveSlowMoRechargeTime(player) {
    return Math.max(MIN_CAPACITY, resolvePlayerConfigValue(player, 'SLOWMO_COOLDOWN', 1));
}

function resolveSlowMoTimeScale(player) {
    const scale = resolvePlayerConfigValue(player, 'SLOWMO_TIME_SCALE', 0.4);
    return Math.max(MIN_CLOCK_SCALE, Math.min(1, scale));
}

function resolveRechargeBonus(player, key) {
    return Math.max(1, resolvePlayerConfigValue(player, key, 1));
}

function clampClockScale(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 1;
    return Math.max(MIN_CLOCK_SCALE, Math.min(1, numeric));
}

function resolvePlayerTimeScale(candidate) {
    let scale = 1;
    // Dead players stop updating, so their last clock effect must not outlive them.
    if (candidate?.alive === false) return scale;
    if (candidate?.hasSlowTime) {
        const powerupScale = Number(candidate.slowTimeScale);
        if (Number.isFinite(powerupScale)) {
            scale = Math.min(scale, powerupScale);
        }
    }
    if (candidate?.manualSlowMoActive === true) {
        scale = Math.min(scale, resolveSlowMoTimeScale(candidate));
    }
    return scale;
}

/**
 * Clock factor for an explicit player list: the slowest of every living player's
 * SLOW_TIME powerup and held slow-motion key. This is the single source of the rule;
 * the game loop and both reserves are fed from it.
 * @param {Array<object>|null} players
 * @returns {number} clock factor in [0.05, 1]
 */
export function resolveTimeScaleForPlayers(players) {
    let scale = 1;
    if (Array.isArray(players)) {
        for (let i = 0; i < players.length; i += 1) {
            scale = Math.min(scale, resolvePlayerTimeScale(players[i]));
        }
    }
    return clampClockScale(scale);
}

/**
 * Current global clock factor seen from one player. Slow motion is a global effect,
 * so one player slows all; a player without a match context only sees itself.
 * @param {object} player
 * @returns {number} clock factor in [0.05, 1]
 */
export function resolveGlobalTimeScale(player) {
    const players = player?.entityManager?.players;
    if (Array.isArray(players)) {
        return resolveTimeScaleForPlayers(players);
    }
    return clampClockScale(resolvePlayerTimeScale(player));
}

/**
 * Whether this player itself is bending the clock with the key. Bullet time is the
 * reward for pressing it, so bots and dead players never qualify.
 * @param {object} player
 * @returns {boolean}
 */
function isOwnSlowMoActive(player) {
    return player?.manualSlowMoActive === true
        && player?.alive !== false
        && player?.isBot !== true;
}

/**
 * Bullet time: the player holding the key keeps moving, turning and burning boost on
 * the real clock while the world runs on the global factor. Everyone else gets 1.
 * The SLOW_TIME powerup alone never speeds anybody up - only the own key does.
 * @param {object} player
 * @returns {number} factor to multiply the motion time step with
 */
export function resolveMotionClockFactor(player) {
    if (!isOwnSlowMoActive(player)) return 1;
    return 1 / clampClockScale(resolveGlobalTimeScale(player));
}

/**
 * Whether any living player currently holds the slow-motion key. Only the key counts,
 * not the SLOW_TIME powerup: the powerup keeps its established behaviour, while the
 * key is the reserve that couples the two meters.
 * @param {object} player
 * @returns {boolean}
 */
export function isSlowMoKeyActive(player) {
    const players = Array.isArray(player?.entityManager?.players)
        ? player.entityManager.players
        : null;
    if (!players) {
        return player?.manualSlowMoActive === true && player?.alive !== false;
    }
    for (let i = 0; i < players.length; i += 1) {
        const candidate = players[i];
        if (candidate?.alive === false) continue;
        if (candidate?.manualSlowMoActive === true) return true;
    }
    return false;
}

function clampCharge(player, chargeKey, capacity) {
    const value = Number(player[chargeKey]);
    if (!Number.isFinite(value)) {
        player[chargeKey] = capacity;
    } else if (value < 0) {
        player[chargeKey] = 0;
    } else if (value > capacity) {
        player[chargeKey] = capacity;
    }
}

// Shared reserve step for boost and slow motion: resolve the toggle, drain while
// active, refill otherwise. `consumeDt` and `rechargeDt` already carry the clock
// each reserve uses, so this routine stays free of any time-scale knowledge.
// `botsMayActivate` is false for slow motion: bots never bend the global clock.
function stepChargeReserve(
    player,
    chargeKey,
    activeKey,
    capacity,
    rechargeRate,
    consumeDt,
    rechargeDt,
    held,
    pressed,
    botsMayActivate
) {
    clampCharge(player, chargeKey, capacity);
    const minActivationCharge = Math.max(0.05, capacity * 0.02);

    if (player.isBot) {
        player[activeKey] = botsMayActivate && held && player[chargeKey] > minActivationCharge;
    } else if (pressed) {
        if (player[activeKey]) {
            player[activeKey] = false;
        } else if (player[chargeKey] > minActivationCharge) {
            player[activeKey] = true;
        }
    }

    if (player[activeKey]) {
        player[chargeKey] = Math.max(0, player[chargeKey] - consumeDt);
        if (player[chargeKey] <= EMPTY_CHARGE_EPSILON) {
            player[chargeKey] = 0;
            player[activeKey] = false;
        }
    } else if (player[chargeKey] < capacity) {
        player[chargeKey] = Math.min(capacity, player[chargeKey] + rechargeRate * rechargeDt);
    }

    return player[activeKey] === true;
}

function syncBoostUiState(player, maxCharge, rechargeRate) {
    player.boostTimer = player.boostCharge;
    const missingCharge = Math.max(0, maxCharge - player.boostCharge);
    player.boostCooldown = rechargeRate > 0 ? missingCharge / rechargeRate : 0;
}

function syncSlowMoUiState(player, maxCharge, rechargeRate) {
    player.slowMoTimer = player.slowMoCharge;
    const missingCharge = Math.max(0, maxCharge - player.slowMoCharge);
    player.slowMoCooldown = rechargeRate > 0 ? missingCharge / rechargeRate : 0;
}

/**
 * Fills both reserves and clears their active state. Used on construction and on
 * every spawn so a fresh round always starts with a full boost and full slow motion.
 * @param {object} player
 * @param {object|null} playerConfig resolved PLAYER config section, optional
 */
export function resetPlayerCharges(player, playerConfig = null) {
    if (!player) return;
    const boostDuration = Number(playerConfig?.BOOST_DURATION);
    const slowMoDuration = Number(playerConfig?.SLOWMO_DURATION);
    player.boostCharge = Number.isFinite(boostDuration) ? boostDuration : resolveBoostCapacity(player);
    player.boostTimer = player.boostCharge;
    player.boostCooldown = 0;
    player.manualBoostActive = false;
    player.isBoosting = false;
    player.slowMoCharge = Number.isFinite(slowMoDuration) ? slowMoDuration : resolveSlowMoCapacity(player);
    player.slowMoTimer = player.slowMoCharge;
    player.slowMoCooldown = 0;
    player.manualSlowMoActive = false;
    player.isSlowMoActive = false;
}

/**
 * Boost reserve. Consumption stays on game time. Recharge stays on game time too,
 * unless slow motion is active: then fewer simulation steps happen per real second,
 * so the refill is converted to the real clock and multiplied by the slow-motion bonus.
 * @returns {boolean} whether manual boost is active after this step
 */
export function updateBoostState(
    player,
    dt,
    controlState = null,
    timeScale = 1,
    slowMoActive = false,
    selfSlowMoActive = false
) {
    const maxCharge = resolveBoostCapacity(player);
    const rechargeRate = maxCharge / resolveBoostRechargeTime(player);
    const rechargeDt = slowMoActive
        ? (dt / clampClockScale(timeScale)) * resolveRechargeBonus(player, 'SLOWMO_BOOST_RECHARGE_BONUS')
        : dt;
    // Bullet time also covers 2.5x the distance per real second, so the reserve has to
    // be spent on the real clock too - otherwise one boost would last 10 real seconds.
    const consumeDt = selfSlowMoActive ? dt / clampClockScale(timeScale) : dt;

    const active = stepChargeReserve(
        player,
        'boostCharge',
        'manualBoostActive',
        maxCharge,
        rechargeRate,
        consumeDt,
        rechargeDt,
        !!controlState?.boost,
        !!controlState?.boostPressed,
        true
    );

    syncBoostUiState(player, maxCharge, rechargeRate);
    return active;
}

/**
 * Slow-motion reserve. Consumption runs on the real clock so SLOWMO_DURATION means
 * real seconds (same contract as the SLOW_TIME powerup). Recharge runs on game time
 * and gains the boost bonus while boost is active.
 * @returns {boolean} whether manual slow motion is active after this step
 */
export function updateSlowMoState(player, dt, controlState = null, timeScale = 1, boostActive = false) {
    const maxCharge = resolveSlowMoCapacity(player);
    const rechargeRate = maxCharge / resolveSlowMoRechargeTime(player);
    const consumeDt = dt / clampClockScale(timeScale);
    const rechargeDt = boostActive
        ? dt * resolveRechargeBonus(player, 'BOOST_SLOWMO_RECHARGE_BONUS')
        : dt;

    const active = stepChargeReserve(
        player,
        'slowMoCharge',
        'manualSlowMoActive',
        maxCharge,
        rechargeRate,
        consumeDt,
        rechargeDt,
        !!controlState?.slowMo,
        !!controlState?.slowMoPressed,
        false
    );

    player.isSlowMoActive = active;
    syncSlowMoUiState(player, maxCharge, rechargeRate);
    return active;
}

/**
 * Updates both reserves for one simulation step. The clock factor and both active
 * flags are snapshotted first, so the coupling always reads the state the game loop
 * used to produce this dt instead of a half-updated frame. The boost bonus follows
 * the key of ANY living player, because slow motion slows the clock for everyone:
 * a player who did not press it loses just as many simulation steps per real second.
 * @returns {boolean} whether manual boost is active after this step
 */
export function updatePlayerCharges(player, dt, controlState = null) {
    const timeScale = resolveGlobalTimeScale(player);
    const slowMoKeyActive = isSlowMoKeyActive(player);
    const ownSlowMoActive = isOwnSlowMoActive(player);
    const boostWasActive = player.manualBoostActive === true;

    updateSlowMoState(player, dt, controlState, timeScale, boostWasActive);
    return updateBoostState(player, dt, controlState, timeScale, slowMoKeyActive, ownSlowMoActive);
}

// ============================================
// ArcadeBaseRegenOps.js - Paket 1: base regeneration of normal Arcade runs.
// 2 % of max HP per second, starting ARCADE_BASE_REGEN_DELAY_S after the last hit (the hull
// build shortens the delay via player.arcadeRegenDelay, never below 1 s). It replaces the Hunt
// regen in normal runs; daily challenge and weapon race keep their old rules. Hits and regen
// read the same simulation clock, so a paused or slowed match waits just as long as it plays.
// Lives here because ArcadeModeStrategy.js is at its max-lines cap. Runs per player per frame:
// allocation-free.
// ============================================

import {
    ARCADE_BASE_REGEN_DELAY_S,
    ARCADE_BASE_REGEN_PCT_PER_SECOND,
    ARCADE_MIN_REGEN_DELAY_S,
} from '../shared/contracts/ArcadeVehicleBalanceContract.js';

/**
 * Simulation clock of the entity manager in seconds; without one the fallback (strategy clock).
 * @param {any} entityManager
 * @param {number} fallbackSeconds
 */
export function resolveArcadeSimulationSeconds(entityManager, fallbackSeconds) {
    const clockMs = Number(entityManager?._simulationClockMs);
    return Number.isFinite(clockMs) ? Math.max(0, clockMs) * 0.001 : fallbackSeconds;
}

/**
 * Hunt-profile damage stamps its own clock when the caller passes no time. In normal runs the
 * base regen compares against the simulation clock, so a real hit (applied > 0) is re-stamped.
 * @param {any} player
 * @param {any} result damage result of the Hunt strategy
 * @param {any} options damage options of the caller
 * @param {boolean} isNormalRun
 */
export function stampArcadeHitOnSimulationClock(player, result, options, isNormalRun) {
    if (isNormalRun && options?.nowSeconds == null && Number(result?.applied) > 0) {
        const clockMs = Number(player?.entityManager?._simulationClockMs);
        if (Number.isFinite(clockMs)) player.lastDamageTimestamp = Math.max(0, clockMs) * 0.001;
    }
    return result;
}

/**
 * Heals ARCADE_BASE_REGEN_PCT_PER_SECOND of max HP per second once the hit delay has passed.
 * @param {any} player
 * @param {number} dt
 * @param {number} nowSeconds simulation clock
 * @param {boolean} suddenDeathActive Sudden Death blocks every heal
 * @returns {null}
 */
export function updateArcadeBaseRegen(player, dt, nowSeconds, suddenDeathActive) {
    if (!player || suddenDeathActive) return null;
    const hp = Number(player.hp);
    const maxHp = Number(player.maxHp);
    if (!(hp > 0) || !(maxHp > 0) || hp >= maxHp) return null;
    const buildDelay = player.arcadeRegenDelay;
    const delay = Number.isFinite(buildDelay) ? Math.max(ARCADE_MIN_REGEN_DELAY_S, buildDelay) : ARCADE_BASE_REGEN_DELAY_S;
    const lastHit = Number(player.lastDamageTimestamp);
    if (Number.isFinite(lastHit) && nowSeconds - lastHit < delay) return null;
    player.hp = Math.min(maxHp, hp + maxHp * (ARCADE_BASE_REGEN_PCT_PER_SECOND / 100) * Math.max(0, Number(dt) || 0));
    return null;
}

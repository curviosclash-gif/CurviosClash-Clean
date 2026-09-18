// Arcade XP rewards: the payout table and the per-sector XP sum.
// Kept apart from ArcadeVehicleProfile so the profile file stays inside max-lines.

import { toSafeNumber } from '../../shared/utils/ArcadeUtils.js';

export const XP_REWARD_TABLE = Object.freeze({
    sectorComplete: 50,
    killBase: 15,
    // E38: shooting down an incoming rocket pays, but clearly below a kill.
    interceptBase: 10,
    missionComplete: 80,
    allMissionsBonus: 120,
    cleanSector: 40,
    comboMultiplierCap: 3.0,
    parcoursCheckpoint: 10,
    parcoursFinish: 80,
    parcoursNewBestTime: 40,
});

/**
 * Sums the XP a finished arcade sector is worth.
 *
 * Telemetry written before S2.4 carries no `intercepts` field; a missing, negative or
 * unreadable count contributes nothing, so those callers keep their old result.
 *
 * @param {any} telemetry
 * @returns {number}
 */
export function calculateSectorXp(telemetry) {
    if (!telemetry || typeof telemetry !== 'object') return 0;
    const kills = Math.max(0, toSafeNumber(telemetry.kills, 0));
    const intercepts = Math.max(0, toSafeNumber(telemetry.intercepts, 0));
    const comboMultiplier = Math.min(
        XP_REWARD_TABLE.comboMultiplierCap,
        Math.max(1, toSafeNumber(telemetry.multiplier, 1))
    );
    const missionsCompleted = Math.max(0, toSafeNumber(telemetry.missionsCompleted, 0));
    const totalMissions = Math.max(0, toSafeNumber(telemetry.totalMissions, 0));
    const isClean = telemetry.cleanSector === true;

    let xp = XP_REWARD_TABLE.sectorComplete;
    xp += kills * XP_REWARD_TABLE.killBase;
    xp += intercepts * XP_REWARD_TABLE.interceptBase;
    xp += missionsCompleted * XP_REWARD_TABLE.missionComplete;
    if (totalMissions > 0 && missionsCompleted >= totalMissions) {
        xp += XP_REWARD_TABLE.allMissionsBonus;
    }
    if (isClean) xp += XP_REWARD_TABLE.cleanSector;

    return Math.floor(xp * comboMultiplier);
}

export default {
    XP_REWARD_TABLE,
    calculateSectorXp,
};

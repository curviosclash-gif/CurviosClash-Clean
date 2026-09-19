import { TEAM_IDS } from './TeamCombatContract.js';

export const ESCORT_DEFAULTS = Object.freeze({
    tankMaxHp: 600,
    baseSpeed: 6,
    escortedSpeed: 10,
    escortRadius: 30,
    pathSeconds: 180,
    roundSeconds: 300,
});

export function resolveEscortTankSpeed(hasAlphaEscort) {
    return hasAlphaEscort ? ESCORT_DEFAULTS.escortedSpeed : ESCORT_DEFAULTS.baseSpeed;
}

/** @param {{ tankAlive?: boolean, reachedGoal?: boolean, elapsedSeconds?: number }} [state] */
export function resolveEscortOutcome({ tankAlive, reachedGoal, elapsedSeconds } = {}) {
    if (reachedGoal === true) return { shouldEnd: true, winnerTeamId: TEAM_IDS.ALPHA, reason: 'ESCORT_GOAL' };
    if (tankAlive === false) return { shouldEnd: true, winnerTeamId: TEAM_IDS.BRAVO, reason: 'ESCORT_TANK_DESTROYED' };
    if (Math.max(0, Number(elapsedSeconds) || 0) >= ESCORT_DEFAULTS.roundSeconds) {
        return { shouldEnd: true, winnerTeamId: TEAM_IDS.BRAVO, reason: 'ESCORT_TIME_LIMIT' };
    }
    return null;
}

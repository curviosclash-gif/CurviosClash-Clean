import { normalizeTeamId, TEAM_IDS } from './TeamCombatContract.js';

export const TEAM_OBJECTIVE_TYPES = Object.freeze({
    HUNT: 'HUNT',
    FLAGS: 'FLAGS',
    ESCORT: 'ESCORT',
});

export const FLAG_OBJECTIVE_DEFAULTS = Object.freeze({
    flagsPerTeam: 3,
    maxHp: 300,
    protectionSeconds: 10,
    guardsPerFlag: 2,
    roundSeconds: 480,
});

export const FLAG_OBJECTIVE_REASONS = Object.freeze({
    DOMINATION: 'FLAG_DOMINATION',
    TIME_LIMIT: 'FLAG_TIME_LIMIT',
    OVERTIME: 'FLAG_OVERTIME',
});

export function normalizeTeamObjectiveType(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === TEAM_OBJECTIVE_TYPES.FLAGS) return TEAM_OBJECTIVE_TYPES.FLAGS;
    if (normalized === TEAM_OBJECTIVE_TYPES.ESCORT) return TEAM_OBJECTIVE_TYPES.ESCORT;
    return TEAM_OBJECTIVE_TYPES.HUNT;
}

/** @param {{ id?: unknown, teamId?: unknown, maxHp?: number }} [options] */
export function createFlagObjectiveState({ id, teamId, maxHp = FLAG_OBJECTIVE_DEFAULTS.maxHp } = {}) {
    const normalizedMaxHp = Math.max(1, Number(maxHp) || FLAG_OBJECTIVE_DEFAULTS.maxHp);
    return {
        id: String(id || 'flag'),
        teamId: normalizeTeamId(teamId) || TEAM_IDS.ALPHA,
        hp: normalizedMaxHp,
        maxHp: normalizedMaxHp,
        protectionRemaining: 0,
    };
}

export function damageFlagObjective(flag, amount, attackerTeamId) {
    const attackerTeam = normalizeTeamId(attackerTeamId);
    const currentTeam = normalizeTeamId(flag?.teamId);
    const requested = Math.max(0, Number(amount) || 0);
    if (!flag || !attackerTeam || attackerTeam === currentTeam || flag.protectionRemaining > 0 || requested <= 0) {
        return { applied: 0, hpApplied: 0, remainingHp: Math.max(0, Number(flag?.hp) || 0), captured: false };
    }
    const before = Math.max(0, Number(flag.hp) || 0);
    const applied = Math.min(before, requested);
    flag.hp = before - applied;
    if (flag.hp > 0) return { applied, hpApplied: applied, remainingHp: flag.hp, captured: false };
    flag.teamId = attackerTeam;
    flag.hp = Math.max(1, Number(flag.maxHp) || FLAG_OBJECTIVE_DEFAULTS.maxHp);
    flag.protectionRemaining = FLAG_OBJECTIVE_DEFAULTS.protectionSeconds;
    return { applied, hpApplied: applied, remainingHp: flag.hp, captured: true };
}

export function tickFlagObjectiveProtection(flag, dt) {
    if (!flag) return 0;
    flag.protectionRemaining = Math.max(0, (Number(flag.protectionRemaining) || 0) - Math.max(0, Number(dt) || 0));
    return flag.protectionRemaining;
}

export function countFlagsByTeam(flags = []) {
    const counts = { [TEAM_IDS.ALPHA]: 0, [TEAM_IDS.BRAVO]: 0 };
    for (const flag of flags) {
        const teamId = normalizeTeamId(flag?.teamId);
        if (teamId) counts[teamId] += 1;
    }
    return counts;
}

export function resolveFlagObjectiveOutcome(flags = [], elapsedSeconds = 0) {
    const flagCounts = countFlagsByTeam(flags);
    const totalFlags = flagCounts.ALPHA + flagCounts.BRAVO;
    if (totalFlags > 0 && (flagCounts.ALPHA === totalFlags || flagCounts.BRAVO === totalFlags)) {
        return {
            shouldEnd: true,
            winnerTeamId: flagCounts.ALPHA === totalFlags ? TEAM_IDS.ALPHA : TEAM_IDS.BRAVO,
            flagCounts,
            overtime: false,
            reason: FLAG_OBJECTIVE_REASONS.DOMINATION,
        };
    }
    if (Math.max(0, Number(elapsedSeconds) || 0) < FLAG_OBJECTIVE_DEFAULTS.roundSeconds) return null;
    const winnerTeamId = flagCounts.ALPHA === flagCounts.BRAVO
        ? null
        : (flagCounts.ALPHA > flagCounts.BRAVO ? TEAM_IDS.ALPHA : TEAM_IDS.BRAVO);
    if (!winnerTeamId) {
        return {
            shouldEnd: false,
            winnerTeamId: null,
            flagCounts,
            overtime: true,
            reason: FLAG_OBJECTIVE_REASONS.OVERTIME,
        };
    }
    return {
        shouldEnd: true,
        winnerTeamId,
        flagCounts,
        overtime: false,
        reason: FLAG_OBJECTIVE_REASONS.TIME_LIMIT,
    };
}

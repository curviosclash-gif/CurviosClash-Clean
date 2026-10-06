import { TEAM_IDS, areTeammates } from './TeamCombatContract.js';

// Allied bots that fly with a lone human through a normal arcade run. The human and the
// companions form team ALPHA, the sector squad team BRAVO, so the existing team rules
// (target choice, damage, colors) decide who fights whom.
export const ARCADE_COMPANION_MAX = 2;
export const ARCADE_COMPANION_TEAM_ID = TEAM_IDS.ALPHA;
export const ARCADE_ENEMY_TEAM_ID = TEAM_IDS.BRAVO;
// A companion kill feeds the sector goals but only half the points: helpers must not
// inflate the score a player earns alone.
export const ARCADE_COMPANION_KILL_SCORE_FACTOR = 0.5;
// Companions press a little harder than a neutral bot but never take the squad's pressure.
export const ARCADE_COMPANION_AGGRESSIVENESS = 0.6;

/** @param {unknown} value @returns {number} */
export function normalizeArcadeCompanionCount(value) {
    const parsed = Math.trunc(Number(value));
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(ARCADE_COMPANION_MAX, parsed));
}

/**
 * Companions fly only in a normal gauntlet run (no daily, no special run type), only next to
 * exactly one human and only in a sector that has an enemy squad.
 * @param {{ enabled?: unknown, runType?: unknown, dailyChallenge?: unknown, companionCount?: unknown } | null | undefined} arcade
 * @param {{ humanCount?: unknown, enemyCount?: unknown }} [context]
 * @returns {number}
 */
export function resolveActiveArcadeCompanionCount(arcade, { humanCount = 1, enemyCount = 0 } = {}) {
    if (!arcade || arcade.enabled !== true || arcade.dailyChallenge === true) return 0;
    if (String(arcade.runType || 'gauntlet').trim().toLowerCase() !== 'gauntlet') return 0;
    if (Math.trunc(Number(humanCount)) !== 1 || !(Math.trunc(Number(enemyCount)) > 0)) return 0;
    return normalizeArcadeCompanionCount(arcade.companionCount);
}

/**
 * Team ids for the entity setup: humans first, then the bot slots in creation order - the
 * enemy squad before the companions.
 * @param {{ humanCount?: unknown, enemyCount?: unknown, companionCount?: unknown }} counts
 * @returns {{ humanTeamIds: string[], botTeamIds: string[] }}
 */
export function buildArcadeCompanionTeamPlan({ humanCount = 1, enemyCount = 0, companionCount = 0 } = {}) {
    const humans = Math.max(0, Math.trunc(Number(humanCount)) || 0);
    const enemies = Math.max(0, Math.trunc(Number(enemyCount)) || 0);
    const companions = normalizeArcadeCompanionCount(companionCount);
    return {
        humanTeamIds: Array.from({ length: humans }, () => ARCADE_COMPANION_TEAM_ID),
        botTeamIds: [
            ...Array.from({ length: enemies }, () => ARCADE_ENEMY_TEAM_ID),
            ...Array.from({ length: companions }, () => ARCADE_COMPANION_TEAM_ID),
        ],
    };
}

/** @param {{ isBot?: unknown, isArcadeCompanion?: unknown } | null | undefined} player @returns {boolean} */
export function isArcadeCompanion(player) {
    return player?.isBot === true && player?.isArcadeCompanion === true;
}

/**
 * True for the human and a companion of the same team (or two companions): arcade spares
 * them every friendly hit - trails, machine gun, EMP and ship crashes.
 * @param {{ isBot?: unknown, isArcadeCompanion?: unknown, teamId?: unknown } | null | undefined} first
 * @param {{ isBot?: unknown, isArcadeCompanion?: unknown, teamId?: unknown } | null | undefined} second
 * @returns {boolean}
 */
export function isArcadeCompanionTeamPair(first, second) {
    if (!first || !second || first === second) return false;
    return (isArcadeCompanion(first) || isArcadeCompanion(second)) && areTeammates(first, second);
}

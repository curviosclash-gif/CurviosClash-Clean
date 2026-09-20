import {
    normalizeTeamId,
    resolveBalancedTeamId,
    resolveTeamColor,
    resolveTeamLabel,
    TEAM_IDS,
} from './TeamCombatContract.js';

export const TEAM_HUNT_DEFAULT_TEAM_SIZE = 4;

const VALID_BOT_DIFFICULTIES = new Set(['EASY', 'NORMAL', 'HARD']);

function normalizeDifficulty(value, fallback = 'NORMAL') {
    const normalized = String(value || '').trim().toUpperCase();
    return VALID_BOT_DIFFICULTIES.has(normalized) ? normalized : fallback;
}

export function normalizeTeamHuntSettings(source = {}) {
    const teamSize = Math.max(1, Math.min(5, Math.trunc(Number(source?.teamSize) || TEAM_HUNT_DEFAULT_TEAM_SIZE)));
    return {
        enabled: source?.teamMode === true,
        teamSize,
        botDifficulty: {
            [TEAM_IDS.ALPHA]: normalizeDifficulty(source?.teamBotDifficulty?.[TEAM_IDS.ALPHA]),
            [TEAM_IDS.BRAVO]: normalizeDifficulty(source?.teamBotDifficulty?.[TEAM_IDS.BRAVO]),
        },
    };
}

export function resolveTeamRoster({ humanCount = 0, teamSize = TEAM_HUNT_DEFAULT_TEAM_SIZE } = {}) {
    const normalizedTeamSize = Math.max(1, Math.min(5, Math.trunc(Number(teamSize) || TEAM_HUNT_DEFAULT_TEAM_SIZE)));
    const normalizedHumanCount = Math.max(0, Math.trunc(Number(humanCount) || 0));
    const effectiveTeamSize = Math.max(normalizedTeamSize, Math.ceil(normalizedHumanCount / 2));
    const totalSlots = effectiveTeamSize * 2;
    return {
        totalSlots,
        botCount: totalSlots - normalizedHumanCount,
        teamIds: Array.from({ length: totalSlots }, (_, index) => resolveBalancedTeamId(index)),
    };
}

export function createTeamScoreboard(rows = [], players = [], { scoreKey = 'kills' } = {}) {
    const playerByIndex = new Map((players || [])
        .filter((player) => Number.isInteger(player?.index))
        .map((player) => [player.index, player]));
    const teams = new Map();
    for (const teamId of Object.values(TEAM_IDS)) {
        teams.set(teamId, {
            teamId,
            label: resolveTeamLabel(teamId),
            color: resolveTeamColor(teamId),
            playerIndex: -1,
            playerIndices: [],
            kills: 0,
            points: 0,
            deaths: 0,
            assists: 0,
            damage: 0,
            shieldDamage: 0,
            intercepts: 0,
            unitsDestroyed: 0,
            burnedTrailMeters: 0,
            flagCaptures: 0,
            repairDroneHpRestored: 0,
            escortSeconds: 0,
            escortTankDamage: 0,
            escortGuardKills: 0,
            escortAttackKills: 0,
            escortCheckpointContributions: 0,
            escortRepairHp: 0,
            escortRecoveries: 0,
            escortTankDowns: 0,
            escortFinalDestructions: 0,
        });
    }
    for (const row of rows || []) {
        const playerIndex = Number(row?.playerIndex);
        const teamId = normalizeTeamId(playerByIndex.get(playerIndex)?.teamId);
        const team = teams.get(teamId);
        if (!team || !Number.isInteger(playerIndex)) continue;
        if (team.playerIndex < 0) team.playerIndex = playerIndex;
        team.playerIndices.push(playerIndex);
        for (const key of [
            'kills', 'points', 'deaths', 'assists', 'damage', 'shieldDamage', 'intercepts',
            'unitsDestroyed', 'burnedTrailMeters', 'flagCaptures', 'repairDroneHpRestored',
            'escortSeconds', 'escortTankDamage', 'escortGuardKills', 'escortAttackKills',
            'escortCheckpointContributions', 'escortRepairHp', 'escortRecoveries',
            'escortTankDowns', 'escortFinalDestructions',
        ]) {
            team[key] += Math.max(0, Number(row?.[key]) || 0);
        }
    }
    const metric = scoreKey === 'points' ? 'points' : 'kills';
    return [...teams.values()]
        .filter((team) => team.playerIndices.length > 0)
        .sort((left, right) => right[metric] - left[metric] || left.teamId.localeCompare(right.teamId));
}

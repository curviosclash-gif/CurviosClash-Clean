// Public, bounded lobby facts. Personal settings and complete match snapshots
// stay out of discovery/status messages.
import { HUNT_WIN_CONDITIONS, normalizeHuntWinCondition } from './HuntWinConditionContract.js';
import { FLAG_OBJECTIVE_DEFAULTS, normalizeTeamObjectiveType, TEAM_OBJECTIVE_TYPES } from './FlagObjectiveContract.js';
import { ESCORT_DEFAULTS } from './EscortObjectiveContract.js';
import { normalizeTeamHuntSettings, resolveTeamRoster } from './TeamHuntContract.js';

export function normalizeLobbyMatchSummary(value) {
    if (!value || typeof value !== 'object') return null;
    const bounded = (candidate, min, max) => candidate != null && Number.isFinite(Number(candidate))
        ? Math.max(min, Math.min(max, Math.floor(Number(candidate)))) : null;
    const summary = {
        numBots: bounded(value.numBots, 0, 99),
        botDifficulty: ['EASY', 'NORMAL', 'HARD'].includes(value.botDifficulty) ? value.botDifficulty : null,
        targetKind: ['wins', 'kills', 'sectors', 'points', 'lives', 'flags', 'escort'].includes(value.targetKind)
            ? value.targetKind
            : null,
        targetValue: value.targetValue == null ? null : bounded(value.targetValue, 1, 9999),
    };
    if (value.winCondition != null) summary.winCondition = normalizeHuntWinCondition(value.winCondition);
    if (value.teamMode === true) summary.teamMode = true;
    if (value.teamObjective != null) summary.teamObjective = normalizeTeamObjectiveType(value.teamObjective);
    if (value.teamSize != null) summary.teamSize = bounded(value.teamSize, 1, 99);
    return summary;
}

/** @param {any} settings */
export function createLobbyMatchSummary(settings = {}) {
    const arcade = settings?.localSettings?.modePath === 'arcade';
    const deathmatch = settings?.gameMode === 'HUNT' && settings?.hunt?.respawnEnabled === true;
    const winCondition = deathmatch ? normalizeHuntWinCondition(settings?.hunt?.winCondition) : null;
    const teamSettings = normalizeTeamHuntSettings(settings?.hunt);
    const teamObjective = normalizeTeamObjectiveType(settings?.hunt?.teamObjective);
    const humanCount = Math.max(1, Number(settings?.session?.humanEntityCount)
        || Number(settings?.localSettings?.humanEntityCount)
        || settings?.session?.networkPlayerSlots?.length
        || 1);
    const teamRoster = teamSettings.enabled
        ? resolveTeamRoster({ humanCount, teamSize: teamSettings.teamSize })
        : null;
    const objectiveActive = settings?.gameMode === 'HUNT' && teamSettings.enabled;
    const objectiveTargetKind = objectiveActive && teamObjective === TEAM_OBJECTIVE_TYPES.FLAGS
        ? 'flags'
        : (objectiveActive && teamObjective === TEAM_OBJECTIVE_TYPES.ESCORT ? 'escort' : null);
    return normalizeLobbyMatchSummary({
        numBots: teamRoster?.botCount ?? settings?.numBots ?? 0,
        botDifficulty: settings?.botDifficulty || 'NORMAL',
        targetKind: arcade ? 'sectors' : (objectiveTargetKind || (deathmatch
            ? (winCondition === HUNT_WIN_CONDITIONS.LAST_ALIVE ? 'lives'
                : winCondition === HUNT_WIN_CONDITIONS.SCORE_TARGET ? 'points' : 'kills')
            : 'wins')),
        targetValue: arcade ? settings?.arcade?.sectorCount
            : (objectiveActive && teamObjective === TEAM_OBJECTIVE_TYPES.FLAGS ? FLAG_OBJECTIVE_DEFAULTS.flagsPerTeam * 2
                : (objectiveActive && teamObjective === TEAM_OBJECTIVE_TYPES.ESCORT ? ESCORT_DEFAULTS.roundSeconds
                    : (deathmatch ? (winCondition === HUNT_WIN_CONDITIONS.LAST_ALIVE ? 3
                        : settings?.hunt?.deathmatchKillLimit || 10) : settings?.winsNeeded || 5))),
        ...(deathmatch ? { winCondition } : {}),
        ...(teamSettings.enabled ? {
            teamMode: true,
            teamObjective,
            teamSize: teamSettings.teamSize,
        } : {}),
    });
}

// Missing revisions are legacy peers; only advertised revisions participate
// in the additive concurrency check.
export function isLobbySettingsRevisionCurrent(requested, current) {
    return requested == null || current == null
        || (Number.isSafeInteger(requested) && requested === current);
}

// Public, bounded lobby facts. Personal settings and complete match snapshots
// stay out of discovery/status messages.
import { HUNT_WIN_CONDITIONS, normalizeHuntWinCondition } from './HuntWinConditionContract.js';

export function normalizeLobbyMatchSummary(value) {
    if (!value || typeof value !== 'object') return null;
    const bounded = (candidate, min, max) => candidate != null && Number.isFinite(Number(candidate))
        ? Math.max(min, Math.min(max, Math.floor(Number(candidate)))) : null;
    const summary = {
        numBots: bounded(value.numBots, 0, 99),
        botDifficulty: ['EASY', 'NORMAL', 'HARD'].includes(value.botDifficulty) ? value.botDifficulty : null,
        targetKind: ['wins', 'kills', 'sectors', 'points', 'lives'].includes(value.targetKind) ? value.targetKind : null,
        targetValue: value.targetValue == null ? null : bounded(value.targetValue, 1, 9999),
    };
    if (value.winCondition != null) summary.winCondition = normalizeHuntWinCondition(value.winCondition);
    return summary;
}

/** @param {any} settings */
export function createLobbyMatchSummary(settings = {}) {
    const arcade = settings?.localSettings?.modePath === 'arcade';
    const deathmatch = settings?.gameMode === 'HUNT' && settings?.hunt?.respawnEnabled === true;
    const winCondition = deathmatch ? normalizeHuntWinCondition(settings?.hunt?.winCondition) : null;
    return normalizeLobbyMatchSummary({
        numBots: settings?.numBots ?? 0,
        botDifficulty: settings?.botDifficulty || 'NORMAL',
        targetKind: arcade ? 'sectors' : (deathmatch
            ? (winCondition === HUNT_WIN_CONDITIONS.LAST_ALIVE ? 'lives'
                : winCondition === HUNT_WIN_CONDITIONS.SCORE_TARGET ? 'points' : 'kills')
            : 'wins'),
        targetValue: arcade ? settings?.arcade?.sectorCount
            : (deathmatch ? (winCondition === HUNT_WIN_CONDITIONS.LAST_ALIVE ? 3
                : settings?.hunt?.deathmatchKillLimit || 10) : settings?.winsNeeded || 5),
        ...(deathmatch ? { winCondition } : {}),
    });
}

// Missing revisions are legacy peers; only advertised revisions participate
// in the additive concurrency check.
export function isLobbySettingsRevisionCurrent(requested, current) {
    return requested == null || current == null
        || (Number.isSafeInteger(requested) && requested === current);
}

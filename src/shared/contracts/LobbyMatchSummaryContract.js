// Public, bounded lobby facts. Personal settings and complete match snapshots
// stay out of discovery/status messages.
export function normalizeLobbyMatchSummary(value) {
    if (!value || typeof value !== 'object') return null;
    const bounded = (candidate, min, max) => candidate != null && Number.isFinite(Number(candidate))
        ? Math.max(min, Math.min(max, Math.floor(Number(candidate)))) : null;
    return {
        numBots: bounded(value.numBots, 0, 99),
        botDifficulty: ['EASY', 'NORMAL', 'HARD'].includes(value.botDifficulty) ? value.botDifficulty : null,
        targetKind: ['wins', 'kills', 'sectors'].includes(value.targetKind) ? value.targetKind : null,
        targetValue: value.targetValue == null ? null : bounded(value.targetValue, 1, 9999),
    };
}

/** @param {any} settings */
export function createLobbyMatchSummary(settings = {}) {
    const arcade = settings?.localSettings?.modePath === 'arcade';
    const deathmatch = settings?.gameMode === 'HUNT' && settings?.hunt?.respawnEnabled === true;
    return normalizeLobbyMatchSummary({
        numBots: settings?.numBots ?? 0,
        botDifficulty: settings?.botDifficulty || 'NORMAL',
        targetKind: arcade ? 'sectors' : (deathmatch ? 'kills' : 'wins'),
        targetValue: arcade ? settings?.arcade?.sectorCount
            : (deathmatch ? settings?.hunt?.deathmatchKillLimit || 10 : settings?.winsNeeded || 5),
    });
}

// Missing revisions are legacy peers; only advertised revisions participate
// in the additive concurrency check.
export function isLobbySettingsRevisionCurrent(requested, current) {
    return requested == null || current == null
        || (Number.isSafeInteger(requested) && requested === current);
}

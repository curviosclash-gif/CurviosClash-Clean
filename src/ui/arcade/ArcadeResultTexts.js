// German captions and lines for the arcade result panels (intermission and post-run).
//
// The panels themselves are DOM code inside MatchFlowArcadeOverlayController. Keeping the wording
// here means the texts can be checked without a browser, and every panel says "Punkte" instead of
// "Score" and "Beste Kombo" instead of "Best Combo".

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function toNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export const ARCADE_RESULT_TEXTS = Object.freeze({
    nextSectorHeading: 'Nächster Sektor',
    noExtraEffect: 'Keine zusätzliche Wirkung.',
    emptyChoices: 'Keine Optionen verfügbar.',
    emptyRewards: 'Keine Belohnungen verfügbar.',
    confirmSelection: 'Auswahl bestätigen',
    sectorScoreHeading: 'Punkte pro Sektor',
    emptySectors: 'Keine Sektordaten.',
    replayUnavailable: 'Kein Replay für diesen Run verfügbar.',
});

/**
 * @param {unknown} nextSectorIndex
 * @returns {string}
 */
export function formatIntermissionTitle(nextSectorIndex) {
    return `Zwischenstopp Sektor ${Math.max(1, Math.floor(toNumber(nextSectorIndex, 1)))}`;
}


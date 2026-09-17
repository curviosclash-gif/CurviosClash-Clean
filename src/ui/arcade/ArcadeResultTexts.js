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

/**
 * @param {{score?: unknown, bestCombo?: unknown, missionRate?: unknown}} summary
 * @returns {string}
 */
export function formatPostRunHeadline(summary = {}) {
    const score = Math.max(0, Math.round(toNumber(summary.score, 0)));
    const bestCombo = Math.max(0, Math.floor(toNumber(summary.bestCombo, 0)));
    return `Gesamtpunkte ${score} | Beste Kombo ${bestCombo} | Missions-Rate ${String(summary.missionRate ?? '')}`;
}

/**
 * @param {unknown} peakMultiplier
 * @returns {string}
 */
export function formatPeakMultiplier(peakMultiplier) {
    const value = Math.max(1, Math.round(toNumber(peakMultiplier, 1) * 10) / 10);
    return `Höchster Multiplikator ${value}x`;
}

/**
 * @param {{sectorIndex?: unknown, mapKey?: unknown, awardedPoints?: unknown}} entry
 * @returns {string}
 */
export function formatSectorScoreRow(entry = {}) {
    const sectorIndex = Math.max(0, Math.floor(toNumber(entry.sectorIndex, 0)));
    const mapKey = String(entry.mapKey || '-');
    const awarded = Math.max(0, Math.round(toNumber(entry.awardedPoints, 0)));
    return `S${sectorIndex} | ${mapKey} | ${awarded} Punkte`;
}

/**
 * @param {{attempt?: unknown, score?: unknown, bestScore?: unknown}} dailyResult
 * @returns {string}
 */
export function formatDailyAttemptLine(dailyResult = {}) {
    const attempt = Math.max(1, Math.floor(toNumber(dailyResult.attempt, 1)));
    const score = Math.round(toNumber(dailyResult.score, 0));
    const bestScore = Math.max(0, Math.round(toNumber(dailyResult.bestScore, 0)));
    return `Versuch ${attempt} | ${score} Punkte | Tagesbestwert ${bestScore}`;
}

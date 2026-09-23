export const ARCADE_SCORE_LABELS = Object.freeze({
    base: 'Grundpunkte', survival: 'Überleben', kills: 'Abschüsse', cleanSector: 'Ohne Eigencrash',
    risk: 'Risiko', penalty: 'Abzüge', completion: 'Abschluss', checkpoints: 'Checkpoints',
    time: 'Zeitbonus', precision: 'Präzision',
});

function finiteNonNegative(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

export function createArcadeScorePresentation(breakdown = null, awardedTotal = 0) {
    const source = breakdown && typeof breakdown === 'object' ? breakdown : {};
    const positiveKeys = Object.keys(ARCADE_SCORE_LABELS).filter((key) => key !== 'penalty');
    const rawSubtotal = Math.max(0, positiveKeys.reduce(
        (sum, key) => sum + finiteNonNegative(source[key]),
        0
    ) - finiteNonNegative(source.penalty));
    const scoredTotal = finiteNonNegative(awardedTotal);
    return {
        rawSubtotal,
        multiplierBonus: Math.max(0, scoredTotal - rawSubtotal),
        scoredTotal,
    };
}

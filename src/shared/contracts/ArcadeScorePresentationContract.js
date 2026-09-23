export const ARCADE_SCORE_LABELS = Object.freeze({
    base: 'Grundpunkte', survival: 'Überleben', kills: 'Abschüsse', cleanSector: 'Ohne Eigencrash',
    risk: 'Risiko', penalty: 'Abzüge', completion: 'Abschluss', checkpoints: 'Checkpoints',
    time: 'Zeitbonus', precision: 'Präzision',
});

function finiteNonNegative(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

export function createArcadeRawSubtotal(breakdown = null) {
    const source = breakdown && typeof breakdown === 'object' ? breakdown : {};
    const positiveKeys = Object.keys(ARCADE_SCORE_LABELS).filter((key) => key !== 'penalty');
    return Math.max(0, positiveKeys.reduce(
        (sum, key) => sum + finiteNonNegative(source[key]),
        0
    ) - finiteNonNegative(source.penalty));
}

export function createArcadeScorePresentation(breakdown = null, awardedTotal = 0) {
    const rawSubtotal = createArcadeRawSubtotal(breakdown);
    const scoredTotal = finiteNonNegative(awardedTotal);
    return {
        rawSubtotal,
        multiplierBonus: Math.max(0, scoredTotal - rawSubtotal),
        scoredTotal,
    };
}

export function createArcadeSectorScorePresentation({
    breakdown = null,
    awardedPoints = 0,
    scoreFactor = 1,
    missionBonus = 0,
} = {}) {
    const rawSubtotal = createArcadeRawSubtotal(breakdown);
    const scoredTotal = finiteNonNegative(awardedPoints);
    const safeMissionBonus = Math.min(scoredTotal, finiteNonNegative(missionBonus));
    const factoredPoints = Math.max(0, scoredTotal - safeMissionBonus);
    const factor = finiteNonNegative(scoreFactor) || (rawSubtotal > 0 ? factoredPoints / rawSubtotal : 1);
    return {
        rawSubtotal,
        factor,
        factoredPoints,
        multiplierBonus: Math.max(0, factoredPoints - rawSubtotal),
        missionBonus: safeMissionBonus,
        scoredTotal,
    };
}

export const ARCADE_SCORE_LABELS = Object.freeze({
    base: 'Grundpunkte', survival: 'Überleben', kills: 'Abschüsse', cleanSector: 'Ohne Eigencrash',
    risk: 'Risiko', penalty: 'Abzüge', completion: 'Abschluss', checkpoints: 'Checkpoints',
    time: 'Zeitbonus', precision: 'Präzision',
});
export function formatArcadeBreakdown(breakdown = {}) {
    return Object.entries(ARCADE_SCORE_LABELS).map(([key, label]) =>
        `${label}: ${key === 'penalty' ? '−' : '+'}${Math.round(Number(breakdown[key]) || 0)}`).join(' | ');
}

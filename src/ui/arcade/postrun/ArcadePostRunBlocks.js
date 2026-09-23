// Turns the arcade run summaries into the value blocks of the post-match stats contract (v2).
//
// The arcade panels used to glue every number into one line ("1250 Punkte | 420 XP | ..."). The new
// result board renders a block as a card with one labelled row per value, so the arcade side only
// has to produce the same block shape and can reuse PostMatchCards/PostMatchFormat for the rest.
//
// Pure functions, no DOM. Numbers stay raw and carry their type; the German formatting happens once
// in PostMatchFormat.

import {
    ARCADE_SCORE_LABELS,
    createArcadeScorePresentation,
    createArcadeSectorScorePresentation,
} from '../../../shared/contracts/ArcadeScorePresentationContract.js';
import { createPostMatchBlock } from '../../../shared/contracts/PostMatchStatsContract.js';
import { resolveMapPreview } from '../../menu/MenuPreviewCatalog.js';

const UNKNOWN_MAP_LABEL = 'Unbekannte Karte';
const SCORE_INTEGER_FORMATTER = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const SCORE_FACTOR_FORMATTER = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatScoreEquation(presentation, sectorSettlement) {
    const raw = SCORE_INTEGER_FORMATTER.format(Math.round(presentation.rawSubtotal));
    const total = SCORE_INTEGER_FORMATTER.format(Math.round(presentation.scoredTotal));
    if (!sectorSettlement) {
        const bonus = SCORE_INTEGER_FORMATTER.format(Math.round(presentation.multiplierBonus));
        return `${raw} + ${bonus} = ${total}`;
    }
    const factor = SCORE_FACTOR_FORMATTER.format(presentation.factor);
    const mission = SCORE_INTEGER_FORMATTER.format(Math.round(presentation.missionBonus));
    return `${raw} × ${factor} + ${mission} = ${total}`;
}

/**
 * Prefers a label the summary already carries, then the runtime map catalog, and keeps the raw key
 * as the last fallback so an unknown map is still recognisable.
 * @param {unknown} mapKey
 * @param {unknown} [mapLabel]
 * @returns {string}
 */
export function resolveArcadeMapLabel(mapKey, mapLabel) {
    const label = typeof mapLabel === 'string' ? mapLabel.trim() : '';
    if (label) return label;
    const key = typeof mapKey === 'string' ? mapKey.trim() : '';
    if (!key) return UNKNOWN_MAP_LABEL;
    return resolveMapPreview(key).name || key;
}

/**
 * @param {string} id
 * @param {string} title
 * @param {Array<object>} rows
 * @param {string} [tier]
 * @returns {import('../../../shared/contracts/PostMatchStatsContract.js').PostMatchStatsBlock|null}
 */
export function createArcadeBlock(id, title, rows, tier = 'primary') {
    return createPostMatchBlock({ id, title, kind: 'values', tier, rows });
}

/** @returns {{key: string, label: string, value: unknown, type: string, precision?: number}} */
export function countRow(key, label, value) {
    return { key, label, value, type: 'count' };
}

/** @returns {{key: string, label: string, value: unknown, type: string, precision?: number}} */
export function textRow(key, label, value) {
    return { key, label, value, type: 'text' };
}

/** @returns {{key: string, label: string, value: unknown, type: string, precision: number}} */
export function durationRow(key, label, seconds, precision = 1) {
    return { key, label, value: seconds, type: 'duration', precision };
}

/**
 * The score breakdown as its own card. Zero parts are left out — a run without checkpoints should
 * not list "Checkpoints 0".
 * @param {unknown} breakdown
 * @param {string} id
 * @returns {import('../../../shared/contracts/PostMatchStatsContract.js').PostMatchStatsBlock|null}
 */
export function createArcadeBreakdownBlock(breakdown, id = 'arcade-breakdown', awardedTotal = null, settlement = null) {
    if (!breakdown || typeof breakdown !== 'object') return null;
    const rows = Object.entries(ARCADE_SCORE_LABELS)
        .map(([key, label]) => key === 'penalty'
            ? { key, label, value: -Math.round(Number(breakdown[key]) || 0), type: 'ratio', precision: 0 }
            : countRow(key, label, Math.round(Number(breakdown[key]) || 0)))
        .filter((row) => row.value !== 0);
    if (awardedTotal !== null && Number.isFinite(Number(awardedTotal))) {
        if (settlement && typeof settlement === 'object') {
            const presentation = createArcadeSectorScorePresentation({
                breakdown,
                awardedPoints: awardedTotal,
                scoreFactor: settlement.scoreFactor,
                missionBonus: settlement.missionBonus,
            });
            rows.push(
                countRow('raw-subtotal', 'Zwischensumme', Math.round(presentation.rawSubtotal)),
                { key: 'score-factor', label: 'Gesamtfaktor', value: presentation.factor, type: 'ratio', precision: 2 },
                countRow('factored-points', 'Nach Gesamtfaktor', Math.round(presentation.factoredPoints))
            );
            if (presentation.missionBonus > 0) {
                rows.push(countRow('mission-bonus', 'Missionsbonus', Math.round(presentation.missionBonus)));
            }
            rows.push(
                textRow('calculation', 'Rechenweg', formatScoreEquation(presentation, true)),
                countRow('scored-total', 'Gewertete Sektorpunkte', Math.round(presentation.scoredTotal))
            );
        } else {
            const presentation = createArcadeScorePresentation(breakdown, awardedTotal);
            rows.push(
                countRow('raw-subtotal', 'Rohsumme aller Sektoren', Math.round(presentation.rawSubtotal)),
                countRow('multiplier-bonus', 'Zusätzliche Wertung aus Faktoren & Boni', Math.round(presentation.multiplierBonus)),
                textRow('calculation', 'Rechenweg', formatScoreEquation(presentation, false)),
                countRow('scored-total', 'Gesamtpunkte', Math.round(presentation.scoredTotal))
            );
        }
    }
    return createArcadeBlock(id, 'Punkteberechnung', rows);
}

/**
 * Headline values of a finished run: the four numbers a player looks for first.
 * @param {object} summary
 * @returns {Array<import('../../../shared/contracts/PostMatchStatsContract.js').PostMatchStatsBlock>}
 */
export function createArcadeRunBlocks(summary = {}) {
    const blocks = [
        createArcadeBlock('arcade-run', 'Ergebnis', [
            countRow('score', 'Gesamtpunkte', summary.score),
            countRow('best-combo', 'Beste Kombo', summary.bestCombo),
            { key: 'mission-rate', label: 'Missions-Rate', value: summary.missionCompletionRate, type: 'percent' },
            { key: 'peak-multiplier', label: 'Höchster Multiplikator', value: summary.peakMultiplier, type: 'ratio' },
        ]),
        createArcadeBreakdownBlock(summary.breakdown, 'arcade-breakdown', summary.score),
    ];
    const daily = summary.dailyResult && typeof summary.dailyResult === 'object' ? summary.dailyResult : null;
    if (daily) {
        blocks.push(createArcadeBlock('arcade-daily', daily.isNewBest === true ? 'Neuer Tagesbestwert' : 'Daily-Ergebnis', [
            countRow('attempt', 'Versuch', Math.max(1, Number(daily.attempt) || 1)),
            countRow('daily-score', 'Punkte', daily.score),
            countRow('daily-best', 'Tagesbestwert', daily.bestScore),
            countRow('bonus-score', 'Bonusfortsetzung', summary.bonusScore),
        ]));
    }
    return blocks.filter(Boolean);
}

/**
 * One row per sector, so a 12 sector run lists twelve entries instead of the first eight.
 * @param {unknown} scorePerSector
 * @returns {import('../../../shared/contracts/PostMatchStatsContract.js').PostMatchStatsBlock|null}
 */
export function createArcadeSectorBlock(scorePerSector) {
    const entries = Array.isArray(scorePerSector) ? scorePerSector : [];
    const rows = entries.map((entry, index) => {
        const sectorIndex = Math.max(0, Math.floor(Number(entry?.sectorIndex) || 0)) || index + 1;
        return countRow(
            `sector-${index}`,
            `Sektor ${sectorIndex} — ${resolveArcadeMapLabel(entry?.mapKey, entry?.mapLabel)}`,
            entry?.awardedPoints
        );
    });
    return createArcadeBlock('arcade-sectors', 'Punkte pro Sektor', rows);
}

/**
 * @param {object} victory
 * @returns {Array<import('../../../shared/contracts/PostMatchStatsContract.js').PostMatchStatsBlock>}
 */
export function createArcadeVictoryBlocks(victory = {}) {
    const sector = victory.lastSector && typeof victory.lastSector === 'object' ? victory.lastSector : null;
    return [
        createArcadeBlock('arcade-victory', 'Ergebnis', [
            countRow('score', 'Punkte', victory.score),
            countRow('xp', 'XP', victory.xpEarned),
        ]),
        sector ? createArcadeBlock('arcade-victory-sector', 'Letzter Sektor', [
            countRow('sector-score', 'Punkte', sector.awardedPoints),
        ]) : null,
        sector ? createArcadeBreakdownBlock(sector.breakdown, 'arcade-victory-breakdown', sector.awardedPoints, sector) : null,
    ].filter(Boolean);
}

/**
 * The intermission header: what the sector just played was worth, plus what comes next.
 * @param {object} intermission
 * @returns {Array<import('../../../shared/contracts/PostMatchStatsContract.js').PostMatchStatsBlock>}
 */
export function createArcadeIntermissionBlocks(intermission = {}) {
    const completed = Math.max(0, Math.floor(Number(intermission.missionsCompleted) || 0));
    const total = Math.max(0, Math.floor(Number(intermission.missionsTotal) || 0));
    return [
        createArcadeBlock('arcade-intermission', 'Letzter Sektor', [
            countRow('sector-score', 'Punkte', intermission.lastSectorPoints),
            countRow('sector-xp', 'XP', intermission.lastSectorXp),
            textRow('missions', 'Missionen', `${completed}/${total}`),
        ]),
        createArcadeBreakdownBlock(
            intermission.breakdown,
            'arcade-intermission-breakdown',
            intermission.lastSectorPoints,
            intermission
        ),
    ].filter(Boolean);
}

/**
 * @param {object} preview
 * @returns {import('../../../shared/contracts/PostMatchStatsContract.js').PostMatchStatsBlock|null}
 */
export function createArcadeNextSectorBlock(preview = {}) {
    return createArcadeBlock('arcade-next-sector', 'Nächster Sektor', [
        textRow('map', 'Karte', resolveArcadeMapLabel(preview.mapKey, preview.mapLabel)),
        textRow('modifier', 'Modifier', String(preview.modifierLabel || 'Kein Modifier')),
        textRow('effect', 'Wirkung', String(preview.modifierEffect || '').trim() || 'Keine zusätzliche Wirkung.'),
    ]);
}

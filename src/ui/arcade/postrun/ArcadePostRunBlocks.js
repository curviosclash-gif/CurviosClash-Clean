// Turns the arcade run summaries into the value blocks of the post-match stats contract (v2).
//
// The arcade panels used to glue every number into one line ("1250 Punkte | 420 XP | ..."). The new
// result board renders a block as a card with one labelled row per value, so the arcade side only
// has to produce the same block shape and can reuse PostMatchCards/PostMatchFormat for the rest.
//
// Pure functions, no DOM. Numbers stay raw and carry their type; the German formatting happens once
// in PostMatchFormat.

import { ARCADE_SCORE_LABELS } from '../../../shared/contracts/ArcadeScorePresentationContract.js';
import { createPostMatchBlock } from '../../../shared/contracts/PostMatchStatsContract.js';
import { resolveMapPreview } from '../../menu/MenuPreviewCatalog.js';

const UNKNOWN_MAP_LABEL = 'Unbekannte Karte';

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
export function createArcadeBreakdownBlock(breakdown, id = 'arcade-breakdown') {
    if (!breakdown || typeof breakdown !== 'object') return null;
    const rows = Object.entries(ARCADE_SCORE_LABELS)
        .map(([key, label]) => countRow(key, label, Math.round(Number(breakdown[key]) || 0)))
        .filter((row) => row.value !== 0);
    return createArcadeBlock(id, 'Punkte-Aufteilung', rows);
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
        createArcadeBreakdownBlock(summary.breakdown),
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
            { key: 'score-factor', label: 'Faktor', value: sector.scoreFactor ?? 1, type: 'ratio', precision: 2 },
            countRow('mission-bonus', 'Missionsbonus', sector.missionBonus),
        ]) : null,
        sector ? createArcadeBreakdownBlock(sector.breakdown, 'arcade-victory-breakdown') : null,
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
            { key: 'score-factor', label: 'Faktor', value: intermission.scoreFactor ?? 1, type: 'ratio', precision: 2 },
            countRow('mission-bonus', 'Missionsbonus', intermission.missionBonus),
        ]),
        createArcadeBreakdownBlock(intermission.breakdown, 'arcade-intermission-breakdown'),
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

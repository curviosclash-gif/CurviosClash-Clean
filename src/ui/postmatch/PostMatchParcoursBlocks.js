// The parcours cards of the post-match board: the fixed route and the endless chase.
//
// The endless chase used to dump eighteen rows on the screen, most of them "0". Now the four rows a
// run is judged by (points, distance, time, record) stay primary, the rest becomes a detail card,
// and every row that is exactly zero is dropped — a run without side routes says nothing about them.

import { dropZeroRows, normalizeArray, normalizeNumber, toCount } from './PostMatchLabels.js';

const MILLISECONDS_PER_SECOND = 1000;

/**
 * @param {object|null} lastRoundMetrics
 * @returns {object|null}
 */
export function buildParcoursBlock(lastRoundMetrics) {
    const metrics = /** @type {Record<string, unknown>|null} */ (lastRoundMetrics);
    if (!metrics || metrics.parcoursCompleted !== true) return null;
    return {
        id: 'parcours',
        title: 'Parcours',
        kind: 'values',
        tier: 'primary',
        rows: [
            { key: 'route', label: 'Route', value: String(metrics.parcoursRouteId || '-'), type: 'text' },
            {
                key: 'completion-time',
                label: 'Zeit',
                value: Math.max(0, normalizeNumber(metrics.parcoursCompletionTimeMs, 0)) / MILLISECONDS_PER_SECOND,
                type: 'duration',
            },
            { key: 'checkpoints', label: 'Checkpoints', value: toCount(metrics.parcoursCheckpointCount), type: 'count' },
        ],
    };
}

/**
 * @param {Record<string, unknown>} summary
 * @returns {Array<{key: string, label: string, value: number, type: string}>}
 */
function buildEndlessPrimaryRows(summary) {
    return dropZeroRows([
        { key: 'score', label: 'Punkte', value: toCount(summary.score), type: 'count' },
        { key: 'distance', label: 'Distanz', value: toCount(summary.distanceMeters), type: 'distance' },
        { key: 'survival', label: 'Zeit', value: Math.max(0, normalizeNumber(summary.survivalSeconds, 0)), type: 'duration' },
        { key: 'record', label: 'Rekord', value: toCount(summary.recordScore), type: 'count' },
    ]);
}

/**
 * @param {Record<string, unknown>} summary
 * @returns {Array<{key: string, label: string, value: number, type: string}>}
 */
function buildEndlessDetailRows(summary) {
    return dropZeroRows([
        { key: 'kills', label: 'Bot-Abschüsse', value: toCount(summary.botKills), type: 'count' },
        { key: 'elite-kills', label: 'Anführer', value: toCount(summary.eliteKills), type: 'count' },
        { key: 'gates', label: 'Tore', value: toCount(summary.checkpointsPassed), type: 'count' },
        { key: 'best-streak', label: 'Beste Serie', value: toCount(summary.bestStreak), type: 'count' },
        { key: 'shakeoffs', label: 'Abgeschüttelt', value: toCount(summary.shakeoffs), type: 'count' },
        { key: 'revives', label: 'Rettungen', value: toCount(summary.revives), type: 'count' },
        { key: 'bonus', label: 'Bonus', value: toCount(summary.bonusScore), type: 'count' },
        { key: 'modules', label: 'Module', value: toCount(summary.completedModules), type: 'count' },
        { key: 'wave', label: 'Welle überstanden', value: toCount(summary.lastCompletedWave), type: 'count' },
        { key: 'side-routes', label: 'Nebenwege', value: toCount(summary.sideRoutesCompleted), type: 'count' },
        { key: 'flight-objectives', label: 'Flugziele', value: toCount(summary.flightObjectivesCompleted), type: 'count' },
        { key: 'xp', label: 'XP', value: toCount(summary.xp), type: 'count' },
        { key: 'unlocks', label: 'Freischaltungen', value: normalizeArray(summary.unlocks).length, type: 'count' },
        { key: 'milestones', label: 'Neue Meilensteine', value: normalizeArray(summary.newMilestones).length, type: 'count' },
    ]);
}

/**
 * Whether the run reached the record store. It is a text row, so the zero rule does not apply: a run
 * that is still being written has to say so even when every counter is zero.
 * @param {Record<string, unknown>} summary
 * @returns {{key: string, label: string, value: string, type: string}}
 */
function buildEndlessPersistenceRow(summary) {
    const persistence = /** @type {{pending?: unknown}|null} */ (summary.persistence || null);
    return {
        key: 'persistence',
        label: 'Speicherung',
        value: persistence?.pending === true ? 'ausstehend' : 'gespeichert',
        type: 'text',
    };
}

/**
 * Returns the primary card first and the detail card second, so the caller can place the detail one
 * behind the other detail cards without knowing what is inside.
 * @param {{parcours?: {endlessSummary?: unknown}|null}|null} outcome
 * @returns {object[]}
 */
export function buildEndlessParcoursBlocks(outcome) {
    const summary = /** @type {Record<string, unknown>|null} */ (outcome?.parcours?.endlessSummary || null);
    if (!summary || typeof summary !== 'object') return [];
    const title = summary.isNewRecord === true ? 'Endlosjagd – Neuer Rekord' : 'Endlosjagd';
    const blocks = [];
    const primaryRows = buildEndlessPrimaryRows(summary);
    if (primaryRows.length > 0) {
        blocks.push({ id: 'endless-parcours', title, kind: 'values', tier: 'primary', rows: primaryRows });
    }
    const detailRows = [...buildEndlessDetailRows(summary), buildEndlessPersistenceRow(summary)];
    if (detailRows.length > 0) {
        blocks.push({
            id: 'endless-parcours-detail',
            title: 'Endlosjagd – Details',
            kind: 'values',
            tier: 'detail',
            rows: detailRows,
        });
    }
    return blocks;
}

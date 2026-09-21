// The folded-away part of the post-match board shows player-readable results.
// Tuning metrics remain in the recorder and expert telemetry, not in these cards.

import { normalizeNumber } from './PostMatchLabels.js';

function countPickups(counts) {
    return Object.values(counts && typeof counts === 'object' ? counts : {})
        .reduce((sum, value) => sum + Math.max(0, normalizeNumber(value, 0)), 0);
}

/**
 * @param {object|null} lastRoundMetrics
 * @returns {object|null}
 */
export function buildRoundDetailBlock(lastRoundMetrics) {
    if (!lastRoundMetrics) return null;
    const metrics = /** @type {Record<string, unknown>} */ (lastRoundMetrics);
    return {
        id: 'round-detail',
        title: 'Runden-Details',
        kind: 'values',
        tier: 'detail',
        rows: [
            {
                key: 'duration',
                label: 'Dauer',
                value: normalizeNumber(metrics.duration, 0),
                type: 'duration',
            },
            { key: 'item-pickups', label: 'Gegenstände gesammelt', value: countPickups(metrics.itemPickupTypeCounts), type: 'count' },
            {
                key: 'self-collisions',
                label: 'Selbstcrashs',
                value: normalizeNumber(metrics.selfCollisions, 0),
                type: 'count',
            },
        ],
    };
}

/**
 * The whole match so far, using totals rather than tuning rates.
 * @param {object|null} aggregateMetrics
 * @param {{state?: unknown}|null} outcome
 * @param {unknown} huntScoreboard
 * @returns {object|null}
 */
export function buildMatchDetailBlock(aggregateMetrics, outcome, huntScoreboard = null) {
    if (!aggregateMetrics) return null;
    const metrics = /** @type {Record<string, unknown>} */ (aggregateMetrics);
    return {
        id: 'match',
        title: outcome?.state === 'MATCH_END' ? 'Match gesamt' : 'Match bisher',
        kind: 'values',
        tier: 'detail',
        rows: [
            { key: 'rounds', label: 'Runden', value: normalizeNumber(metrics.rounds, 0), type: 'count' },
            { key: 'duration', label: 'Dauer', value: normalizeNumber(metrics.totalDuration, 0), type: 'duration' },
            { key: 'item-pickups', label: 'Gegenstände gesammelt', value: countPickups(metrics.itemPickupTypeTotals), type: 'count' },
            { key: 'self-collisions', label: 'Selbstcrashs', value: normalizeNumber(metrics.totalSelfCollisions, 0), type: 'count' },
            ...(Array.isArray(huntScoreboard) ? [{
                key: 'kills', label: 'Abschüsse',
                value: huntScoreboard.reduce((sum, row) => sum + Math.max(0, normalizeNumber(row?.kills, 0)), 0),
                type: 'count',
            }] : []),
        ],
    };
}

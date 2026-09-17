// "Diese Runde": the primary card about the round that just ended.
//
// It answers what a player asks first — who won, why, how long it took and how many items were
// spent. Everything that only a developer reads lives in PostMatchDetailBlocks.js instead.

import {
    countUsedItems,
    normalizeNumber,
    resolveObjectiveLabel,
    resolveWinnerLabel,
} from './PostMatchLabels.js';

/**
 * @param {object|null} lastRoundMetrics
 * @param {unknown} players
 * @param {{state?: unknown, reason?: unknown}|null} outcome
 * @returns {object|null}
 */
export function buildRoundBlock(lastRoundMetrics, players, outcome) {
    if (!lastRoundMetrics) return null;
    const metrics = /** @type {Record<string, unknown>} */ (lastRoundMetrics);
    return {
        id: 'round',
        title: outcome?.state === 'MATCH_END' ? 'Finalrunde' : 'Diese Runde',
        kind: 'values',
        tier: 'primary',
        rows: [
            { key: 'winner', label: 'Sieger', value: resolveWinnerLabel(metrics, players), type: 'text' },
            {
                key: 'objective',
                label: 'Grund',
                value: resolveObjectiveLabel(metrics.reason || outcome?.reason),
                type: 'text',
            },
            { key: 'duration', label: 'Dauer', value: normalizeNumber(metrics.duration, 0), type: 'duration' },
            {
                key: 'item-uses',
                label: 'Gegenstände',
                value: countUsedItems(
                    /** @type {Record<string, unknown>} */ (metrics.itemUseModeCounts),
                    /** @type {Record<string, unknown>} */ (metrics.failedItemActionModeCounts)
                ),
                type: 'count',
            },
        ],
    };
}

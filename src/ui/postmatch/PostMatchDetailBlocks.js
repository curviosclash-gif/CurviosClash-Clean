// The folded-away part of the post-match board.
//
// Bot survival, self crashes, hangers per minute, wall bounces and the bot win rate are tuning
// figures, not results. They keep their rows and their keys, but carry tier 'detail' so the board
// can put them behind a closed section instead of in front of the score.

import { countUsedItems, normalizeNumber } from './PostMatchLabels.js';

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
                key: 'bot-survival',
                label: 'Bot-Überleben',
                value: normalizeNumber(metrics.botSurvivalAverage, 0),
                type: 'duration',
            },
            {
                key: 'self-collisions',
                label: 'Selbstcrashs',
                value: normalizeNumber(metrics.selfCollisions, 0),
                type: 'count',
            },
            {
                key: 'stuck-rate',
                label: 'Hänger/min',
                value: normalizeNumber(metrics.stuckPerMinute, 0),
                type: 'ratio',
            },
        ],
    };
}

/**
 * The whole match so far. Every figure in here is a tuning metric, so the card is a detail card.
 * @param {object|null} aggregateMetrics
 * @param {{state?: unknown}|null} outcome
 * @returns {object|null}
 */
export function buildMatchDetailBlock(aggregateMetrics, outcome) {
    if (!aggregateMetrics) return null;
    const metrics = /** @type {Record<string, unknown>} */ (aggregateMetrics);
    return {
        id: 'match',
        title: outcome?.state === 'MATCH_END' ? 'Match gesamt' : 'Match bisher',
        kind: 'values',
        tier: 'detail',
        rows: [
            { key: 'rounds', label: 'Runden', value: normalizeNumber(metrics.rounds, 0), type: 'count' },
            // A fraction, not a percentage number: the renderer multiplies by 100.
            {
                key: 'bot-win-rate',
                label: 'Bot-Siegrate',
                value: normalizeNumber(metrics.botWinRate, 0),
                type: 'percent',
            },
            {
                key: 'bot-survival-average',
                label: 'Bot-Überleben',
                value: normalizeNumber(metrics.averageBotSurvival, 0),
                type: 'duration',
            },
            {
                key: 'self-collisions-per-round',
                label: 'Selbstcrashs/R',
                value: normalizeNumber(metrics.selfCollisionsPerRound, 0),
                type: 'ratio',
            },
            {
                key: 'item-use-per-round',
                label: 'Gegenstände/R',
                value: countUsedItems(
                    /** @type {Record<string, unknown>} */ (metrics.itemUseModePerRound),
                    /** @type {Record<string, unknown>} */ (metrics.failedItemActionModePerRound)
                ),
                type: 'ratio',
            },
            {
                key: 'bounce-wall-per-round',
                label: 'Wandabpraller/R',
                value: normalizeNumber(metrics.bounceWallPerRound, 0),
                type: 'ratio',
            },
        ],
    };
}

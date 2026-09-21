// Shared German captions and small readers for the post-match board.
//
// The board is assembled from several block builders (standings, round, parcours, details). They all
// need the same three things: a safe number, the name of a player and the reason a round ended.
// Keeping them here means one wording per concept instead of four copies drifting apart.

import { PLAYER_LABEL_STYLES, formatPlayerDisplayLabel } from '../../shared/contracts/PlayerDisplayLabelContract.js';

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
export function normalizeArray(value) {
    return Array.isArray(value) ? value : [];
}

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function normalizeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function toCount(value) {
    return Math.max(0, Math.floor(normalizeNumber(value, 0)));
}

/**
 * @param {{ isBot?: boolean, index?: unknown, name?: unknown }|null|undefined} player
 * @returns {string}
 */
export function formatPlayerName(player) {
    if (!player) return 'Unbekannt';
    return formatPlayerDisplayLabel({ ...player, index: normalizeNumber(player.index, 0) }, { style: PLAYER_LABEL_STYLES.LONG });
}

/**
 * @param {{ winnerIndex?: unknown, winnerIsBot?: unknown }|null|undefined} lastRoundMetrics
 * @param {unknown} players
 * @returns {string}
 */
export function resolveWinnerLabel(lastRoundMetrics, players) {
    if (!lastRoundMetrics) return 'Unbekannt';
    const winnerIndex = Number(lastRoundMetrics.winnerIndex);
    if (!Number.isFinite(winnerIndex) || winnerIndex < 0) return 'Unentschieden';
    const winner = normalizeArray(players)
        .find((player) => Number(/** @type {{index?: unknown}} */ (player)?.index) === winnerIndex) || null;
    if (winner) return formatPlayerName(/** @type {{isBot?: boolean, index?: unknown}} */ (winner));
    return lastRoundMetrics.winnerIsBot ? `Bot ${winnerIndex + 1}` : `Spieler ${winnerIndex + 1}`;
}

/**
 * The index of the player who won the last round, or -1 when the round ended without one.
 * @param {{ winnerIndex?: unknown }|null|undefined} lastRoundMetrics
 * @returns {number}
 */
export function resolveWinnerIndex(lastRoundMetrics) {
    const winnerIndex = Number(lastRoundMetrics?.winnerIndex);
    return Number.isFinite(winnerIndex) && winnerIndex >= 0 ? Math.trunc(winnerIndex) : -1;
}

const OBJECTIVE_LABELS = Object.freeze({
    PARCOURS_COMPLETE: 'Parcours abgeschlossen',
    ELIMINATION: 'Elimination',
    KILL_LIMIT: 'Abschusslimit erreicht',
    TIME_LIMIT: 'Zeitlimit erreicht',
    OVERTIME: 'Golden Kill',
    SCORE_TARGET: 'Punktziel erreicht',
    LAST_ALIVE: 'Letzter Überlebender',
    FLAG_DOMINATION: 'Alle Flaggen kontrolliert',
    FLAG_TIME_LIMIT: 'Flaggenmehrheit nach Zeitlimit',
    FLAG_OVERTIME: 'Golden Flag',
    ESCORT_GOAL: 'Panzer hat das Ziel erreicht',
    ESCORT_TANK_DESTROYED: 'Panzer endgültig zerstört',
    ESCORT_TIME_LIMIT: 'Escort-Zeit abgelaufen',
});

/**
 * @param {unknown} reason
 * @returns {string}
 */
export function resolveObjectiveLabel(reason) {
    const normalized = String(reason || '').trim();
    return OBJECTIVE_LABELS[normalized] || normalized || '-';
}

/**
 * Every held machine gun frame and every refused attempt is logged as an item action too;
 * players only count the items they actually used or fired.
 * @param {Record<string, unknown>|null|undefined} modeCounts
 * @param {Record<string, unknown>|null|undefined} failedModeCounts
 * @returns {number}
 */
export function countUsedItems(modeCounts, failedModeCounts) {
    const count = (source, mode) => Math.max(0, normalizeNumber(source?.[mode], 0));
    return Math.max(0, count(modeCounts, 'use') + count(modeCounts, 'shoot')
        - count(failedModeCounts, 'use') - count(failedModeCounts, 'shoot'));
}

/**
 * Drops every row whose value rounds to zero. Used by the endless chase, where a run that never
 * touched a side route should not show "Nebenwege 0".
 * @template {{value?: unknown}} TRow
 * @param {TRow[]} rows
 * @returns {TRow[]}
 */
export function dropZeroRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter((row) => normalizeNumber(row?.value, 0) !== 0);
}

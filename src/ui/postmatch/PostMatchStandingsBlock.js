// The standings card of the post-match board: who stands where, in colour, with every participant.
//
// The old board showed "Top 4 + Weitere", which hid exactly the bots a six-player match is about.
// This block lists every active slot instead and hands the renderer raw facts (wins, colour, is it
// me, did I just win the round, is one win missing to the match) rather than a finished "2/3" text.
//
// In HUNT the order comes from the live scoreboard (kills first), everywhere else from round wins.

import { formatPlayerName, normalizeArray, normalizeNumber } from './PostMatchLabels.js';

/**
 * Which player slots belong to this machine. Without a network session every local human counts,
 * so a split screen marks both halves as "mine"; a hybrid network host can also own two slots.
 * @param {{ networkEnabled?: unknown, localPlayerIndex?: unknown, localHumanCount?: unknown, numHumans?: unknown }|null|undefined} session
 * @returns {number[]}
 */
export function resolveLocalPlayerIndexes(session) {
    if (session?.networkEnabled === true) {
        const index = Number(session.localPlayerIndex);
        const start = Number.isInteger(index) && index >= 0 ? index : 0;
        const count = Math.max(1, Math.trunc(normalizeNumber(session?.localHumanCount, 1)));
        return Array.from({ length: count }, (_, offset) => start + offset);
    }
    const localHumanCount = Math.max(1, normalizeNumber(session?.numHumans, 1));
    return Array.from({ length: Math.trunc(localHumanCount) }, (_, index) => index);
}

/**
 * @param {unknown} huntScoreboard
 * @returns {Map<number, {kills: number, deaths: number, assists: number, rank: number}>}
 */
function indexHuntScoreboard(huntScoreboard) {
    /** @type {Map<number, {kills: number, deaths: number, assists: number, rank: number}>} */
    const byPlayer = new Map();
    normalizeArray(huntScoreboard).forEach((row, rank) => {
        const playerIndex = Number(/** @type {{playerIndex?: unknown}} */ (row)?.playerIndex);
        if (!Number.isInteger(playerIndex) || playerIndex < 0) return;
        const entry = /** @type {{kills?: unknown, deaths?: unknown, assists?: unknown}} */ (row);
        byPlayer.set(playerIndex, {
            kills: Math.max(0, normalizeNumber(entry.kills, 0)),
            deaths: Math.max(0, normalizeNumber(entry.deaths, 0)),
            assists: Math.max(0, normalizeNumber(entry.assists, 0)),
            rank,
        });
    });
    return byPlayer;
}

/**
 * @param {{entries: Array<{playerIndex: number, roundWins: number, isBot: boolean}>, huntRanks: Map<number, {rank: number}>}} context
 * @returns {(left: {playerIndex: number, roundWins: number, isBot: boolean}, right: {playerIndex: number, roundWins: number, isBot: boolean}) => number}
 */
function createStandingsComparator(context) {
    const { huntRanks } = context;
    const fallbackRank = Number.MAX_SAFE_INTEGER;
    return (left, right) => {
        if (huntRanks.size > 0) {
            const rankDelta = (huntRanks.get(left.playerIndex)?.rank ?? fallbackRank)
                - (huntRanks.get(right.playerIndex)?.rank ?? fallbackRank);
            if (rankDelta !== 0) return rankDelta;
        }
        const winsDelta = right.roundWins - left.roundWins;
        if (winsDelta !== 0) return winsDelta;
        const botDelta = Number(left.isBot) - Number(right.isBot);
        if (botDelta !== 0) return botDelta;
        return left.playerIndex - right.playerIndex;
    };
}

/**
 * @param {object} inputs
 * @param {unknown} inputs.players
 * @param {{requiredWins?: unknown, state?: unknown}|null} [inputs.outcome]
 * @param {unknown} [inputs.huntScoreboard]
 * @param {unknown} [inputs.localPlayerIndexes]
 * @param {number} [inputs.roundWinnerIndex]
 * @returns {{id: string, title: string, kind: 'standings', tier: 'primary', entries: object[]}|null}
 */
export function buildStandingsBlock({
    players,
    outcome = null,
    huntScoreboard = null,
    localPlayerIndexes = null,
    roundWinnerIndex = -1,
} = {}) {
    const requiredWins = Math.max(1, normalizeNumber(outcome?.requiredWins, 1));
    const huntRanks = indexHuntScoreboard(huntScoreboard);
    const localIndexes = new Set(normalizeArray(localPlayerIndexes).map((value) => Number(value)));
    const entries = normalizeArray(players)
        .filter((player) => !!player && /** @type {{entitySlotActive?: unknown}} */ (player).entitySlotActive !== false)
        .map((player) => {
            const source = /** @type {{index?: unknown, isBot?: unknown, score?: unknown, color?: unknown}} */ (player);
            const playerIndex = Math.max(0, Math.trunc(normalizeNumber(source.index, 0)));
            const roundWins = Math.max(0, normalizeNumber(source.score, 0));
            const hunt = huntRanks.get(playerIndex) || null;
            return {
                playerIndex,
                label: formatPlayerName(/** @type {{isBot?: boolean, index?: unknown}} */ (player)),
                isBot: source.isBot === true,
                isLocal: source.isBot !== true && localIndexes.has(playerIndex),
                color: source.color,
                roundWins,
                requiredWins,
                isRoundWinner: playerIndex === roundWinnerIndex,
                isMatchPoint: outcome?.state === 'ROUND_END' && requiredWins - roundWins === 1,
                kills: hunt ? hunt.kills : null,
                deaths: hunt ? hunt.deaths : null,
                assists: hunt ? hunt.assists : null,
            };
        });
    if (entries.length === 0) return null;
    entries.sort(createStandingsComparator({ entries, huntRanks }));
    return {
        id: 'scoreboard',
        title: outcome?.state === 'MATCH_END' ? 'Endstand' : 'Zwischenstand',
        kind: 'standings',
        tier: 'primary',
        entries,
    };
}

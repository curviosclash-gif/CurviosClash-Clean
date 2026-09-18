// Standings rendering for the post-match board (contract: post-match-stats.v2, `kind: 'standings'`).
//
// The standings used to be plain "2/3 · 7/1/2" rows. As a real table the board can be read column by
// column: rank, colour dot plus name, round progress, and in HUNT kills/deaths/assists.
//
// Two rules keep the board usable without colour vision and without a mouse:
// - every state is also written out ("(du)", a star with an aria-label, "Matchball"); the colour dot
//   is decoration and therefore aria-hidden.
// - the progress cell carries "2 von 3" as its accessible name while the pips stay visual.
//
// The plain fraction survives as `data-stats-value="progress"` with the class `message-stats-value`,
// because the desktop tests read exactly that element inside `[data-stats-row-key="player-N"]`.

import { POST_MATCH_VALUE_PLACEHOLDER } from './PostMatchFormat.js';
import { createBlockSection, createStatsElement } from './PostMatchCards.js';

const FILLED_PIP = '●';
const EMPTY_PIP = '○';
// Above this many required wins a row of pips stops being countable at a glance.
const MAX_PIPS = 10;

const HUNT_COLUMNS = Object.freeze([
    Object.freeze({ key: 'kills', short: 'A', label: 'Abschüsse' }),
    Object.freeze({ key: 'deaths', short: 'T', label: 'Tode' }),
    Object.freeze({ key: 'assists', short: 'As', label: 'Assists' }),
]);

/**
 * @param {string} text
 * @param {string} [longLabel]
 * @returns {HTMLElement}
 */
function createHeaderCell(text, longLabel = '') {
    const cell = createStatsElement('th', 'message-stats-head', text);
    cell.setAttribute('scope', 'col');
    if (longLabel && longLabel !== text) {
        cell.setAttribute('abbr', longLabel);
        cell.setAttribute('title', longLabel);
    }
    return cell;
}

/**
 * HUNT counts kills, classic does not. One entry with a counter is enough to show the columns.
 * @param {import('../../shared/contracts/PostMatchStatsContract.js').PostMatchStandingsEntry[]} entries
 * @returns {boolean}
 */
function hasKillColumns(entries) {
    return entries.some((entry) => entry.kills !== null || entry.deaths !== null || entry.assists !== null);
}

/**
 * @param {boolean} showKills
 * @returns {HTMLElement}
 */
function createTableHead(showKills) {
    const head = createStatsElement('thead', '');
    const row = createStatsElement('tr', 'message-stats-head-row');
    row.appendChild(createHeaderCell('#', 'Platz'));
    row.appendChild(createHeaderCell('Spieler'));
    row.appendChild(createHeaderCell('Runden'));
    if (showKills) {
        for (const column of HUNT_COLUMNS) row.appendChild(createHeaderCell(column.short, column.label));
    }
    head.appendChild(row);
    return head;
}

/**
 * @param {import('../../shared/contracts/PostMatchStatsContract.js').PostMatchStandingsEntry} entry
 * @returns {HTMLElement}
 */
function createColorDot(entry) {
    const dot = createStatsElement('span', `message-stats-dot${entry.color ? '' : ' no-color'}`);
    dot.setAttribute('aria-hidden', 'true');
    if (entry.color) dot.style.backgroundColor = entry.color;
    return dot;
}

/**
 * @param {import('../../shared/contracts/PostMatchStatsContract.js').PostMatchStandingsEntry} entry
 * @returns {HTMLElement}
 */
function createPlayerCell(entry) {
    const cell = createStatsElement('td', 'message-stats-player');
    cell.appendChild(createColorDot(entry));
    cell.appendChild(createStatsElement(
        'span',
        'message-stats-name',
        entry.label || `Spieler ${entry.playerIndex + 1}`
    ));
    if (entry.isRoundWinner) {
        const winner = createStatsElement('span', 'message-stats-winner', '★');
        winner.setAttribute('aria-label', 'Rundensieger');
        winner.setAttribute('title', 'Rundensieger');
        cell.appendChild(winner);
    }
    if (entry.isLocal) {
        cell.appendChild(createStatsElement('span', 'message-stats-tag is-local', '(du)'));
    }
    if (entry.isMatchPoint) {
        cell.appendChild(createStatsElement('span', 'message-stats-tag is-match-point', 'Matchball'));
    }
    return cell;
}

/**
 * @param {number} wins
 * @param {number} required
 * @returns {string}
 */
function buildPips(wins, required) {
    const filled = Math.max(0, Math.min(wins, required));
    return FILLED_PIP.repeat(filled) + EMPTY_PIP.repeat(required - filled);
}

/**
 * @param {import('../../shared/contracts/PostMatchStatsContract.js').PostMatchStandingsEntry} entry
 * @returns {HTMLElement}
 */
function createProgressCell(entry) {
    const cell = createStatsElement('td', 'message-stats-progress');
    cell.setAttribute('aria-label', `${entry.roundWins} von ${entry.requiredWins}`);
    if (entry.requiredWins <= MAX_PIPS) {
        const pips = createStatsElement('span', 'message-stats-pips', buildPips(entry.roundWins, entry.requiredWins));
        pips.setAttribute('aria-hidden', 'true');
        cell.appendChild(pips);
    }
    const value = createStatsElement('span', 'message-stats-value', `${entry.roundWins}/${entry.requiredWins}`);
    value.setAttribute('data-stats-value', 'progress');
    cell.appendChild(value);
    return cell;
}

/**
 * @param {import('../../shared/contracts/PostMatchStatsContract.js').PostMatchStandingsEntry} entry
 * @param {{ key: string, short: string, label: string }} column
 * @returns {HTMLElement}
 */
function createKillCell(entry, column) {
    const raw = entry[column.key];
    const cell = createStatsElement(
        'td',
        'message-stats-kda',
        raw === null ? POST_MATCH_VALUE_PLACEHOLDER : String(raw)
    );
    cell.setAttribute('data-stats-value', column.key);
    return cell;
}

/**
 * @param {import('../../shared/contracts/PostMatchStatsContract.js').PostMatchStandingsEntry} entry
 * @returns {string}
 */
function buildRowClassName(entry) {
    let className = 'message-stats-standings-row';
    if (entry.isLocal) className += ' is-local';
    if (entry.isBot) className += ' is-bot';
    if (entry.isRoundWinner) className += ' is-round-winner';
    if (entry.isMatchPoint) className += ' is-match-point';
    return className;
}

/**
 * @param {import('../../shared/contracts/PostMatchStatsContract.js').PostMatchStandingsEntry} entry
 * @param {number} rank
 * @param {boolean} showKills
 * @returns {HTMLElement}
 */
function createStandingsRow(entry, rank, showKills) {
    const row = createStatsElement('tr', buildRowClassName(entry));
    row.setAttribute('data-stats-row-key', `player-${entry.playerIndex}`);
    row.appendChild(createStatsElement('td', 'message-stats-rank', String(rank)));
    row.appendChild(createPlayerCell(entry));
    row.appendChild(createProgressCell(entry));
    if (showKills) {
        for (const column of HUNT_COLUMNS) row.appendChild(createKillCell(entry, column));
    }
    return row;
}

/**
 * Renders a `standings` block as a table. Returns null without entries, so an empty standings block
 * leaves no headline behind.
 * @param {import('../../shared/contracts/PostMatchStatsContract.js').PostMatchStatsBlock} block
 * @returns {HTMLElement|null}
 */
export function createPostMatchStandingsTable(block) {
    if (!block || block.entries.length === 0) return null;
    const section = createBlockSection(block, 'message-stats-standings');
    const table = createStatsElement('table', 'message-stats-table');
    table.appendChild(createStatsElement('caption', 'message-stats-title', block.title || 'Stand'));

    const showKills = hasKillColumns(block.entries);
    table.appendChild(createTableHead(showKills));

    const body = createStatsElement('tbody', '');
    block.entries.forEach((entry, index) => {
        body.appendChild(createStandingsRow(entry, index + 1, showKills));
    });
    table.appendChild(body);

    section.appendChild(table);
    return section;
}

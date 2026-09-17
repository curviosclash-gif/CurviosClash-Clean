// Renders the post-match board (contract: post-match-stats.v2).
//
// The producer hands over raw numbers plus a type, so every visible string is written here through
// PostMatchFormat. Standings entries are still shown as plain rows (name, wins, in HUNT also
// kills/deaths/assists) — the real table and the folded detail section are P4's job. What must not
// change are `data-stats-block-id` and `data-stats-row-key`: the desktop tests hang on them.

import { normalizePostMatchStats } from '../../shared/contracts/PostMatchStatsContract.js';
import { formatPostMatchValue } from '../postmatch/PostMatchFormat.js';

export function clearMessageStats(container) {
    if (!container) return;
    container.replaceChildren();
    container.classList.add('hidden');
}

function appendStatsRow(list, key, label, value) {
    const rowElement = document.createElement('div');
    rowElement.className = 'message-stats-row';
    rowElement.setAttribute('data-stats-row-key', key);

    const labelElement = document.createElement('dt');
    labelElement.className = 'message-stats-label';
    labelElement.textContent = label;

    const valueElement = document.createElement('dd');
    valueElement.className = 'message-stats-value';
    valueElement.textContent = value;

    rowElement.appendChild(labelElement);
    rowElement.appendChild(valueElement);
    list.appendChild(rowElement);
}

// "2/3" everywhere, plus "7/1/2" (kills/deaths/assists) as soon as the mode counts them.
function formatStandingsValue(entry) {
    const progress = `${entry.roundWins}/${entry.requiredWins}`;
    if (entry.kills === null) return progress;
    return `${progress} · ${entry.kills}/${entry.deaths}/${entry.assists}`;
}

function renderStandingsEntries(list, entries) {
    for (const entry of entries) {
        appendStatsRow(list, `player-${entry.playerIndex}`, entry.label, formatStandingsValue(entry));
    }
}

function renderValueRows(list, rows) {
    for (const row of rows) {
        appendStatsRow(list, row.key, row.label, formatPostMatchValue(row));
    }
}

export function renderMessageStats(container, overlayStats) {
    if (!container) return;

    const stats = normalizePostMatchStats(overlayStats);
    if (!stats.visible) {
        clearMessageStats(container);
        return;
    }

    container.replaceChildren();
    for (const block of stats.blocks) {
        const blockElement = document.createElement('section');
        blockElement.className = 'message-stats-card';
        blockElement.setAttribute('data-stats-block-id', block.id);
        blockElement.setAttribute('data-stats-block-tier', block.tier);

        const title = document.createElement('h3');
        title.className = 'message-stats-title';
        title.textContent = block.title || 'Stats';
        blockElement.appendChild(title);

        const list = document.createElement('dl');
        list.className = 'message-stats-list';
        if (block.kind === 'standings') {
            renderStandingsEntries(list, block.entries);
        } else {
            renderValueRows(list, block.rows);
        }

        blockElement.appendChild(list);
        container.appendChild(blockElement);
    }

    container.classList.remove('hidden');
}

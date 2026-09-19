import { createBlockSection, createStatsElement } from './PostMatchCards.js';
import { getComparisonColumns } from './PostMatchComparisonBlock.js';

function createHeader(column) {
    const cell = createStatsElement('th', 'message-stats-head', column.short);
    cell.setAttribute('scope', 'col');
    cell.setAttribute('abbr', column.label);
    cell.setAttribute('title', column.label);
    return cell;
}

function formatValue(entry, column) {
    if (column.source === 'direct') return String(entry[column.key] ?? 0);
    if (column.key === 'weaponRaceResult') {
        if (entry.extra?.weaponRaceDnf > 0) return 'DNF';
        const seconds = Math.max(0, Number(entry.extra?.weaponRaceTimeMs) || 0) / 1000;
        return `${seconds.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 3 })} s`;
    }
    const value = Math.max(0, Number(entry.extra?.[column.key]) || 0);
    return Number.isInteger(value) ? String(value) : value.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

export function createPostMatchComparisonTable(block) {
    const columns = getComparisonColumns(block);
    if (!block || block.entries.length === 0 || columns.length === 0) return null;
    const section = createBlockSection(block, 'message-stats-comparison');
    const table = createStatsElement('table', 'message-stats-table message-stats-comparison-table');
    table.appendChild(createStatsElement('caption', 'message-stats-title', block.title || 'Teilnehmervergleich'));
    const head = createStatsElement('thead', '');
    const headRow = createStatsElement('tr', 'message-stats-head-row');
    const playerHead = createStatsElement('th', 'message-stats-head', 'Spieler');
    playerHead.setAttribute('scope', 'col');
    headRow.appendChild(playerHead);
    for (const column of columns) headRow.appendChild(createHeader(column));
    head.appendChild(headRow);
    table.appendChild(head);
    const body = createStatsElement('tbody', '');
    for (const entry of block.entries) {
        const row = createStatsElement('tr', 'message-stats-comparison-row');
        row.setAttribute('data-stats-row-key', `comparison-player-${entry.playerIndex}`);
        row.appendChild(createStatsElement('th', 'message-stats-player', entry.label || `Spieler ${entry.playerIndex + 1}`));
        for (const column of columns) {
            const cell = createStatsElement('td', 'message-stats-comparison-value', formatValue(entry, column));
            cell.setAttribute('data-stats-value', column.key);
            row.appendChild(cell);
        }
        body.appendChild(row);
    }
    table.appendChild(body);
    section.appendChild(table);
    return section;
}

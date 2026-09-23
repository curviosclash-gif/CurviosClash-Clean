import { resolveVehiclePreview } from '../menu/MenuPreviewCatalog.js';

const COMPACT_ENTRY_LIMIT = 3;

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

export function formatLeaderboardTime(totalTimeMs) {
    const totalMs = Math.max(0, Math.round(Number(totalTimeMs) || 0));
    const hours = Math.floor(totalMs / 3_600_000);
    const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
    const seconds = ((totalMs % 60_000) / 1000).toFixed(3).padStart(6, '0');
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
        : `${minutes}:${seconds}`;
}

function formatLeaderboardDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '–';
    return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(date);
}

function clearChildren(element) {
    if (typeof element?.replaceChildren === 'function') element.replaceChildren();
    else if (Array.isArray(element?.children)) element.children.length = 0;
}

function createCell(tag, className, text) {
    const cell = document.createElement(tag);
    cell.className = className;
    cell.textContent = text;
    return cell;
}

function resolveLastResultMessage(lastResult, routeId) {
    if (!lastResult || lastResult.routeId !== routeId) return null;
    const time = formatLeaderboardTime(lastResult.totalTimeMs);
    if (lastResult.status === 'first_time') {
        return { tone: 'best', title: 'Erste gespeicherte Zeit', detail: `${time} · Platz 1` };
    }
    if (lastResult.status === 'new_best') {
        return {
            tone: 'best',
            title: 'Neue persönliche Bestzeit',
            detail: `${time} · ${(lastResult.improvementMs / 1000).toFixed(3)} s schneller`,
        };
    }
    if (lastResult.status === 'not_ranked') {
        return { tone: 'neutral', title: 'Letzter Lauf', detail: `${time} · nicht in den Top 10` };
    }
    const rank = Number.isInteger(lastResult.rank) ? `Platz ${lastResult.rank}` : 'gewertet';
    const delta = Math.max(0, Number(lastResult.deltaToBestMs) || 0);
    return {
        tone: 'neutral', title: 'Letzter Lauf',
        detail: `${time} · ${rank} · ${delta > 0 ? `${(delta / 1000).toFixed(3)} s hinter der Bestzeit` : 'Bestzeit'}`,
    };
}

export function createArcadeLeaderboardMenuCard(createElement) {
    const card = createElement('section', 'arcade-surface-card arcade-local-leaderboard');
    const header = createElement('div', 'arcade-local-leaderboard-header');
    header.appendChild(createElement('h3', 'arcade-surface-card-title', 'Deine besten Zeiten'));
    const line = createElement('p', 'arcade-surface-card-value', 'Für diese Karte wurden noch keine Zeiten gespeichert.');
    line.id = 'arcade-local-leaderboard-line';
    header.appendChild(line);
    card.appendChild(header);

    const result = createElement('div', 'arcade-leaderboard-result hidden');
    result.id = 'arcade-local-leaderboard-result';
    result.setAttribute('role', 'status');
    result.setAttribute('aria-live', 'polite');
    const resultTitle = createElement('strong', 'arcade-leaderboard-result-title');
    const resultDetail = createElement('span', 'arcade-leaderboard-result-detail');
    result.appendChild(resultTitle);
    result.appendChild(resultDetail);
    card.appendChild(result);

    const empty = createElement('p', 'arcade-leaderboard-empty', 'Noch keine Zeit – fahre diesen Parcours, um den ersten Rekord zu setzen.');
    empty.id = 'arcade-local-leaderboard-empty';
    card.appendChild(empty);

    const tableWrap = createElement('div', 'arcade-local-leaderboard-table-wrap');
    const table = createElement('table', 'arcade-local-leaderboard-table');
    table.id = 'arcade-local-leaderboard-table';
    const head = createElement('thead', '');
    const headRow = createElement('tr', '');
    [['Platz', 'rank'], ['Zeit', 'time'], ['Abstand', 'delta'], ['Fahrzeug', 'vehicle'], ['Strafe', 'penalty'], ['Datum', 'date']]
        .forEach(([label, key]) => {
            const heading = createCell('th', `is-${key}`, label);
            heading.setAttribute('scope', 'col');
            headRow.appendChild(heading);
        });
    head.appendChild(headRow);
    table.appendChild(head);
    const list = createElement('tbody', 'arcade-local-leaderboard-list');
    list.id = 'arcade-local-leaderboard-list';
    list.setAttribute('aria-label', 'Lokale Parcours-Bestenliste');
    table.appendChild(list);
    tableWrap.appendChild(table);
    card.appendChild(tableWrap);

    const toggle = createElement('button', 'secondary-btn arcade-local-leaderboard-toggle', 'Alle Zeiten anzeigen');
    toggle.type = 'button';
    toggle.id = 'btn-arcade-local-leaderboard-toggle';
    toggle.setAttribute('aria-controls', list.id);
    toggle.setAttribute('aria-expanded', 'false');
    card.appendChild(toggle);

    return { card, line, result, resultTitle, resultDetail, empty, tableWrap, list, toggle };
}

export function renderArcadeLeaderboardMenu(refs, {
    entries = [], routeId = '', routeLabel = 'Parcours', expanded = false, lastResult = null,
} = {}) {
    const rows = Array.isArray(entries) ? entries : [];
    const visibleRows = expanded ? rows : rows.slice(0, COMPACT_ENTRY_LIMIT);
    refs.line.textContent = rows.length > 0
        ? `${routeLabel} · ${rows.length === 1 ? '1 gespeicherte Zeit' : `${rows.length} gespeicherte Zeiten`}`
        : `${routeLabel} · noch keine gespeicherte Zeit`;
    refs.empty.classList.toggle('hidden', rows.length > 0);
    refs.tableWrap.classList.toggle('hidden', rows.length === 0);
    refs.toggle.classList.toggle('hidden', rows.length <= COMPACT_ENTRY_LIMIT);
    refs.toggle.textContent = expanded ? 'Weniger anzeigen' : `Alle ${rows.length} Zeiten anzeigen`;
    refs.toggle.setAttribute('aria-expanded', String(expanded));

    const message = resolveLastResultMessage(lastResult, routeId);
    refs.result.classList.toggle('hidden', !message);
    refs.result.classList.toggle('is-best', message?.tone === 'best');
    refs.resultTitle.textContent = message?.title || '';
    refs.resultDetail.textContent = message?.detail || '';

    clearChildren(refs.list);
    const bestTimeMs = Math.max(0, Number(rows[0]?.totalTimeMs) || 0);
    visibleRows.forEach((entry, index) => {
        const row = document.createElement('tr');
        const rank = index + 1;
        row.className = `arcade-local-leaderboard-row is-rank-${Math.min(rank, 4)}`;
        const isLatest = !!lastResult
            && lastResult.routeId === routeId
            && lastResult.recordedAtIso === entry?.date;
        row.classList.toggle('is-latest', isLatest);
        const rankCell = createCell('td', 'is-rank', String(rank));
        if (isLatest) {
            const badge = document.createElement('span');
            badge.className = 'arcade-leaderboard-new-badge';
            badge.textContent = 'NEU';
            rankCell.appendChild(badge);
        }
        row.appendChild(rankCell);
        row.appendChild(createCell('td', 'is-time', formatLeaderboardTime(entry?.totalTimeMs)));
        const deltaMs = Math.max(0, Number(entry?.totalTimeMs) || 0) - bestTimeMs;
        row.appendChild(createCell('td', 'is-delta', index === 0 ? 'Bestzeit' : `+${(deltaMs / 1000).toFixed(3)} s`));
        const vehicleId = normalizeString(entry?.vehicleId, 'unbekannt');
        row.appendChild(createCell('td', 'is-vehicle', resolveVehiclePreview(vehicleId)?.label || vehicleId));
        const penaltyMs = Math.max(0, Number(entry?.penaltyTimeMs) || 0);
        row.appendChild(createCell('td', `is-penalty${penaltyMs > 0 ? ' has-penalty' : ''}`, penaltyMs > 0 ? `${(penaltyMs / 1000).toFixed(3)} s` : '–'));
        row.appendChild(createCell('td', 'is-date', formatLeaderboardDate(entry?.date)));
        refs.list.appendChild(row);
    });
}

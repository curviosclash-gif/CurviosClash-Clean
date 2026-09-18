// Searchable table of open lobbies: one row per lobby, arrow keys move, Enter joins.
// Picking a row still fills the code field, so the manual way keeps working.

import {
    OPEN_LOBBY_STATES,
    OPEN_LOBBY_STATE_LABELS,
    filterOpenLobbyRows,
    mergeOpenLobbyRoster,
} from './OpenLobbyRoster.js';

export const OPEN_LOBBY_EMPTY_TEXT = 'Keine Lobby im Netzwerk gefunden — der Host muss eine Lobby erstellen, oder gib den Code direkt ein.';
const NO_MATCH_TEXT = 'Keine Lobby passt zur Suche.';
// Two lines per row fit the narrow join column: host and state on top, the match below.
const CELLS = Object.freeze([
    ['hostName', (row) => row.hostName],
    ['stateLabel', (row) => OPEN_LOBBY_STATE_LABELS[row.state] || row.state],
    ['details', (row) => `${row.modeLabel} · ${row.mapLabel} · ${row.memberCount}/${row.maxPlayers} Spieler`],
]);

export function createOpenLobbyTable({ container, searchInput = null, onSelect = () => {}, onJoin = () => {} } = {}) {
    const doc = container?.ownerDocument;
    let rows = [];
    let selectedCode = '';
    let placeholderText = '';

    const visibleRows = () => filterOpenLobbyRows(rows, searchInput?.value || '');
    const optionElements = () => Array.from(container?.querySelectorAll?.('[role="option"]') || []);

    const select = (row, { focus = false } = {}) => {
        if (!row) return;
        selectedCode = row.lobbyCode;
        for (const option of optionElements()) {
            const active = option.dataset.lobbyCode === selectedCode;
            option.setAttribute('aria-selected', String(active));
            option.tabIndex = active ? 0 : -1;
            if (active && focus) option.focus?.();
        }
        onSelect(row);
    };

    const createOption = (row) => {
        const option = doc.createElement('div');
        option.className = `mp-lobby-row is-${row.state}`;
        option.setAttribute('role', 'option');
        option.dataset.lobbyCode = row.lobbyCode;
        option.setAttribute('aria-selected', String(row.lobbyCode === selectedCode));
        option.tabIndex = row.lobbyCode === selectedCode ? 0 : -1;
        for (const [key, read] of CELLS) {
            const cell = doc.createElement('span');
            cell.className = `mp-lobby-cell mp-lobby-${key}`;
            cell.textContent = String(read(row) ?? '');
            option.appendChild(cell);
        }
        const join = doc.createElement('button');
        join.type = 'button';
        join.className = 'secondary-btn mp-lobby-join';
        join.tabIndex = -1;
        join.textContent = 'Beitreten';
        join.disabled = row.state !== OPEN_LOBBY_STATES.OPEN;
        join.addEventListener('click', (event) => {
            event.stopPropagation();
            select(row);
            onJoin(row);
        });
        option.addEventListener('click', () => select(row));
        option.appendChild(join);
        return option;
    };

    const render = () => {
        if (!container || !doc?.createElement) return;
        const hadFocus = typeof container.contains === 'function' && container.contains(doc.activeElement);
        const shown = visibleRows();
        if (shown.length === 0) {
            const empty = doc.createElement('p');
            empty.className = 'mp-lobby-empty';
            empty.textContent = placeholderText || (rows.length > 0 ? NO_MATCH_TEXT : OPEN_LOBBY_EMPTY_TEXT);
            container.replaceChildren(empty);
            return;
        }
        if (!shown.some((row) => row.lobbyCode === selectedCode)) selectedCode = '';
        const options = shown.map(createOption);
        if (!selectedCode) options[0].tabIndex = 0;
        container.replaceChildren(...options);
        if (hadFocus) (options.find((option) => option.tabIndex === 0) || options[0]).focus?.();
    };

    const moveBy = (step) => {
        const shown = visibleRows();
        if (shown.length === 0) return;
        const index = shown.findIndex((row) => row.lobbyCode === selectedCode);
        const next = index < 0 ? 0 : Math.max(0, Math.min(shown.length - 1, index + step));
        select(shown[next], { focus: true });
    };

    container?.addEventListener?.('keydown', (event) => {
        const shown = visibleRows();
        if (event.key === 'ArrowDown') moveBy(1);
        else if (event.key === 'ArrowUp') moveBy(-1);
        else if (event.key === 'Home') select(shown[0], { focus: true });
        else if (event.key === 'End') select(shown[shown.length - 1], { focus: true });
        else if (event.key === 'Enter') {
            const row = shown.find((entry) => entry.lobbyCode === selectedCode)
                || shown.find((entry) => entry.lobbyCode === event.target?.dataset?.lobbyCode);
            if (row?.state === OPEN_LOBBY_STATES.OPEN) {
                select(row);
                onJoin(row);
            }
        } else return;
        event.preventDefault?.();
    });
    searchInput?.addEventListener?.('input', render);

    return {
        update(lobbies) {
            placeholderText = '';
            rows = mergeOpenLobbyRoster(rows, lobbies);
            render();
            return rows;
        },
        reset(message = '') {
            rows = [];
            selectedCode = '';
            placeholderText = String(message || '');
            render();
        },
        getRows: () => rows.slice(),
        getVisibleRows: visibleRows,
    };
}

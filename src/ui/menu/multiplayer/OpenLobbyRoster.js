// The open-lobby list across refreshes: a lobby missing from one search is shown greyed
// as "nicht erreichbar", missing from two it disappears. Pure data, no DOM.

import { resolveMapPreview } from '../MenuPreviewCatalog.js';

export const OPEN_LOBBY_STATES = Object.freeze({
    OPEN: 'open',
    FULL: 'full',
    RUNNING: 'running',
    UNREACHABLE: 'unreachable',
});

export const OPEN_LOBBY_STATE_LABELS = Object.freeze({
    open: 'offen',
    full: 'voll',
    running: 'läuft bereits',
    unreachable: 'nicht erreichbar',
});

const MODE_LABELS = Object.freeze({ normal: 'Klassisch', fight: 'Kampf', arcade: 'Arcade', quick_action: 'Schnellstart' });
const MISSED_REFRESHES_UNTIL_REMOVAL = 2;

export function resolveOpenLobbyModeLabel(modePath) {
    return MODE_LABELS[String(modePath || '').trim()] || 'Unbekannt';
}

export function resolveOpenLobbyMapLabel(mapKey) {
    const key = String(mapKey || '').trim();
    return key ? resolveMapPreview(key).name : 'Unbekannt';
}

export function deriveOpenLobbyState(row) {
    if ((Number(row?.missedRefreshes) || 0) > 0) return OPEN_LOBBY_STATES.UNREACHABLE;
    if (row?.inMatch === true) return OPEN_LOBBY_STATES.RUNNING;
    const members = Math.max(0, Number(row?.memberCount) || 0);
    const capacity = Math.max(1, Number(row?.maxPlayers) || 10);
    return members >= capacity ? OPEN_LOBBY_STATES.FULL : OPEN_LOBBY_STATES.OPEN;
}

function toRow(lobby) {
    const lobbyCode = String(lobby?.lobbyCode || '').trim();
    if (!lobbyCode) return null;
    const row = {
        lobbyCode,
        hostName: String(lobby?.hostName || '').trim() || 'Unbekannter Host',
        modeLabel: resolveOpenLobbyModeLabel(lobby?.modePath),
        mapLabel: resolveOpenLobbyMapLabel(lobby?.mapKey),
        memberCount: Math.max(0, Math.floor(Number(lobby?.memberCount) || 0)),
        maxPlayers: Math.max(1, Math.floor(Number(lobby?.maxPlayers) || 10)),
        inMatch: lobby?.inMatch === true,
        signalingUrl: String(lobby?.signalingUrl || '').trim(),
        missedRefreshes: 0,
    };
    return { ...row, state: deriveOpenLobbyState(row) };
}

/** Fold one search result into the previous rows (same order: known lobbies first). */
export function mergeOpenLobbyRoster(previousRows = [], lobbies = []) {
    const fresh = new Map();
    for (const lobby of Array.isArray(lobbies) ? lobbies : []) {
        const row = toRow(lobby);
        if (row) fresh.set(row.lobbyCode, row);
    }
    const merged = [];
    for (const previous of Array.isArray(previousRows) ? previousRows : []) {
        if (fresh.has(previous.lobbyCode)) {
            merged.push(fresh.get(previous.lobbyCode));
            fresh.delete(previous.lobbyCode);
            continue;
        }
        const missedRefreshes = (Number(previous.missedRefreshes) || 0) + 1;
        if (missedRefreshes >= MISSED_REFRESHES_UNTIL_REMOVAL) continue;
        const stale = { ...previous, missedRefreshes };
        merged.push({ ...stale, state: deriveOpenLobbyState(stale) });
    }
    return [...merged, ...fresh.values()];
}

/** Search over host name, lobby code, map and play style; an empty query keeps all rows. */
export function filterOpenLobbyRows(rows = [], query = '') {
    const needle = String(query || '').trim().toLocaleLowerCase('de-DE');
    if (!needle) return Array.isArray(rows) ? rows.slice() : [];
    return (Array.isArray(rows) ? rows : []).filter((row) => [row.hostName, row.lobbyCode, row.mapLabel, row.modeLabel]
        .some((value) => String(value || '').toLocaleLowerCase('de-DE').includes(needle)));
}

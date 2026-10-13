// Standard German texts for "nothing here" and "did not work" states, one entry per situation.
// Plain language, no technical terms. `{reason}` in a text is replaced by resolveMenuStateNotice.

const entry = (value) => Object.freeze(value);

export const MENU_STATE_NOTICE_CATALOG = Object.freeze({
    'lobby-list-empty': entry({
        id: 'lobby-list-empty',
        kind: 'empty',
        title: 'Keine Lobby gefunden.',
        text: 'Im Moment wartet keine Lobby auf Mitspieler. Du kannst selbst eine eröffnen.',
        actionLabel: 'Eigene Lobby erstellen',
    }),
    'connection-lost': entry({
        id: 'connection-lost',
        kind: 'error',
        title: 'Die Verbindung ist abgebrochen.',
        text: 'Es hat nicht geklappt. Grund: {reason}',
        actionLabel: 'Erneut versuchen',
    }),
    'map-filter-empty': entry({
        id: 'map-filter-empty',
        kind: 'empty',
        title: 'Keine Karte passt zu deinem Filter.',
        text: 'Lockere die Filter, dann siehst du wieder Karten.',
        actionLabel: 'Filter zurücksetzen',
    }),
    'no-recordings': entry({
        id: 'no-recordings',
        kind: 'empty',
        title: 'Noch keine Aufnahmen.',
        text: 'Sobald du eine Runde aufnimmst, erscheint sie hier.',
    }),
    'no-ghost-yet': entry({
        id: 'no-ghost-yet',
        kind: 'empty',
        title: 'Noch kein Geist.',
        text: 'Noch kein Geist für diese Etappe. Flieg sie einmal, dann fliegt deine Bestleistung mit.',
    }),
    'no-profiles-for-slot': entry({
        id: 'no-profiles-for-slot',
        kind: 'empty',
        title: 'Kein Profil für diesen Platz.',
        text: 'Für diesen Spielerplatz gibt es noch kein Profil. Lege zuerst eines an.',
    }),
    'loading-map': entry({
        id: 'loading-map',
        kind: 'loading',
        title: 'Karte wird geladen …',
        text: 'Einen Moment bitte.',
    }),
    'generic-error': entry({
        id: 'generic-error',
        kind: 'error',
        title: 'Das hat nicht geklappt.',
        text: 'Etwas ist schiefgegangen. Bitte versuche es noch einmal.',
        actionLabel: 'Erneut versuchen',
    }),
});

const FALLBACK_REASON = 'Unbekannter Grund.';

/**
 * Returns a catalog entry (copy) by id; unknown ids give `generic-error`.
 * @param {string} id
 * @param {{ reason?: string }} [options]
 */
export function resolveMenuStateNotice(id, { reason } = {}) {
    const found = Object.hasOwn(MENU_STATE_NOTICE_CATALOG, id)
        ? MENU_STATE_NOTICE_CATALOG[id]
        : MENU_STATE_NOTICE_CATALOG['generic-error'];
    const reasonText = String(reason ?? '').trim() || FALLBACK_REASON;
    return { ...found, text: found.text.replaceAll('{reason}', reasonText) };
}

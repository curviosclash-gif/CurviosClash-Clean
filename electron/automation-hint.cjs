// ============================================
// automation-hint.cjs - marks a remote-controlled desktop window
// ============================================
//
// Ein Werkzeug, das ueber die Debug-Schnittstelle von Chromium Tasten
// schickt, ist im Fenster nicht von einem Menschen zu unterscheiden: die
// Ereignisse tragen dieselben Merkmale. Erkennbar ist die Fernsteuerung nur
// hier im Hauptprozess, denn nur der kennt die Startschalter des Browsers.
// Der Hinweis reist deshalb als Abfrageparameter mit der Adresse zum Fenster.

const AUTOMATION_ARGV_MARKERS = Object.freeze([
    '--remote-debugging-port',
    '--remote-debugging-pipe',
    '--inspect',
    '--inspect-brk',
]);

const AUTOMATION_HINT_PARAM = 'automation';

function sanitizeHint(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    return normalized.replace(/[^a-z0-9-]/g, '').slice(0, 32);
}

/**
 * @param {string[]} [argv] Startschalter des Hauptprozesses
 * @param {Record<string, string | undefined>} [env]
 * @returns {string} leerer Text, wenn nichts auf Fernsteuerung hindeutet
 */
function resolveAutomationHint(argv = [], env = {}) {
    // Ein ausdruecklicher Schalter des Startenden schlaegt die Heuristik: so
    // kann sich auch ein Werkzeug melden, das ohne Debug-Port arbeitet.
    const explicit = sanitizeHint(env?.CURVIOS_AUTOMATION);
    if (explicit) return explicit;
    const args = Array.isArray(argv) ? argv : [];
    const remoteControlled = args.some((arg) => typeof arg === 'string'
        && AUTOMATION_ARGV_MARKERS.some((marker) => arg === marker || arg.startsWith(`${marker}=`)));
    return remoteControlled ? 'cdp' : '';
}

/**
 * @param {string} url Adresse des eigenen Servers
 * @param {string} hint Ergebnis aus resolveAutomationHint
 * @returns {string} Adresse, bei leerem Hinweis unveraendert
 */
function appendAutomationHint(url, hint) {
    const normalizedHint = sanitizeHint(hint);
    const baseUrl = String(url || '');
    if (!normalizedHint || !baseUrl) return baseUrl;
    try {
        const parsed = new URL(baseUrl);
        parsed.searchParams.set(AUTOMATION_HINT_PARAM, normalizedHint);
        return parsed.toString();
    } catch {
        // Eine unlesbare Adresse darf den Start nicht verhindern.
        return baseUrl;
    }
}

module.exports = {
    AUTOMATION_HINT_PARAM,
    appendAutomationHint,
    resolveAutomationHint,
};

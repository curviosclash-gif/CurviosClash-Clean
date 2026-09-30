// ============================================
// automation-hint.cjs - marks a remote-controlled desktop window
// ============================================
//
// Ein Werkzeug, das ueber die Debug-Schnittstelle von Chromium Tasten
// schickt, ist im Fenster nicht von einem Menschen zu unterscheiden: die
// Ereignisse tragen dieselben Merkmale. Erkennbar ist die Fernsteuerung nur
// hier im Hauptprozess, denn nur der kennt die Startschalter des Browsers.
//
// Der Hinweis wird nach jedem Laden im Fenster gesetzt und nicht an die
// Adresse gehaengt: eine veraenderte Adresse laesst die Desktop-Tests ihren
// vorgebooteten Zustand verwerfen und ein zweites Mal laden.

const AUTOMATION_ARGV_MARKERS = Object.freeze([
    '--remote-debugging-port',
    '--remote-debugging-pipe',
    '--inspect',
    '--inspect-brk',
]);

const AUTOMATION_HINT_GLOBAL = '__CURVIOS_AUTOMATION__';

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
 * Setzt den Hinweis nach jedem Laden erneut, denn ein Neuladen raeumt die
 * Variable mit der alten Seite ab.
 *
 * @param {{on?: Function, executeJavaScript?: Function} | null} webContents
 * @param {string} hint Ergebnis aus resolveAutomationHint
 * @returns {boolean} true, wenn ein Hinweis eingerichtet wurde
 */
function installAutomationHintReporter(webContents, hint) {
    const normalizedHint = sanitizeHint(hint);
    if (!normalizedHint || typeof webContents?.on !== 'function') return false;
    const script = `window.${AUTOMATION_HINT_GLOBAL} = ${JSON.stringify(normalizedHint)};`;
    webContents.on('did-finish-load', () => {
        // Ein fehlgeschlagener Hinweis darf das Fenster nicht stoeren; die Runde
        // gilt dann als von Hand gespielt, was der bisherige Zustand war.
        Promise.resolve(webContents.executeJavaScript?.(script)).catch(() => {});
    });
    return true;
}

module.exports = {
    AUTOMATION_HINT_GLOBAL,
    installAutomationHintReporter,
    resolveAutomationHint,
};

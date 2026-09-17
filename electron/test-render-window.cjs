// Ein Fenster mit `show: false` bekommt von Windows/Chromium nur rund ein Bild pro
// Sekunde. Fuer Playwright-Laeufe ist das die groesste Bremse. Dieser Schalter zeigt
// das Fenster deshalb *unsichtbar fuer den Nutzer*: weit ausserhalb des Bildschirms,
// ohne Fokus, ohne Taskleisteneintrag. Ohne die Umgebungsvariable aendert sich nichts.
const TEST_RENDER_ENV_VAR = 'CURVIOS_ELECTRON_TEST_RENDER';
const TEST_RENDER_MODE_OFF = 'off';
const TEST_RENDER_MODE_INACTIVE = 'inactive';
// Weit genug ausserhalb jedes realen Desktops; Windows behaelt die Position bei.
const OFFSCREEN_WINDOW_POSITION = Object.freeze({ x: -32000, y: -32000 });

/**
 * Eine ausgelieferte App ignoriert den Schalter: ein unsichtbares, nicht fokussierbares
 * Spiel ohne Taskleisteneintrag waere fuer einen Spieler nur noch ueber den Task-Manager
 * zu beenden. Die Desktop-Tests starten Electron immer aus dem Quellcode.
 * @param {Record<string, string|undefined>} [env]
 * @param {{isPackaged?: boolean}} [options]
 * @returns {'off'|'inactive'}
 */
function resolveTestRenderMode(env = {}, { isPackaged = false } = {}) {
    if (isPackaged === true) return TEST_RENDER_MODE_OFF;
    const raw = String(env?.[TEST_RENDER_ENV_VAR] ?? '').trim().toLowerCase();
    if (raw === TEST_RENDER_MODE_INACTIVE || raw === '1') return TEST_RENDER_MODE_INACTIVE;
    return TEST_RENDER_MODE_OFF;
}

/**
 * Fensteroptionen, die zu den Basisoptionen dazukommen.
 * @param {string} mode
 * @returns {Readonly<object>}
 */
function createTestRenderWindowOptions(mode) {
    if (mode !== TEST_RENDER_MODE_INACTIVE) return Object.freeze({});
    return Object.freeze({
        show: false,
        skipTaskbar: true,
        focusable: false,
        x: OFFSCREEN_WINDOW_POSITION.x,
        y: OFFSCREEN_WINDOW_POSITION.y,
    });
}

/**
 * Die Optionen, die das Hauptfenster wirklich bekommt. Die Test-Optionen stehen bewusst
 * zuletzt: sie muessen auch ein sichtbar gewuenschtes `show` (z. B. bei @render-Tests)
 * ueberstimmen, sonst naehme der Konstruktor dem Nutzer den Fokus. Ohne Modus kommen die
 * Basisoptionen unveraendert zurueck.
 * @param {{baseOptions?: object, mode?: string}} [input]
 * @returns {object}
 */
function createMainWindowOptions({ baseOptions = {}, mode = TEST_RENDER_MODE_OFF } = {}) {
    return { ...baseOptions, ...createTestRenderWindowOptions(mode) };
}

/**
 * Chromium-Schalter, die vor `app.whenReady` gesetzt werden muessen. `appendSwitch`
 * ersetzt einen vorhandenen Wert, statt anzuhaengen: ein weiteres abzuschaltendes
 * Feature gehoert mit Komma in denselben `disable-features`-Wert.
 * @param {string} mode
 * @returns {ReadonlyArray<Readonly<{name: string, value?: string}>>}
 */
function listTestRenderCommandLineSwitches(mode) {
    if (mode !== TEST_RENDER_MODE_INACTIVE) return Object.freeze([]);
    return Object.freeze([
        // Die Windows-Verdeckungserkennung bremst auch sichtbare, aber ueberdeckte
        // Fenster auf ~1 Bild/s - genau der Fall eines Fensters ausserhalb des Schirms.
        Object.freeze({ name: 'disable-features', value: 'CalculateNativeWinOcclusion' }),
        Object.freeze({ name: 'disable-backgrounding-occluded-windows' }),
        Object.freeze({ name: 'disable-renderer-backgrounding' }),
    ]);
}

/** @param {string} mode */
function shouldShowInactive(mode) {
    return mode === TEST_RENDER_MODE_INACTIVE;
}

module.exports = {
    OFFSCREEN_WINDOW_POSITION,
    TEST_RENDER_ENV_VAR,
    TEST_RENDER_MODE_INACTIVE,
    TEST_RENDER_MODE_OFF,
    createMainWindowOptions,
    createTestRenderWindowOptions,
    listTestRenderCommandLineSwitches,
    resolveTestRenderMode,
    shouldShowInactive,
};

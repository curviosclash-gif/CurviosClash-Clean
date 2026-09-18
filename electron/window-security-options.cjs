/**
 * @typedef {object} SecureWindowWebPreferencesOptions
 * @property {string} [preload]
 * @property {boolean} [sandbox]
 * @property {boolean} [backgroundThrottling]
 */

/** @param {SecureWindowWebPreferencesOptions} [options] */
function createSecureWindowWebPreferences({
    preload,
    sandbox = true,
    backgroundThrottling = false,
} = {}) {
    return Object.freeze({
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: sandbox === true,
        backgroundThrottling: backgroundThrottling === true,
    });
}

const TRUSTED_EDITOR_PATHS = new Set([
    '/editor/map-editor-3d.html',
    '/prototypes/vehicle-lab/index.html',
]);

// Beide Autorenwerkzeuge sind dreispaltig aufgebaut. Unter dieser Breite
// fallen Bauteilliste und Eigenschaften unter die 3D-Ansicht und man scrollt
// fuer jede Aenderung; das Standardfenster von 800x600 war unbenutzbar.
const EDITOR_WINDOW_BOUNDS = Object.freeze({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
});

/**
 * Prueft, ob eine Adresse zu einem der Autorenwerkzeuge gehoert.
 * @param {string} url
 * @param {string} appServerUrl
 * @returns {boolean}
 */
function isTrustedEditorUrl(url, appServerUrl) {
    try {
        const target = new URL(url);
        return target.origin === new URL(appServerUrl).origin
            && TRUSTED_EDITOR_PATHS.has(target.pathname);
    } catch {
        return false;
    }
}

/**
 * @param {string} appServerUrl
 * @param {(target: URL) => boolean} isAllowedPath
 * @param {string|undefined} editorPreloadPath
 * @returns {(details?: {url?: string}) => {action: 'allow'|'deny', overrideBrowserWindowOptions?: object}}
 */
function createSameOriginWindowOpenHandler(appServerUrl, isAllowedPath, editorPreloadPath = undefined) {
    const trustedOrigin = new URL(appServerUrl).origin;
    return ({ url } = {}) => {
        try {
            const target = new URL(url);
            if (target.origin === trustedOrigin && isAllowedPath(target)) {
                return {
                    action: 'allow',
                    overrideBrowserWindowOptions: {
                        ...(TRUSTED_EDITOR_PATHS.has(target.pathname) ? EDITOR_WINDOW_BOUNDS : {}),
                        webPreferences: createSecureWindowWebPreferences(
                            TRUSTED_EDITOR_PATHS.has(target.pathname)
                                ? { preload: editorPreloadPath }
                                : {}
                        ),
                    },
                };
            }
        } catch {
            // Invalid and non-absolute URLs remain blocked.
        }
        return { action: 'deny' };
    };
}

/**
 * @param {string} appServerUrl
 * @param {{editorPreloadPath?: string}} [options] Preload fuer die
 *   Autorenwerkzeuge; ohne diesen Pfad haben sie keinen Dateizugriff.
 */
function createEditorWindowOpenHandler(appServerUrl, { editorPreloadPath } = {}) {
    return createSameOriginWindowOpenHandler(
        appServerUrl,
        (target) => TRUSTED_EDITOR_PATHS.has(target.pathname),
        editorPreloadPath,
    );
}

function createPlaytestWindowOpenHandler(appServerUrl) {
    return createSameOriginWindowOpenHandler(
        appServerUrl,
        (target) => ['/', '/index.html'].includes(target.pathname)
            && target.searchParams.get('playtest') === '1',
    );
}

const MAIN_WINDOW_APP_PATHS = new Set(['/', '/index.html']);

/**
 * Navigationswaechter fuers Hauptfenster: Nur die eigene Spielseite darf geladen werden.
 * Electron meldet auch location.reload() als will-navigate; ein pauschales Verbot
 * verhinderte deshalb das Neuladen nach einem Spielerprofilwechsel.
 * @param {string} appServerUrl
 * @returns {(event: {preventDefault: () => void}, url: string) => void}
 */
function createMainWindowNavigationGuard(appServerUrl) {
    const trustedOrigin = new URL(appServerUrl).origin;
    return (event, url) => {
        try {
            const target = new URL(url);
            if (target.origin === trustedOrigin && MAIN_WINDOW_APP_PATHS.has(target.pathname)) return;
        } catch {
            // Invalid and non-absolute URLs remain blocked.
        }
        event.preventDefault();
    };
}

module.exports = {
    EDITOR_WINDOW_BOUNDS,
    createEditorWindowOpenHandler,
    createMainWindowNavigationGuard,
    createPlaytestWindowOpenHandler,
    createSecureWindowWebPreferences,
    isTrustedEditorUrl,
};

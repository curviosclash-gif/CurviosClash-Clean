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

function createSameOriginWindowOpenHandler(appServerUrl, isAllowedPath) {
    const trustedOrigin = new URL(appServerUrl).origin;
    return ({ url } = {}) => {
        try {
            const target = new URL(url);
            if (target.origin === trustedOrigin && isAllowedPath(target)) {
                return {
                    action: 'allow',
                    overrideBrowserWindowOptions: {
                        ...(TRUSTED_EDITOR_PATHS.has(target.pathname) ? EDITOR_WINDOW_BOUNDS : {}),
                        webPreferences: createSecureWindowWebPreferences(),
                    },
                };
            }
        } catch {
            // Invalid and non-absolute URLs remain blocked.
        }
        return { action: 'deny' };
    };
}

function createEditorWindowOpenHandler(appServerUrl) {
    return createSameOriginWindowOpenHandler(
        appServerUrl,
        (target) => TRUSTED_EDITOR_PATHS.has(target.pathname),
    );
}

function createPlaytestWindowOpenHandler(appServerUrl) {
    return createSameOriginWindowOpenHandler(
        appServerUrl,
        (target) => ['/', '/index.html'].includes(target.pathname)
            && target.searchParams.get('playtest') === '1',
    );
}

module.exports = {
    EDITOR_WINDOW_BOUNDS,
    createEditorWindowOpenHandler,
    createPlaytestWindowOpenHandler,
    createSecureWindowWebPreferences,
    isTrustedEditorUrl,
};

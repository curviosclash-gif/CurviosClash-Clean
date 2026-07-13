const path = require('node:path');
const { existsSync } = require('node:fs');

const TUNING_WINDOW_SHELL_CONTRACT_VERSION = 'tuning-window-shell.v1';
const TUNING_WINDOW_DEFAULT_WIDTH = 420;
const TUNING_WINDOW_DEFAULT_HEIGHT = 800;
const TUNING_WINDOW_MIN_WIDTH = 360;
const TUNING_WINDOW_MIN_HEIGHT = 560;

function isWindowAlive(windowRef) {
    return !!windowRef && !windowRef.isDestroyed();
}

function resolveShowWindowFlag() {
    return String(process.env.CURVIOS_ELECTRON_SHOW_WINDOW || '').trim() !== '0';
}

function createFallbackHtml(message) {
    const safeMessage = String(message || 'Tuning Console ist derzeit nicht verfuegbar.');
        // Keep fallback intentionally plain to avoid depending on local assets.
    return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <title>CurviosClash Tuning Console</title>
  <style>
    body {
      margin: 0;
      font-family: "Segoe UI", sans-serif;
      background: #0b1220;
      color: #e2e8f0;
      display: grid;
      place-items: center;
      min-height: 100vh;
      padding: 16px;
      box-sizing: border-box;
    }
    .card {
      max-width: 420px;
      background: #121b2d;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 16px;
      line-height: 1.45;
    }
    h1 {
      margin: 0 0 8px;
      font-size: 18px;
    }
    p {
      margin: 0;
      color: #cbd5e1;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Tuning Console</h1>
    <p>${safeMessage}</p>
  </div>
</body>
</html>`)} `;
}

function resolveCapabilityStateSnapshot(resolveCapabilityState) {
    const sourceState = typeof resolveCapabilityState === 'function'
        ? resolveCapabilityState()
        : null;
    const available = sourceState?.available === true;
    return Object.freeze({
        contractVersion: String(sourceState?.contractVersion || 'tuning-desktop-capability.v1'),
        capabilityId: String(sourceState?.capabilityId || 'developer-tuning-console'),
        available,
        accessMode: String(sourceState?.accessMode || (available ? 'desktop-capability' : 'blocked')),
        reason: String(sourceState?.reason || (available ? 'desktop_capability_enabled' : 'desktop_capability_blocked')),
        message: String(sourceState?.message || (
            available
                ? 'Developer Tuning Console ist auf dieser Desktop-Surface verfuegbar.'
                : 'Developer Tuning Console ist auf dieser Surface nicht verfuegbar.'
        )),
        passwordGate: String(sourceState?.passwordGate || 'local-ux-only'),
    });
}

function resolveAlwaysOnTopFlag(options = {}, defaultAlwaysOnTop = false) {
    if (Object.prototype.hasOwnProperty.call(options, 'alwaysOnTop')) {
        return options.alwaysOnTop === true;
    }
    return defaultAlwaysOnTop === true;
}

function createTuningWindowController({
    BrowserWindow,
    resolveParentWindow = () => null,
    htmlPath = path.resolve(__dirname, 'tuning-console', 'tuning.html'),
    preloadPath = path.resolve(__dirname, 'tuning-preload.cjs'),
    resolveCapabilityState = () => ({ available: true }),
    defaultAlwaysOnTop = false,
    shouldShowWindow = resolveShowWindowFlag,
    onWindowClosed = null,
} = {}) {
    if (typeof BrowserWindow !== 'function') {
        throw new TypeError('createTuningWindowController erwartet BrowserWindow als Konstruktorfunktion.');
    }

    let tuningWindow = null;

    function getWindow() {
        return isWindowAlive(tuningWindow) ? tuningWindow : null;
    }

    function closeTuningWindow() {
        if (!isWindowAlive(tuningWindow)) {
            tuningWindow = null;
            return false;
        }
        const windowRef = tuningWindow;
        tuningWindow = null;
        windowRef.close();
        return true;
    }

    async function createTuningWindow(options = {}) {
        const capability = resolveCapabilityStateSnapshot(resolveCapabilityState);
        if (capability.available !== true) {
            return {
                ok: false,
                reason: 'capability_blocked',
                capability,
                window: null,
            };
        }

        if (isWindowAlive(tuningWindow)) {
            if (options.focus !== false) {
                if (tuningWindow.isMinimized()) {
                    tuningWindow.restore();
                }
                tuningWindow.focus();
            }
            if (Object.prototype.hasOwnProperty.call(options, 'alwaysOnTop')) {
                tuningWindow.setAlwaysOnTop(options.alwaysOnTop === true);
            }
            return {
                ok: true,
                reused: true,
                capability,
                window: tuningWindow,
            };
        }

        const parentWindow = typeof resolveParentWindow === 'function'
            ? resolveParentWindow()
            : null;
        const resolvedAlwaysOnTop = resolveAlwaysOnTopFlag(options, defaultAlwaysOnTop);

        tuningWindow = new BrowserWindow({
            width: TUNING_WINDOW_DEFAULT_WIDTH,
            height: TUNING_WINDOW_DEFAULT_HEIGHT,
            minWidth: TUNING_WINDOW_MIN_WIDTH,
            minHeight: TUNING_WINDOW_MIN_HEIGHT,
            title: 'CurviosClash Tuning Console',
            autoHideMenuBar: true,
            show: typeof shouldShowWindow === 'function' ? shouldShowWindow() : resolveShowWindowFlag(),
            alwaysOnTop: resolvedAlwaysOnTop,
            parent: isWindowAlive(parentWindow) ? parentWindow : undefined,
            webPreferences: {
                preload: preloadPath,
                contextIsolation: true,
                nodeIntegration: false,
                backgroundThrottling: false,
            },
        });

        tuningWindow.on('closed', () => {
            tuningWindow = null;
            onWindowClosed?.();
        });

        const windowRef = tuningWindow;
        if (existsSync(htmlPath)) {
            try {
                await windowRef.loadFile(htmlPath);
            } catch (error) {
                const fallbackMessage = error instanceof Error
                    ? error.message
                    : String(error || 'tuning_console_load_failed');
                await windowRef.loadURL(createFallbackHtml(fallbackMessage));
            }
        } else {
            await windowRef.loadURL(createFallbackHtml('Datei tuning.html wurde nicht gefunden.'));
        }

        if (options.focus === true && isWindowAlive(windowRef)) {
            windowRef.focus();
        }

        return {
            ok: true,
            reused: false,
            capability,
            window: windowRef,
        };
    }

    async function toggleTuningWindow(options = {}) {
        if (isWindowAlive(tuningWindow)) {
            closeTuningWindow();
            return {
                ok: true,
                action: 'closed',
                window: null,
            };
        }
        const result = await createTuningWindow(options);
        return {
            ...result,
            action: result.ok ? 'opened' : 'blocked',
        };
    }

    return Object.freeze({
        contractName: 'tuning-window-shell',
        contractVersion: TUNING_WINDOW_SHELL_CONTRACT_VERSION,
        createTuningWindow,
        closeTuningWindow,
        toggleTuningWindow,
        getWindow,
        getCapabilityState: () => resolveCapabilityStateSnapshot(resolveCapabilityState),
    });
}

module.exports = {
    TUNING_WINDOW_SHELL_CONTRACT_VERSION,
    createTuningWindowController,
};

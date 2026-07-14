const path = require('node:path');

const HANGAR_WINDOW_SHELL_CONTRACT_VERSION = 'hangar-window-shell.v1';
const HANGAR_WINDOW_MIN_WIDTH = 1100;
const HANGAR_WINDOW_MIN_HEIGHT = 700;

function isWindowAlive(windowRef) {
    return !!windowRef && !windowRef.isDestroyed();
}

function createHangarWindowController({
    BrowserWindow,
    resolveParentWindow = () => null,
    resolveWindowUrl,
    preloadPath = path.resolve(__dirname, 'hangar-preload.cjs'),
    shouldShowWindow = () => String(process.env.CURVIOS_ELECTRON_SHOW_WINDOW || '').trim() !== '0',
} = {}) {
    if (typeof BrowserWindow !== 'function') throw new TypeError('BrowserWindow fehlt.');
    if (typeof resolveWindowUrl !== 'function') throw new TypeError('resolveWindowUrl fehlt.');
    let hangarWindow = null;

    function getWindow() {
        return isWindowAlive(hangarWindow) ? hangarWindow : null;
    }

    function closeHangarWindow() {
        if (!isWindowAlive(hangarWindow)) { hangarWindow = null; return false; }
        const current = hangarWindow;
        hangarWindow = null;
        current.close();
        return true;
    }

    async function openHangarWindow(options = {}) {
        if (isWindowAlive(hangarWindow)) {
            if (hangarWindow.isMinimized()) hangarWindow.restore();
            if (options.focus !== false) hangarWindow.focus();
            return { ok: true, reused: true, window: hangarWindow };
        }
        const parent = resolveParentWindow();
        hangarWindow = new BrowserWindow({
            width: 1600,
            height: 1000,
            minWidth: HANGAR_WINDOW_MIN_WIDTH,
            minHeight: HANGAR_WINDOW_MIN_HEIGHT,
            title: 'CurviosClash Hangar',
            autoHideMenuBar: true,
            show: false,
            parent: isWindowAlive(parent) ? parent : undefined,
            webPreferences: {
                preload: preloadPath,
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                backgroundThrottling: false,
            },
        });
        hangarWindow.on('closed', () => { hangarWindow = null; });
        const current = hangarWindow;
        current.once?.('ready-to-show', () => {
            if (!isWindowAlive(current)) return;
            current.maximize?.();
            if (shouldShowWindow()) current.show?.();
        });
        const windowUrl = await resolveWindowUrl(options);
        current.webContents?.setWindowOpenHandler?.(() => ({ action: 'deny' }));
        current.webContents?.on?.('will-navigate', (event, nextUrl) => {
            if (String(nextUrl || '') !== String(windowUrl || '')) event.preventDefault();
        });
        await current.loadURL(windowUrl);
        if (options.focus !== false && isWindowAlive(current)) current.focus();
        return { ok: true, reused: false, window: current };
    }

    return Object.freeze({
        contractName: 'hangar-window-shell',
        contractVersion: HANGAR_WINDOW_SHELL_CONTRACT_VERSION,
        openHangarWindow,
        closeHangarWindow,
        getWindow,
    });
}

module.exports = { HANGAR_WINDOW_SHELL_CONTRACT_VERSION, createHangarWindowController };

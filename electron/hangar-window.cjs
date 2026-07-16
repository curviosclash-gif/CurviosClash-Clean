const path = require('node:path');
const { createSecureWindowWebPreferences } = require('./window-security-options.cjs');

const HANGAR_WINDOW_SHELL_CONTRACT_VERSION = 'hangar-window-shell.v1';
const HANGAR_WINDOW_MIN_WIDTH = 1100;
const HANGAR_WINDOW_MIN_HEIGHT = 700;

function isWindowAlive(windowRef) {
    return !!windowRef && !windowRef.isDestroyed();
}

function createHangarWindowController({
    BrowserWindow,
    dialog,
    resolveParentWindow = () => null,
    resolveWindowUrl,
    preloadPath = path.resolve(__dirname, 'hangar-preload.cjs'),
    shouldShowWindow = () => String(process.env.CURVIOS_ELECTRON_SHOW_WINDOW || '').trim() !== '0',
} = {}) {
    if (typeof BrowserWindow !== 'function') throw new TypeError('BrowserWindow fehlt.');
    if (typeof resolveWindowUrl !== 'function') throw new TypeError('resolveWindowUrl fehlt.');
    let hangarWindow = null;
    let activeMode = null;
    let hasUnsavedChanges = false;
    let allowWindowClose = false;

    function getWindow() {
        return isWindowAlive(hangarWindow) ? hangarWindow : null;
    }

    function closeHangarWindow() {
        if (!isWindowAlive(hangarWindow)) { hangarWindow = null; return false; }
        const current = hangarWindow;
        current.close();
        return !isWindowAlive(current);
    }

    function setUnsavedChanges(value) {
        hasUnsavedChanges = value === true;
        if (hasUnsavedChanges) allowWindowClose = false;
        return true;
    }

    async function openHangarWindow(options = {}) {
        const requestedMode = String(options.mode || '').trim().toLowerCase() === 'fight' ? 'fight' : 'arcade';
        if (isWindowAlive(hangarWindow)) {
            if (hangarWindow.isMinimized()) hangarWindow.restore();
            if (activeMode !== requestedMode) {
                const nextUrl = await resolveWindowUrl({ ...options, mode: requestedMode });
                await hangarWindow.loadURL(nextUrl);
                activeMode = requestedMode;
            }
            if (options.focus !== false) hangarWindow.focus();
            return { ok: true, reused: true, window: hangarWindow };
        }
        const parent = resolveParentWindow();
        hasUnsavedChanges = false;
        allowWindowClose = false;
        hangarWindow = new BrowserWindow({
            width: 1600,
            height: 1000,
            minWidth: HANGAR_WINDOW_MIN_WIDTH,
            minHeight: HANGAR_WINDOW_MIN_HEIGHT,
            title: 'CurviosClash Hangar',
            autoHideMenuBar: true,
            show: false,
            parent: isWindowAlive(parent) ? parent : undefined,
            webPreferences: createSecureWindowWebPreferences({
                preload: preloadPath,
                backgroundThrottling: false,
            }),
        });
        hangarWindow.on('close', (event) => {
            if (allowWindowClose || !hasUnsavedChanges) return;
            let response = 1;
            try {
                response = dialog?.showMessageBoxSync?.(hangarWindow, {
                    type: 'warning',
                    buttons: ['Verwerfen und schließen', 'Abbrechen'],
                    defaultId: 1,
                    cancelId: 1,
                    noLink: true,
                    message: 'Es gibt ungespeicherte Änderungen.',
                    detail: 'Willst du den Hangar wirklich verlassen?',
                }) ?? 1;
            } catch {
                response = 1;
            }
            if (response !== 0) {
                event?.preventDefault?.();
                return;
            }
            allowWindowClose = true;
        });
        hangarWindow.on('closed', () => {
            hangarWindow = null;
            activeMode = null;
            hasUnsavedChanges = false;
            allowWindowClose = false;
        });
        const current = hangarWindow;
        current.once?.('ready-to-show', () => {
            if (!isWindowAlive(current)) return;
            current.maximize?.();
            if (shouldShowWindow()) current.show?.();
        });
        const windowUrl = await resolveWindowUrl({ ...options, mode: requestedMode });
        current.webContents?.setWindowOpenHandler?.(() => ({ action: 'deny' }));
        current.webContents?.on?.('will-navigate', (event, nextUrl) => {
            if (String(nextUrl || '') !== String(windowUrl || '')) event.preventDefault();
        });
        await current.loadURL(windowUrl);
        activeMode = requestedMode;
        if (options.focus !== false && isWindowAlive(current)) current.focus();
        return { ok: true, reused: false, window: current };
    }

    return Object.freeze({
        contractName: 'hangar-window-shell',
        contractVersion: HANGAR_WINDOW_SHELL_CONTRACT_VERSION,
        openHangarWindow,
        closeHangarWindow,
        setUnsavedChanges,
        getWindow,
    });
}

module.exports = { HANGAR_WINDOW_SHELL_CONTRACT_VERSION, createHangarWindowController };

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { registerSettingsStudioIpc } = require('./ipc/settings-studio-ipc.cjs');
const {
    configureStoragePaths,
    initSessionDataSelfHeal,
} = require('../session-data-runtime.cjs');
const { isTrustedWindowSender } = require('../ipc-sender-guard.cjs');
const { createSecureWindowWebPreferences } = require('../window-security-options.cjs');

const WINDOW_SHELL_CONTRACT_VERSION = 'settings-studio.window-shell.v1';
const DIRTY_STATE_CHANNEL = 'settings-studio:set-dirty-state';
const SHARED_USER_DATA_DIR_NAME = 'curviosclash-app';
const SETTINGS_STUDIO_USER_DATA_DIR_NAME = 'profile-settings-studio';
const SETTINGS_STUDIO_SESSION_DATA_DIR_NAME = 'session-settings-studio';
const LEGACY_ELECTRON_USER_DATA_DIR_NAME = 'Electron';
const SETTINGS_STUDIO_DATA_ENTRIES = Object.freeze([
    'menu-defaults.override.json',
    'settings-studio-prefs.json',
    'settings-studio-backups',
]);
let markSessionExitClean = () => {};

function resolveSharedUserDataPath() {
    return path.join(app.getPath('appData'), SHARED_USER_DATA_DIR_NAME);
}

function resolveLegacyUserDataPath() {
    return path.join(app.getPath('appData'), LEGACY_ELECTRON_USER_DATA_DIR_NAME);
}

function migrateLegacySettingsStudioData() {
    const legacyUserDataPath = resolveLegacyUserDataPath();
    const sharedUserDataPath = resolveSharedUserDataPath();
    if (legacyUserDataPath === sharedUserDataPath || !fs.existsSync(legacyUserDataPath)) {
        return;
    }

    try {
        fs.mkdirSync(sharedUserDataPath, { recursive: true });
    } catch (error) {
        console.warn('[SettingsStudio] Legacy data directory migration skipped.', error);
        return;
    }

    for (const entryName of SETTINGS_STUDIO_DATA_ENTRIES) {
        const sourcePath = path.join(legacyUserDataPath, entryName);
        const targetPath = path.join(sharedUserDataPath, entryName);
        if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
            continue;
        }
        try {
            fs.cpSync(sourcePath, targetPath, { recursive: true });
        } catch (error) {
            console.warn(`[SettingsStudio] Legacy data migration skipped for ${entryName}.`, error);
        }
    }
}

const {
    sharedUserDataPath: settingsDataPath,
    sessionDataPath: settingsSessionDataPath,
} = configureStoragePaths({
    app,
    sharedUserDataDirName: SHARED_USER_DATA_DIR_NAME,
    userDataDirName: SETTINGS_STUDIO_USER_DATA_DIR_NAME,
    sessionDataDirName: SETTINGS_STUDIO_SESSION_DATA_DIR_NAME,
});
const settingsDataApp = Object.freeze({
    getPath(pathName) {
        return pathName === 'userData' ? settingsDataPath : app.getPath(pathName);
    },
});
app.setAppUserModelId('de.curviosclash.studio');
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
    app.quit();
} else {
    migrateLegacySettingsStudioData();
    const sessionSelfHealState = initSessionDataSelfHeal({
        sessionDataPath: settingsSessionDataPath,
        processLabel: 'settings-studio',
    });
    markSessionExitClean = sessionSelfHealState.markCleanExit;
}

let mainWindow = null;
let disposeIpc = null;
let hasUnsavedChanges = false;

function createWindowShellCapability() {
    return Object.freeze({
        contractName: 'settings-studio-window-shell',
        contractVersion: WINDOW_SHELL_CONTRACT_VERSION,
        async start() {
            if (mainWindow && !mainWindow.isDestroyed()) {
                return mainWindow;
            }

            const shouldShowWindow = String(process.env.CURVIOS_ELECTRON_SHOW_WINDOW || '').trim() !== '0';
            mainWindow = new BrowserWindow({
                width: 1280,
                height: 860,
                minWidth: 960,
                minHeight: 680,
                title: 'CurviosClash Settings Studio',
                show: shouldShowWindow,
                webPreferences: createSecureWindowWebPreferences({
                    preload: path.resolve(__dirname, 'preload.cjs'),
                    backgroundThrottling: false,
                }),
            });

            mainWindow.webContents.on('will-navigate', (event) => {
                event.preventDefault();
            });
            mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

            await mainWindow.loadFile(path.resolve(__dirname, 'ui', 'settings-studio.html'));
            let allowWindowClose = false;
            mainWindow.on('close', (event) => {
                if (allowWindowClose || !hasUnsavedChanges) {
                    return;
                }

                const choice = dialog.showMessageBoxSync(mainWindow, {
                    type: 'warning',
                    buttons: ['Verwerfen und schliessen', 'Abbrechen'],
                    defaultId: 1,
                    cancelId: 1,
                    noLink: true,
                    message: 'Es gibt ungespeicherte Aenderungen.',
                    detail: 'Willst du das Settings Studio wirklich schliessen?',
                });

                if (choice !== 0) {
                    event.preventDefault();
                    return;
                }

                allowWindowClose = true;
            });
            mainWindow.on('closed', () => {
                mainWindow = null;
                hasUnsavedChanges = false;
            });
            return mainWindow;
        },
        focus() {
            if (!mainWindow || mainWindow.isDestroyed()) return false;
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.focus();
            return true;
        },
    });
}

const windowShell = createWindowShellCapability();

async function startSettingsStudio() {
    if (!disposeIpc) {
        disposeIpc = registerSettingsStudioIpc({
            ipcMain,
            app: settingsDataApp,
            getWindow: () => mainWindow,
            browserDemoProjectRootPath: app.isPackaged
                ? settingsDataPath
                : path.resolve(__dirname, '..', '..'),
        });
    }
    await windowShell.start();
}

async function shutdownSettingsStudio() {
    if (disposeIpc) {
        disposeIpc();
        disposeIpc = null;
    }
}

app.whenReady().then(async () => {
    if (!hasSingleInstanceLock) {
        return;
    }
    ipcMain.on(DIRTY_STATE_CHANNEL, (event, dirtyState) => {
        if (!isTrustedWindowSender(event, mainWindow)) return;
        hasUnsavedChanges = dirtyState === true;
    });
    try {
        await startSettingsStudio();
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unbekannter Startfehler';
        dialog.showErrorBox('Settings Studio Startfehler', message);
        await shutdownSettingsStudio();
        app.quit();
    }
});

app.on('second-instance', () => {
    windowShell.focus();
});

app.on('window-all-closed', () => {
    void shutdownSettingsStudio().finally(() => {
        app.quit();
    });
});

app.on('before-quit', () => {
    markSessionExitClean();
    void shutdownSettingsStudio();
});

app.on('will-quit', () => {
    ipcMain.removeAllListeners(DIRTY_STATE_CHANNEL);
});

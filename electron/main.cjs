// ============================================
// electron/main.cjs - Electron main process
// ============================================

const { app, BrowserWindow, ipcMain, dialog, Tray, nativeImage, globalShortcut, session } = require('electron');
const path = require('node:path');
const {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} = require('node:fs');
const dgram = require('node:dgram');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { startStaticServer } = require('./static-server.cjs');
const {
    configureStoragePaths,
    initSessionDataSelfHeal,
    resolveAppDataRoot,
} = require('./session-data-runtime.cjs');
const { createRecordingVideoExportJob } = require('./recording-video-export-job.cjs');
const { createCinematicReplayVideoExportJob } = require('./cinematic-replay-video-export-job.cjs');
const { createTuningWindowController } = require('./tuning-window.cjs');
const { registerTuningIpc } = require('./tuning-ipc.cjs');
const { createHangarWindowController } = require('./hangar-window.cjs');
const {
    createEditorWindowOpenHandler,
    createPlaytestWindowOpenHandler,
    createSecureWindowWebPreferences,
    isTrustedEditorUrl,
} = require('./window-security-options.cjs');
const { installEditorDownloadTarget } = require('./editor-download-target.cjs');
const { createEditorVehicleStore } = require('./editor-vehicle-store.cjs');
const {
    UNTRUSTED_IPC_SENDER_CODE,
    assertTrustedWindowSender,
    isTrustedWindowSender,
} = require('./ipc-sender-guard.cjs');

let mainWindow = null;
let tray = null;
let signalingRuntime = null;
let staticAppServer = null;
let signalingStartPromise = null;
let signalingStopPromise = null;
let disposeTuningIpc = null;

function isTrustedMainWindowSender(event) {
    return isTrustedWindowSender(event, mainWindow);
}

function withTrustedMainWindowSender(handler) {
    return (event, ...args) => {
        assertTrustedWindowSender(event, mainWindow);
        return handler(...args);
    };
}

// Autorenfenster entstehen erst beim Oeffnen und werden hier gefuehrt, damit
// ihre Dateizugriffe dieselbe Senderpruefung durchlaufen wie jede andere
// privilegierte IPC (ADR 0001).
const editorWindows = new Set();

function withTrustedEditorWindowSender(handler) {
    return (event, ...args) => {
        const sender = [...editorWindows].find((candidate) => isTrustedWindowSender(event, candidate));
        if (!sender) {
            const error = Object.assign(
                new Error('Desktop capability request came from an unknown renderer.'),
                { code: UNTRUSTED_IPC_SENDER_CODE }
            );
            throw error;
        }
        return handler(...args);
    };
}

function withTrustedHangarWindowSender(handler) {
    return (event, ...args) => {
        assertTrustedWindowSender(event, hangarWindowShellCapability.getWindow());
        return handler(...args);
    };
}

const SIGNALING_PORTS = [9090, 9091, 9093, 9094];
const GRACEFUL_CLOSE_TIMEOUT_MS = 30000;
const SIGNALING_PORT_FALLBACK = 0;
const DISCOVERY_PORT = 9092;
const DISCOVERY_INTERVAL = 2000;
const DISCOVERY_MAGIC = 'CURVIOS_HOST';
let signalingPort = 9090;
let broadcastSocket = null;
let broadcastTimer = null;
let discoverySocket = null;
const discoveredHosts = new Map();
const signalingDiagnostics = {
    state: 'stopped',
    configuredPorts: Object.freeze([...SIGNALING_PORTS]),
    attemptedPorts: [],
    selectedPort: null,
    selectedPortMode: null,
    lastStartAttemptAt: null,
    lastStartedAt: null,
    lastStoppedAt: null,
    lastError: null,
};
const SHARED_USER_DATA_DIR_NAME = 'curviosclash-app';
const MAIN_SESSION_DATA_DIR_NAME = 'session-main';
const LEGACY_ELECTRON_USER_DATA_DIR_NAME = 'Electron';
const { sessionDataPath: mainSessionDataPath } = configureStoragePaths({
    app,
    sharedUserDataDirName: SHARED_USER_DATA_DIR_NAME,
    sessionDataDirName: MAIN_SESSION_DATA_DIR_NAME,
});
app.setAppUserModelId('de.curviosclash.main');
const hasSingleInstanceLock = process.env.PW_RUN_TAG ? true : app.requestSingleInstanceLock();
const WINDOW_SHELL_CONTRACT_VERSION = 'electron.window-shell.v1';
const HOST_SHELL_CONTRACT_VERSION = 'electron.lan-host-shell.v1';
const SETTINGS_DEFAULTS_CONTRACT_VERSION = 'preload.settings-defaults.v1';
const RECORDING_VIDEO_EXPORT_REQUEST_CONTRACT_VERSION = 'recording-video-export-request.v1';
const RECORDING_VIDEO_EXPORT_CAPABILITY_ID = 'recording-video-export-save';
const TUNING_CONSOLE_CAPABILITY_CONTRACT_VERSION = 'tuning-console-capability.v1';
const TUNING_CONSOLE_CAPABILITY_ID = 'developer-tuning-console';
const TUNING_CONSOLE_HOTKEY = 'F7';
const DESKTOP_RENDERER_DIST_DIR_NAME = 'dist-app';
const LEGACY_RENDERER_DIST_DIR_NAME = 'dist';
const DESKTOP_STATIC_SERVER_DEFAULT_PORT = 38765;
const MENU_DEFAULTS_OVERRIDE_FILE_NAME = 'menu-defaults.override.json';
const MENU_TEXT_OVERRIDES_FILE_NAME = 'menu-text-overrides.json';
let markSessionExitClean = () => {};

if (!hasSingleInstanceLock) {
    app.quit();
} else {
    const sessionSelfHealState = initSessionDataSelfHeal({
        sessionDataPath: mainSessionDataPath,
        processLabel: 'main',
    });
    markSessionExitClean = sessionSelfHealState.markCleanExit;
}

async function loadLanSignalingModule() {
    const moduleUrl = pathToFileURL(path.resolve(__dirname, '..', 'server', 'lan-signaling.js')).href;
    return import(moduleUrl);
}

function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push(iface.address);
            }
        }
    }

    return ips;
}

function toErrorSnapshot(error, fallbackMessage) {
    const message = error instanceof Error
        ? error.message
        : String(error || fallbackMessage || 'Unbekannter Fehler');
    return {
        code: String(error?.code || '').trim() || null,
        message,
        at: Date.now(),
    };
}

function resetSignalingError() {
    signalingDiagnostics.lastError = null;
}

function recordSignalingError(error, fallbackMessage) {
    signalingDiagnostics.lastError = toErrorSnapshot(error, fallbackMessage);
}

function getSignalingDiagnosticsSnapshot() {
    const localIps = getLocalIPs();
    return {
        running: !!signalingRuntime,
        state: signalingDiagnostics.state,
        port: signalingRuntime ? signalingPort : null,
        selectedPort: signalingRuntime ? signalingPort : signalingDiagnostics.selectedPort,
        selectedPortMode: signalingDiagnostics.selectedPortMode,
        configuredPorts: [...signalingDiagnostics.configuredPorts],
        attemptedPorts: [...signalingDiagnostics.attemptedPorts],
        discoveryPort: DISCOVERY_PORT,
        broadcasting: !!broadcastTimer,
        localIps,
        hostIp: localIps[0] || 'localhost',
        lastStartAttemptAt: signalingDiagnostics.lastStartAttemptAt,
        lastStartedAt: signalingDiagnostics.lastStartedAt,
        lastStoppedAt: signalingDiagnostics.lastStoppedAt,
        lastError: signalingDiagnostics.lastError ? { ...signalingDiagnostics.lastError } : null,
    };
}

function updateTrayTooltip() {
    if (!tray) return;
    const status = signalingRuntime
        ? `LAN Server: Running (Port ${signalingPort})`
        : (signalingDiagnostics.state === 'starting'
            ? 'LAN Server: Starting'
            : (signalingDiagnostics.state === 'stopping'
                ? 'LAN Server: Stopping'
                : (signalingDiagnostics.lastError?.message
                    ? `LAN Server: Fehler (${signalingDiagnostics.lastError.message})`
                    : 'LAN Server: Stopped')));
    tray.setToolTip(`CurviosClash - ${status}`);
}

function createTray() {
    try {
        tray = new Tray(nativeImage.createEmpty());
        updateTrayTooltip();
    } catch {
        // Tray is optional.
    }
}

function stopBroadcast() {
    if (broadcastTimer) {
        clearInterval(broadcastTimer);
        broadcastTimer = null;
    }
    if (broadcastSocket) {
        try {
            broadcastSocket.close();
        } catch {
            // Ignore close errors during shutdown.
        }
        broadcastSocket = null;
    }
}

function startBroadcast(resolveState) {
    stopBroadcast();
    broadcastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    broadcastSocket.on('error', (err) => { console.error('[broadcast] UDP socket error:', err.message); });
    broadcastSocket.bind(0, () => {
        if (!broadcastSocket) return;
        broadcastSocket.setBroadcast(true);
        const hostName = os.hostname();
        const ips = getLocalIPs();
        broadcastTimer = setInterval(() => {
            const state = typeof resolveState === 'function' ? resolveState() : null;
            const lobbyCode = String(state?.lobbyCode || '').trim();
            if (!lobbyCode || !broadcastSocket) return;
            const metadata = state?.metadata && typeof state.metadata === 'object' ? state.metadata : {};

            const broadcastIps = ips.length > 0 ? ips : ['127.0.0.1'];
            for (const ip of broadcastIps) {
                const payload = JSON.stringify({
                    magic: DISCOVERY_MAGIC,
                    ip,
                    port: signalingPort,
                    lobbyCode,
                    hostName: String(metadata.hostName || state?.hostName || hostName).trim(),
                    playerCount: Number(state?.playerCount || 0),
                    maxPlayers: Number(state?.maxPlayers || 10),
                    mapKey: String(metadata.mapKey || 'standard').trim(),
                    gameMode: String(metadata.gameMode || 'CLASSIC').trim(),
                    modePath: String(metadata.modePath || 'normal').trim(),
                    winsNeeded: Number(metadata.winsNeeded || 5),
                });
                const buffer = Buffer.from(payload);
                broadcastSocket.send(buffer, 0, buffer.length, DISCOVERY_PORT, '255.255.255.255');
            }
        }, DISCOVERY_INTERVAL);
    });
}

function waitForServerReady(server, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        if (!server) {
            reject(new Error('Signaling-Serverinstanz fehlt.'));
            return;
        }
        if (server.listening) {
            resolve();
            return;
        }
        let settled = false;
        let timeoutId = null;
        const finish = (callback) => {
            if (settled) return;
            settled = true;
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            server.removeListener('listening', onListening);
            server.removeListener('error', onError);
            callback();
        };
        const onListening = () => {
            finish(resolve);
        };
        const onError = (err) => {
            finish(() => reject(err));
        };
        timeoutId = setTimeout(() => {
            const timeoutError = new Error(`Signaling-Server wurde nach ${timeoutMs}ms nicht bereit.`);
            timeoutError.code = 'LAN_SIGNALING_START_TIMEOUT';
            finish(() => reject(timeoutError));
        }, timeoutMs);
        server.once('listening', onListening);
        server.once('error', onError);
    });
}

async function startSignalingServer() {
    if (signalingRuntime) return signalingRuntime;
    if (signalingStartPromise) return signalingStartPromise;
    if (signalingStopPromise) {
        await signalingStopPromise;
    }

    signalingDiagnostics.state = 'starting';
    signalingDiagnostics.attemptedPorts = [];
    signalingDiagnostics.selectedPort = null;
    signalingDiagnostics.selectedPortMode = null;
    signalingDiagnostics.lastStartAttemptAt = Date.now();
    resetSignalingError();
    updateTrayTooltip();

    signalingStartPromise = (async () => {
        const { createLANSignalingServer } = await loadLanSignalingModule();
        const candidatePorts = [...SIGNALING_PORTS, SIGNALING_PORT_FALLBACK];

        let runtime = null;
        for (const port of candidatePorts) {
            signalingDiagnostics.attemptedPorts.push(port);
            const candidate = createLANSignalingServer(port, {
                resolveDiagnostics: getSignalingDiagnosticsSnapshot,
            });
            try {
                await waitForServerReady(candidate.server);
                runtime = candidate;
                const address = candidate.server.address();
                signalingPort = address && typeof address === 'object'
                    ? Number(address.port || port || 0)
                    : Number(port || 0);
                signalingDiagnostics.selectedPort = signalingPort;
                signalingDiagnostics.selectedPortMode = port === SIGNALING_PORT_FALLBACK
                    ? 'ephemeral-fallback'
                    : 'configured';
                break;
            } catch (err) {
                if (err?.code === 'EADDRINUSE') {
                    console.warn(`[Signaling] Port ${port} belegt, versuche naechsten...`);
                    try { candidate.server.close(); } catch { /* ignore */ }
                    continue;
                }
                recordSignalingError(err, 'Signaling-Server konnte nicht gestartet werden.');
                try { candidate.server.close(); } catch { /* ignore */ }
                throw err;
            }
        }

        if (!runtime) {
            const attemptedPortsLabel = candidatePorts
                .map((port) => (port === SIGNALING_PORT_FALLBACK ? 'ephemeral' : String(port)))
                .join(', ');
            const error = new Error(`Kein freier Port fuer Signaling Server (versucht: ${attemptedPortsLabel})`);
            error.code = 'LAN_SIGNALING_PORT_UNAVAILABLE';
            recordSignalingError(error);
            signalingDiagnostics.state = 'error';
            throw error;
        }

        runtime.server.on('error', (error) => {
            recordSignalingError(error, 'Signaling-Serverfehler');
            console.error('[Signaling] Error:', error);
            updateTrayTooltip();
        });
        runtime.server.on('close', () => {
            if (signalingRuntime?.server === runtime.server) {
                signalingRuntime = null;
            }
            signalingDiagnostics.state = 'stopped';
            signalingDiagnostics.lastStoppedAt = Date.now();
            stopBroadcast();
            updateTrayTooltip();
        });

        signalingRuntime = runtime;
        signalingDiagnostics.state = 'running';
        signalingDiagnostics.lastStartedAt = Date.now();
        resetSignalingError();
        startBroadcast(() => ({
            lobbyCode: runtime.lobby?.code || '',
            hostName: runtime.lobby?.hostName || '',
            playerCount: runtime.lobby ? 1 + (runtime.lobby.players?.length || 0) : 0,
            maxPlayers: runtime.lobby?.maxPlayers || 10,
            metadata: runtime.lobby?.metadata || null,
        }));
        updateTrayTooltip();
        return runtime;
    })();

    try {
        return await signalingStartPromise;
    } finally {
        signalingStartPromise = null;
        if (signalingDiagnostics.state === 'starting') {
            signalingDiagnostics.state = signalingRuntime ? 'running' : 'stopped';
            updateTrayTooltip();
        }
    }
}

function closeNodeServer(server, timeoutMs = 3000) {
    return new Promise((resolve) => {
        if (!server || server.listening !== true) {
            resolve();
            return;
        }
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            resolve();
        };
        const timeoutId = setTimeout(finish, timeoutMs);
        try {
            server.close(() => finish());
        } catch {
            finish();
        }
    });
}

async function stopSignalingServer() {
    if (signalingStopPromise) {
        await signalingStopPromise;
        return;
    }

    signalingDiagnostics.state = 'stopping';
    updateTrayTooltip();

    signalingStopPromise = (async () => {
        if (signalingStartPromise) {
            try {
                await signalingStartPromise;
            } catch {
                // Failed starts should still allow cleanup and state reset.
            }
        }
        if (!signalingRuntime) {
            signalingDiagnostics.state = 'stopped';
            signalingDiagnostics.selectedPort = null;
            signalingDiagnostics.selectedPortMode = null;
            signalingDiagnostics.lastStoppedAt = Date.now();
            updateTrayTooltip();
            return;
        }

        const runtime = signalingRuntime;
        signalingRuntime = null;
        stopBroadcast();
        updateTrayTooltip();
        await closeNodeServer(runtime.server);
        signalingDiagnostics.state = 'stopped';
        signalingDiagnostics.selectedPort = null;
        signalingDiagnostics.selectedPortMode = null;
        signalingDiagnostics.lastStoppedAt = Date.now();
        updateTrayTooltip();
    })();

    try {
        await signalingStopPromise;
    } finally {
        signalingStopPromise = null;
    }
}

async function startAppServer() {
    if (staticAppServer) return staticAppServer;
    const distDir = path.join(__dirname, '..', DESKTOP_RENDERER_DIST_DIR_NAME);
    const distIndexPath = path.join(distDir, 'index.html');
    if (!existsSync(distIndexPath)) {
        const legacyDistDir = path.join(__dirname, '..', LEGACY_RENDERER_DIST_DIR_NAME);
        const legacyDistIndexPath = path.join(legacyDistDir, 'index.html');
        const legacyHint = existsSync(legacyDistIndexPath)
            ? ` Legacy web build detected at "${legacyDistDir}" - rebuild desktop explicitly.`
            : '';
        throw new Error(
            `Desktop renderer build missing at "${distIndexPath}". Run "npm run build:app" before starting Electron.${legacyHint}`
        );
    }
    const preferredPortRaw = Number(process.env.CURVIOS_DESKTOP_STATIC_PORT);
    const preferredPort = Number.isInteger(preferredPortRaw)
        && preferredPortRaw > 0
        && preferredPortRaw <= 65535
        ? preferredPortRaw
        : DESKTOP_STATIC_SERVER_DEFAULT_PORT;
    try {
        staticAppServer = await startStaticServer({ rootDir: distDir, port: preferredPort });
    } catch (error) {
        if (error?.code !== 'EADDRINUSE') {
            throw error;
        }
        // Fallback keeps app start resilient if the preferred port is occupied.
        staticAppServer = await startStaticServer({ rootDir: distDir, port: 0 });
    }
    return staticAppServer;
}

async function stopAppServer() {
    if (!staticAppServer) return;
    const server = staticAppServer;
    staticAppServer = null;
    await server.close();
}

async function createWindow() {
    const appServer = await startAppServer();
    const shouldShowWindow = String(process.env.CURVIOS_ELECTRON_SHOW_WINDOW || '').trim() !== '0';
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        title: 'CurviosClash',
        backgroundColor: '#050510',
        show: shouldShowWindow,
        webPreferences: createSecureWindowWebPreferences({
            preload: path.join(__dirname, 'preload.cjs'),
            backgroundThrottling: false,
        }),
    });

    mainWindow.webContents.on('will-navigate', (event) => {
        event.preventDefault();
    });
    installEditorDownloadTarget(session.defaultSession, {
        isTrustedEditorUrl: (url) => isTrustedEditorUrl(url, appServer.url),
        getDownloadsDirectory: () => app.getPath('downloads'),
    });
    mainWindow.webContents.setWindowOpenHandler(createEditorWindowOpenHandler(appServer.url, {
        editorPreloadPath: path.join(__dirname, 'editor-preload.cjs'),
    }));
    mainWindow.webContents.on('did-create-window', (editorWindow, details) => {
        editorWindows.add(editorWindow);
        editorWindow.on('closed', () => editorWindows.delete(editorWindow));
        const isMapEditor = new URL(details.url).pathname === '/editor/map-editor-3d.html';
        editorWindow.webContents.setWindowOpenHandler(isMapEditor
            ? createPlaytestWindowOpenHandler(appServer.url)
            : () => ({ action: 'deny' }));
        editorWindow.webContents.on('did-create-window', (playtestWindow) => {
            playtestWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        });
    });
    await mainWindow.loadURL(appServer.url);
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // ── Graceful-close handshake ──────────────────────────────────────────────
    // Before destroying the window, ask the renderer to run its own lifecycle
    // teardown (facade.dispose → GAME_DISPOSE finalize → MATCH_FINALIZED signal
    // to any connected multiplayer peers).  A GRACEFUL_CLOSE_TIMEOUT_MS timeout
    // ensures the window always closes even if the renderer is unresponsive.
    let gracefulCloseReady = false;
    let exportCloseDecisionPending = false;
    let exportCloseApproved = false;
    mainWindow.on('close', (event) => {
        if (gracefulCloseReady) return;
        event.preventDefault();
        if (cinematicReplayVideoExportJob?.getStatus?.().active === true && !exportCloseApproved) {
            if (exportCloseDecisionPending) return;
            exportCloseDecisionPending = true;
            void dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: 'Videoexport laeuft',
                message: 'Ein Cinematic Replay wird noch als MP4 exportiert.',
                detail: 'Du kannst den Export sauber abwarten, kontrolliert abbrechen oder zur Anwendung zurueckkehren.',
                buttons: ['Export abwarten', 'Export abbrechen', 'Zurueck'],
                defaultId: 0,
                cancelId: 2,
                noLink: true,
            }).then(async (result) => {
                exportCloseDecisionPending = false;
                if (result.response === 2) return;
                exportCloseApproved = true;
                if (result.response === 1) {
                    await cinematicReplayVideoExportJob.cancel({
                        reason: 'application_close_confirmed',
                    });
                }
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
            }).catch(() => {
                exportCloseDecisionPending = false;
            });
            return;
        }

        const onGracefulCloseReady = (ipcEvent) => {
            if (!isTrustedMainWindowSender(ipcEvent)) return;
            if (timeoutId !== null) clearTimeout(timeoutId);
            finish();
        };
        const finish = () => {
            if (gracefulCloseReady) return;
            gracefulCloseReady = true;
            ipcMain.removeListener('graceful-close-ready', onGracefulCloseReady);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.close();
            }
        };

        const timeoutId = exportCloseApproved
            ? null
            : setTimeout(finish, GRACEFUL_CLOSE_TIMEOUT_MS);
        ipcMain.on('graceful-close-ready', onGracefulCloseReady);

        try {
            mainWindow.webContents.send('request-graceful-close');
        } catch {
            // Renderer already gone — proceed immediately.
            if (timeoutId !== null) clearTimeout(timeoutId);
            finish();
        }
    });
}

function createDesktopWindowShellCapability() {
    return Object.freeze({
        contractName: 'desktop-window-shell',
        contractVersion: WINDOW_SHELL_CONTRACT_VERSION,
        async start() {
            if (mainWindow && !mainWindow.isDestroyed()) {
                return mainWindow;
            }
            await createWindow();
            return mainWindow;
        },
        focus() {
            if (!mainWindow || mainWindow.isDestroyed()) {
                return false;
            }
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.focus();
            return true;
        },
        getWindow() {
            return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        },
    });
}

function createLanHostShellCapability() {
    return Object.freeze({
        contractName: 'lan-host-shell',
        contractVersion: HOST_SHELL_CONTRACT_VERSION,
        getStatus() {
            return getSignalingDiagnosticsSnapshot();
        },
        async start() {
            await startSignalingServer();
            return getSignalingDiagnosticsSnapshot();
        },
        async stop() {
            await stopSignalingServer();
            return getSignalingDiagnosticsSnapshot();
        },
    });
}

function resolveTuningConsoleCapabilityState() {
    const desktopSurfaceAvailable = hasSingleInstanceLock === true;
    const available = desktopSurfaceAvailable;
    return Object.freeze({
        contractVersion: TUNING_CONSOLE_CAPABILITY_CONTRACT_VERSION,
        capabilityId: TUNING_CONSOLE_CAPABILITY_ID,
        available,
        accessMode: available ? 'desktop-capability' : 'blocked',
        reason: available ? 'desktop_surface_enabled' : 'desktop_surface_unavailable',
        message: available
            ? 'Tuning Console ist als Desktop-Capability verfuegbar; Expertenpasswort bleibt nur lokale UX-Grenze.'
            : 'Tuning Console ist fuer diese Surface nicht verfuegbar.',
        passwordGate: 'local-ux-only',
    });
}

function resolveSharedMenuDefaultsOverrideFilePath() {
    return path.join(
        resolveAppDataRoot(app),
        SHARED_USER_DATA_DIR_NAME,
        MENU_DEFAULTS_OVERRIDE_FILE_NAME
    );
}

async function handleRecordingVideoExport(payload = null) {
    return recordingVideoExportJob.handle(payload);
}

function listLegacyMenuDefaultsOverrideSourcePaths(targetFilePath) {
    const candidatePaths = [
        path.join(app.getPath('userData'), MENU_DEFAULTS_OVERRIDE_FILE_NAME),
        path.join(
            resolveAppDataRoot(app),
            LEGACY_ELECTRON_USER_DATA_DIR_NAME,
            MENU_DEFAULTS_OVERRIDE_FILE_NAME
        ),
    ];

    return Array.from(new Set(
        candidatePaths.filter((candidatePath) => candidatePath && candidatePath !== targetFilePath)
    ));
}

function migrateLegacyMenuDefaultsOverrideIfNeeded(targetFilePath) {
    if (!targetFilePath || existsSync(targetFilePath)) {
        return;
    }

    for (const sourceFilePath of listLegacyMenuDefaultsOverrideSourcePaths(targetFilePath)) {
        if (!existsSync(sourceFilePath)) {
            continue;
        }

        mkdirSync(path.dirname(targetFilePath), { recursive: true });
        copyFileSync(sourceFilePath, targetFilePath);
        return;
    }
}

function readMenuDefaultsOverrideSnapshotSync() {
    const filePath = resolveSharedMenuDefaultsOverrideFilePath();
    migrateLegacyMenuDefaultsOverrideIfNeeded(filePath);
    let exists = false;
    let draft = null;
    let readError = null;
    let parseError = null;

    try {
        const raw = readFileSync(filePath, 'utf-8');
        exists = true;
        if (raw.trim()) {
            try {
                const parsed = JSON.parse(raw);
                draft = parsed && typeof parsed === 'object' ? parsed : null;
            } catch (error) {
                parseError = error instanceof Error ? error.message : String(error || 'override_parse_failed');
            }
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            readError = error instanceof Error ? error.message : String(error || 'override_read_failed');
        }
    }

    return {
        contractVersion: SETTINGS_DEFAULTS_CONTRACT_VERSION,
        filePath,
        exists,
        loadedAt: Date.now(),
        readError,
        parseError,
        draft,
        menuTextOverrides: readMenuTextOverridesSnapshotSync(),
    };
}

function readMenuTextOverridesSnapshotSync() {
    const filePath = path.join(
        resolveAppDataRoot(app),
        SHARED_USER_DATA_DIR_NAME,
        MENU_TEXT_OVERRIDES_FILE_NAME
    );
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        return {
            exists: true,
            filePath,
            schemaVersion: String(parsed?.schemaVersion || ''),
            overrides: parsed?.overrides && typeof parsed.overrides === 'object' && !Array.isArray(parsed.overrides)
                ? parsed.overrides
                : {},
        };
    } catch (error) {
        return {
            exists: error?.code !== 'ENOENT',
            filePath,
            schemaVersion: 'menu-text-overrides.v1',
            overrides: {},
        };
    }
}

const desktopWindowShellCapability = createDesktopWindowShellCapability();
const hangarWindowShellCapability = createHangarWindowController({
    BrowserWindow,
    dialog,
    resolveParentWindow: () => desktopWindowShellCapability.getWindow(),
    resolveWindowUrl: async (options = {}) => {
        const appServer = await startAppServer();
        const mode = String(options.mode || '').trim().toLowerCase() === 'fight' ? 'fight' : 'arcade';
        return new URL(`hangar.html?mode=${mode}`, appServer.url).href;
    },
});
const lanHostShellCapability = createLanHostShellCapability();
const tuningWindowShellCapability = createTuningWindowController({
    BrowserWindow,
    resolveParentWindow: () => desktopWindowShellCapability.getWindow(),
    resolveCapabilityState: () => resolveTuningConsoleCapabilityState(),
});
const recordingVideoExportJob = createRecordingVideoExportJob({
    app,
    dialog,
    resolveWindow: () => desktopWindowShellCapability.getWindow(),
    contractVersion: RECORDING_VIDEO_EXPORT_REQUEST_CONTRACT_VERSION,
    capabilityId: RECORDING_VIDEO_EXPORT_CAPABILITY_ID,
});
const cinematicReplayVideoExportJob = createCinematicReplayVideoExportJob({
    app,
    dialog,
    resolveWindow: () => desktopWindowShellCapability.getWindow(),
});

async function offerOrphanedCinematicReplayExports() {
    const orphans = await cinematicReplayVideoExportJob.listOrphans();
    if (orphans.length <= 0) return;
    const result = await dialog.showMessageBox(desktopWindowShellCapability.getWindow(), {
        type: 'warning',
        title: 'Unvollstaendige Videoexporte gefunden',
        message: `${orphans.length} verwaiste Cinematic-Exportdatei(en) wurden erkannt.`,
        detail: 'Die Dateien werden nicht automatisch geloescht. Du kannst sie fuer eine spaetere Wiederherstellung behalten oder jetzt bestaetigt bereinigen.',
        buttons: ['Wiederherstellen', 'Behalten', 'Bestaetigt bereinigen'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
    });
    if (result.response === 0) {
        const recovery = await cinematicReplayVideoExportJob.recoverOrphans(orphans);
        await dialog.showMessageBox(desktopWindowShellCapability.getWindow(), {
            type: recovery.failed > 0 ? 'warning' : 'info',
            title: 'Cinematic Exporte wiederhergestellt',
            message: `${recovery.recovered} Export(e) wiederhergestellt, ${recovery.failed} nicht wiederhergestellt.`,
            buttons: ['OK'],
        });
    } else if (result.response === 2) {
        await cinematicReplayVideoExportJob.cleanupOrphans(orphans);
    }
}

function registerTuningShortcut() {
    globalShortcut.unregister(TUNING_CONSOLE_HOTKEY);
    const registered = globalShortcut.register(TUNING_CONSOLE_HOTKEY, () => {
        void tuningWindowShellCapability.toggleTuningWindow({ focus: true });
    });
    if (!registered) {
        console.warn(`[tuning] Hotkey ${TUNING_CONSOLE_HOTKEY} konnte nicht registriert werden.`);
    }
    return registered;
}

function unregisterTuningShortcut() {
    globalShortcut.unregister(TUNING_CONSOLE_HOTKEY);
}

function registerTuningBridgeIpc() {
    if (disposeTuningIpc) {
        return;
    }
    disposeTuningIpc = registerTuningIpc({
        ipcMain,
        dialog,
        resolveGameWindow: () => desktopWindowShellCapability.getWindow(),
        resolveTuningWindow: () => tuningWindowShellCapability.getWindow(),
        resolveCapabilityState: () => resolveTuningConsoleCapabilityState(),
    });
}

function disposeTuningBridgeIpc() {
    if (!disposeTuningIpc) {
        return;
    }
    disposeTuningIpc();
    disposeTuningIpc = null;
}

async function startDesktopShell() {
    registerTuningBridgeIpc();
    await desktopWindowShellCapability.start();
    createTray();
    registerTuningShortcut();
}

const DISCOVERY_RATE_LIMIT_MS = 500;
const DISCOVERY_RATE_LIMIT_MAX_SOURCES = 64;
const discoveryRateMap = new Map();

function normalizeDiscoveryPort(value) {
    const port = Number(value);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
}

function buildDiscoveryHostKey(host) {
    return `${String(host?.ip || '').trim()}::${String(host?.lobbyCode || '').trim().toUpperCase()}`;
}

function sortDiscoveredHosts(left, right) {
    const leftLastSeen = Number(left?.lastSeen || 0);
    const rightLastSeen = Number(right?.lastSeen || 0);
    if (leftLastSeen !== rightLastSeen) {
        return rightLastSeen - leftLastSeen;
    }
    const leftLobbyCode = String(left?.lobbyCode || '').trim().toUpperCase();
    const rightLobbyCode = String(right?.lobbyCode || '').trim().toUpperCase();
    if (leftLobbyCode !== rightLobbyCode) {
        return leftLobbyCode.localeCompare(rightLobbyCode);
    }
    const leftIp = String(left?.ip || '').trim();
    const rightIp = String(right?.ip || '').trim();
    if (leftIp !== rightIp) {
        return leftIp.localeCompare(rightIp);
    }
    return normalizeDiscoveryPort(left?.port) - normalizeDiscoveryPort(right?.port);
}

function listDiscoveredHosts() {
    return Array.from(discoveredHosts.values()).sort(sortDiscoveredHosts);
}

function stopDiscoveryListener() {
    if (discoverySocket) {
        try {
            discoverySocket.close();
        } catch {
            // Ignore close errors during shutdown.
        }
        discoverySocket = null;
    }
    discoveredHosts.clear();
    discoveryRateMap.clear();
}

function isDiscoveryRateLimited(sourceKey) {
    const now = Date.now();
    const lastSeen = discoveryRateMap.get(sourceKey);
    if (lastSeen && (now - lastSeen) < DISCOVERY_RATE_LIMIT_MS) {
        return true;
    }
    if (discoveryRateMap.size >= DISCOVERY_RATE_LIMIT_MAX_SOURCES && !discoveryRateMap.has(sourceKey)) {
        return true;
    }
    discoveryRateMap.set(sourceKey, now);
    return false;
}

function startDiscoveryListener() {
    stopDiscoveryListener();
    discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    discoverySocket.on('error', (err) => { console.error('[discovery] UDP socket error:', err.message); });
    discoverySocket.on('message', (msgBuf, rinfo) => {
        try {
            const sourceKey = `${rinfo.address}:${rinfo.port}`;
            if (isDiscoveryRateLimited(sourceKey)) return;

            const data = JSON.parse(msgBuf.toString());
            if (data.magic !== DISCOVERY_MAGIC) return;

            const ip = String(data.ip || '').trim();
            const lobbyCode = String(data.lobbyCode || '').trim().toUpperCase();
            const port = normalizeDiscoveryPort(data.port);
            if (!ip || !lobbyCode || port <= 0) return;

            const hostRecord = {
                ip,
                port,
                lobbyCode,
                hostName: String(data.hostName || '').trim(),
                playerCount: Math.max(0, Math.floor(Number(data.playerCount) || 0)),
                maxPlayers: Math.max(2, Math.floor(Number(data.maxPlayers) || 10)),
                mapKey: String(data.mapKey || '').trim(),
                gameMode: String(data.gameMode || '').trim(),
                modePath: String(data.modePath || '').trim(),
                winsNeeded: Math.max(1, Math.floor(Number(data.winsNeeded) || 5)),
                lastSeen: Date.now(),
            };
            discoveredHosts.set(buildDiscoveryHostKey(hostRecord), hostRecord);

            const now = Date.now();
            for (const [hostKey, hostState] of discoveredHosts) {
                if (now - hostState.lastSeen > 10_000) {
                    discoveredHosts.delete(hostKey);
                }
            }

            const windowRef = desktopWindowShellCapability.getWindow();
            if (windowRef) {
                windowRef.webContents.send('discovered-hosts', listDiscoveredHosts());
            }
        } catch {
            // Ignore malformed discovery packets.
        }
    });
    discoverySocket.bind(DISCOVERY_PORT, '0.0.0.0');
}

const editorVehicleStore = createEditorVehicleStore({
    getVehiclesDirectory: () => path.join(app.getPath('userData'), 'vehicles'),
});

const EDITOR_DISK_HANDLERS = Object.freeze({
    'save-vehicle': (payload) => editorVehicleStore.saveVehicle(payload),
    'list-vehicles': () => editorVehicleStore.listVehicles(),
    'get-vehicle': (payload) => editorVehicleStore.getVehicle(payload),
    'rename-vehicle': (payload) => editorVehicleStore.renameVehicle(payload),
    'delete-vehicle': (payload) => editorVehicleStore.deleteVehicle(payload),
});

// Ein Kanal fuer alle Dateizugriffe der Autorenwerkzeuge. Die Aktion wird
// gegen die feste Liste oben geprueft, damit ein unbekannter Befehl nicht
// durchrutscht.
ipcMain.handle('editor-disk:request', withTrustedEditorWindowSender((request = {}) => {
    const handler = EDITOR_DISK_HANDLERS[String(request?.action || '')];
    if (!handler) return { ok: false, error: 'unknown_action' };
    try {
        return handler(request?.payload || {});
    } catch (error) {
        return { ok: false, error: String(error?.message || error) };
    }
}));

ipcMain.handle('get-lan-server-status', withTrustedMainWindowSender(
    () => lanHostShellCapability.getStatus()
));

ipcMain.handle('hangar-window:open', withTrustedMainWindowSender(async (options = {}) => {
    const result = await hangarWindowShellCapability.openHangarWindow({
        mode: options?.mode,
        focus: options?.focus !== false,
    });
    return { ok: result.ok === true, reused: result.reused === true };
}));

ipcMain.handle('hangar-window:get-status', withTrustedMainWindowSender(() => (
    hangarWindowShellCapability.getStatus()
)));

ipcMain.handle('hangar-window:close-from-main', withTrustedMainWindowSender(() => ({
    ok: hangarWindowShellCapability.closeHangarWindow(),
})));

ipcMain.handle('hangar-window:close', withTrustedHangarWindowSender(() => ({
    ok: hangarWindowShellCapability.closeHangarWindow(),
})));

ipcMain.handle('hangar-window:set-unsaved-changes', withTrustedHangarWindowSender((value) => ({
    ok: hangarWindowShellCapability.setUnsavedChanges(value === true),
})));

ipcMain.handle('start-lan-server', withTrustedMainWindowSender(
    () => lanHostShellCapability.start()
));

ipcMain.handle('stop-lan-server', withTrustedMainWindowSender(
    () => lanHostShellCapability.stop()
));

ipcMain.handle('start-discovery', withTrustedMainWindowSender(() => {
    startDiscoveryListener();
    return { listening: true };
}));

ipcMain.handle('stop-discovery', withTrustedMainWindowSender(() => {
    stopDiscoveryListener();
    return { listening: false };
}));

ipcMain.handle('get-discovered-hosts', withTrustedMainWindowSender(
    () => listDiscoveredHosts()
));

ipcMain.handle('save-replay', withTrustedMainWindowSender(async (jsonString, defaultName) => {
    try {
        const result = await dialog.showSaveDialog(desktopWindowShellCapability.getWindow(), {
            title: 'Replay speichern',
            defaultPath: defaultName || 'replay.json',
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });

        if (!result.canceled && result.filePath) {
            writeFileSync(result.filePath, jsonString, 'utf-8');
            return true;
        }
    } catch {
        // Surface failure as a boolean for the renderer.
    }

    return false;
}));

ipcMain.handle('save-recording-video-export', withTrustedMainWindowSender(async (payload) => (
    handleRecordingVideoExport(payload)
)));

ipcMain.handle('get-recording-video-export-capability', withTrustedMainWindowSender(async (options = null) => (
    recordingVideoExportJob.getCapabilityStatus(options)
)));

ipcMain.handle('cinematic-replay-export:begin', withTrustedMainWindowSender(async (payload = null) => (
    cinematicReplayVideoExportJob.begin(payload)
)));

ipcMain.handle('cinematic-replay-export:append-frame', withTrustedMainWindowSender(async (payload = null) => (
    cinematicReplayVideoExportJob.appendFrame(payload)
)));

ipcMain.handle('cinematic-replay-export:finish', withTrustedMainWindowSender(async (payload = null) => (
    cinematicReplayVideoExportJob.finish(payload)
)));

ipcMain.handle('cinematic-replay-export:cancel', withTrustedMainWindowSender(async (payload = null) => (
    cinematicReplayVideoExportJob.cancel(payload)
)));

ipcMain.handle('cinematic-replay-export:status', withTrustedMainWindowSender(() => (
    cinematicReplayVideoExportJob.getStatus()
)));

ipcMain.handle('cinematic-replay-export:list-orphans', withTrustedMainWindowSender(() => (
    cinematicReplayVideoExportJob.listOrphans()
)));

ipcMain.handle('save-video', withTrustedMainWindowSender(async (videoBytes, defaultName, mimeType) => (
    handleRecordingVideoExport({
        contractVersion: RECORDING_VIDEO_EXPORT_REQUEST_CONTRACT_VERSION,
        capabilityId: RECORDING_VIDEO_EXPORT_CAPABILITY_ID,
        videoBytes,
        fileName: defaultName,
        mimeType,
    })
)));

ipcMain.on('settings-defaults:read-override-sync', (event) => {
    if (!isTrustedMainWindowSender(event)) {
        event.returnValue = null;
        return;
    }
    event.returnValue = readMenuDefaultsOverrideSnapshotSync();
});

ipcMain.handle('settings-defaults:read-override', withTrustedMainWindowSender(async () => {
    return readMenuDefaultsOverrideSnapshotSync();
}));

async function shutdownRuntime() {
    stopDiscoveryListener();
    unregisterTuningShortcut();
    tuningWindowShellCapability.closeTuningWindow();
    hangarWindowShellCapability.closeHangarWindow();
    disposeTuningBridgeIpc();
    await Promise.allSettled([
        lanHostShellCapability.stop(),
        stopAppServer(),
    ]);

    if (tray) {
        tray.destroy();
        tray = null;
    }
}

app.whenReady().then(async () => {
    if (!hasSingleInstanceLock) {
        return;
    }
    try {
        await startDesktopShell();
        await offerOrphanedCinematicReplayExports();
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unbekannter Startfehler';
        dialog.showErrorBox('CurviosClash Startfehler', message);
        await shutdownRuntime();
        app.quit();
    }
});

app.on('second-instance', () => {
    desktopWindowShellCapability.focus();
});

app.on('window-all-closed', () => {
    void shutdownRuntime().finally(() => {
        app.quit();
    });
});

app.on('before-quit', () => {
    markSessionExitClean();
    stopDiscoveryListener();
    stopBroadcast();
    unregisterTuningShortcut();
    tuningWindowShellCapability.closeTuningWindow();
    hangarWindowShellCapability.closeHangarWindow();
    disposeTuningBridgeIpc();
});

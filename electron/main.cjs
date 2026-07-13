// ============================================
// electron/main.cjs - Electron main process
// ============================================

const { app, BrowserWindow, ipcMain, dialog, Tray, nativeImage, globalShortcut } = require('electron');
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
} = require('./session-data-runtime.cjs');
const { createRecordingVideoExportJob } = require('./recording-video-export-job.cjs');
const { createTuningWindowController } = require('./tuning-window.cjs');
const { registerTuningIpc } = require('./tuning-ipc.cjs');

let mainWindow = null;
let tray = null;
let signalingRuntime = null;
let staticAppServer = null;
let signalingStartPromise = null;
let signalingStopPromise = null;
let disposeTuningIpc = null;

const SIGNALING_PORTS = [9090, 9091, 9093, 9094];
const GRACEFUL_CLOSE_TIMEOUT_MS = 3000;
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
app.setAppUserModelId('de.curviosclash.main');
const hasSingleInstanceLock = app.requestSingleInstanceLock();
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
const SHARED_USER_DATA_DIR_NAME = 'curviosclash-app';
const MAIN_SESSION_DATA_DIR_NAME = 'session-main';
const LEGACY_ELECTRON_USER_DATA_DIR_NAME = 'Electron';
let markSessionExitClean = () => {};

if (!hasSingleInstanceLock) {
    app.quit();
} else {
    const { sessionDataPath } = configureStoragePaths({
        app,
        sharedUserDataDirName: SHARED_USER_DATA_DIR_NAME,
        sessionDataDirName: MAIN_SESSION_DATA_DIR_NAME,
    });
    const sessionSelfHealState = initSessionDataSelfHeal({
        sessionDataPath,
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

            const broadcastIps = ips.length > 0 ? ips : ['127.0.0.1'];
            for (const ip of broadcastIps) {
                const payload = JSON.stringify({
                    magic: DISCOVERY_MAGIC,
                    ip,
                    port: signalingPort,
                    lobbyCode,
                    hostName,
                    playerCount: Number(state?.playerCount || 0),
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
            playerCount: runtime.lobby?.players?.length || 0,
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
        show: shouldShowWindow,
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
        },
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
    mainWindow.on('close', (event) => {
        if (gracefulCloseReady) return;
        event.preventDefault();

        const finish = () => {
            if (gracefulCloseReady) return;
            gracefulCloseReady = true;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.close();
            }
        };

        const timeoutId = setTimeout(finish, GRACEFUL_CLOSE_TIMEOUT_MS);
        ipcMain.once('graceful-close-ready', () => {
            clearTimeout(timeoutId);
            finish();
        });

        try {
            mainWindow.webContents.send('request-graceful-close');
        } catch {
            // Renderer already gone — proceed immediately.
            clearTimeout(timeoutId);
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
        app.getPath('appData'),
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
            app.getPath('appData'),
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
    };
}

const desktopWindowShellCapability = createDesktopWindowShellCapability();
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

ipcMain.handle('get-lan-server-status', () => lanHostShellCapability.getStatus());

ipcMain.handle('start-lan-server', () => lanHostShellCapability.start());

ipcMain.handle('stop-lan-server', () => lanHostShellCapability.stop());

ipcMain.handle('start-discovery', () => {
    startDiscoveryListener();
    return { listening: true };
});

ipcMain.handle('stop-discovery', () => {
    stopDiscoveryListener();
    return { listening: false };
});

ipcMain.handle('get-discovered-hosts', () => listDiscoveredHosts());

ipcMain.handle('save-replay', async (_event, jsonString, defaultName) => {
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
});

ipcMain.handle('save-recording-video-export', async (_event, payload) => (
    handleRecordingVideoExport(payload)
));

ipcMain.handle('get-recording-video-export-capability', async (_event, options = null) => (
    recordingVideoExportJob.getCapabilityStatus(options)
));

ipcMain.handle('save-video', async (_event, videoBytes, defaultName, mimeType) => (
    handleRecordingVideoExport({
        contractVersion: RECORDING_VIDEO_EXPORT_REQUEST_CONTRACT_VERSION,
        capabilityId: RECORDING_VIDEO_EXPORT_CAPABILITY_ID,
        videoBytes,
        fileName: defaultName,
        mimeType,
    })
));

ipcMain.on('settings-defaults:read-override-sync', (event) => {
    event.returnValue = readMenuDefaultsOverrideSnapshotSync();
});

ipcMain.handle('settings-defaults:read-override', async () => {
    return readMenuDefaultsOverrideSnapshotSync();
});

async function shutdownRuntime() {
    stopDiscoveryListener();
    unregisterTuningShortcut();
    tuningWindowShellCapability.closeTuningWindow();
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
    disposeTuningBridgeIpc();
});

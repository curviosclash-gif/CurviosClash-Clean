// ============================================
// electron/preload.cjs - IPC bridge to renderer
// ============================================

const { contextBridge, ipcRenderer } = require('electron');

const PRELOAD_CONTRACT_VERSIONS = Object.freeze({
    discovery: 'preload.discovery.v1',
    host: 'preload.host.v1',
    save: 'preload.save.v2',
    recording: 'preload.recording.v1',
    lifecycle: 'preload.lifecycle.v1',
    settingsDefaults: 'preload.settings-defaults.v1',
    tuningRuntime: 'preload.tuning-runtime.v1',
    hangar: 'preload.hangar-window.v1',
    localMaps: 'preload.local-maps.v1',
});
const PLATFORM_CAPABILITY_SNAPSHOT_CONTRACT_VERSION = 'platform-capability-snapshot.v1';
const RECORDING_VIDEO_EXPORT_REQUEST_CONTRACT_VERSION = 'recording-video-export-request.v1';
const TUNING_RUNTIME_REQUEST_CHANNEL = 'tuning-runtime:request';
const TUNING_RUNTIME_RESPONSE_CHANNEL = 'tuning-runtime:response';

function createInvokeBridge(channel) {
    return (...args) => ipcRenderer.invoke(channel, ...args);
}

function createNamedContract(contractName, contractVersion, surface) {
    return Object.freeze({
        contractName,
        contractVersion,
        ...surface,
    });
}

function deepCloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function createCapabilityDescriptor(capabilityId, contractVersion, providerKind, available, extra) {
    return Object.freeze({
        capabilityId,
        available: available === true,
        providerKind,
        contractVersion,
        degradedReason: '',
        supportsSubscribe: extra?.supportsSubscribe === true,
        supportsSessionOwnership: extra?.supportsSessionOwnership === true,
        supportsBinaryExport: extra?.supportsBinaryExport === true,
        supportsCapture: extra?.supportsCapture === true,
    });
}

function createDiscoveryContract() {
    return createNamedContract('discovery', PRELOAD_CONTRACT_VERSIONS.discovery, {
        start: createInvokeBridge('start-discovery'),
        stop: createInvokeBridge('stop-discovery'),
        listHosts: createInvokeBridge('get-discovered-hosts'),
        subscribeHosts: (callback) => {
            if (typeof callback !== 'function') {
                return () => {};
            }
            const handler = (_event, hosts) => callback(hosts);
            ipcRenderer.on('discovered-hosts', handler);
            return () => ipcRenderer.removeListener('discovered-hosts', handler);
        },
    });
}

function createHostContract() {
    return createNamedContract('host', PRELOAD_CONTRACT_VERSIONS.host, {
        getStatus: createInvokeBridge('get-lan-server-status'),
        start: createInvokeBridge('start-lan-server'),
        stop: createInvokeBridge('stop-lan-server'),
    });
}

function createSaveContract() {
    const saveRecordingVideoExport = createInvokeBridge('save-recording-video-export');
    const getRecordingVideoExportCapability = createInvokeBridge('get-recording-video-export-capability');
    const beginCinematicReplayExport = createInvokeBridge('cinematic-replay-export:begin');
    const appendCinematicReplayFrame = createInvokeBridge('cinematic-replay-export:append-frame');
    const finishCinematicReplayExport = createInvokeBridge('cinematic-replay-export:finish');
    const cancelCinematicReplayExport = createInvokeBridge('cinematic-replay-export:cancel');
    const getCinematicReplayExportStatus = createInvokeBridge('cinematic-replay-export:status');
    const listCinematicReplayExportOrphans = createInvokeBridge('cinematic-replay-export:list-orphans');
    return createNamedContract('save', PRELOAD_CONTRACT_VERSIONS.save, {
        saveReplay: createInvokeBridge('save-replay'),
        saveVideo: (videoBytes, defaultName, mimeType) => saveRecordingVideoExport({
            contractVersion: RECORDING_VIDEO_EXPORT_REQUEST_CONTRACT_VERSION,
            capabilityId: 'recording-video-export-save',
            videoBytes,
            fileName: defaultName,
            mimeType,
            runtimeKind: 'desktop',
            exportPreset: 'youtube-mp4',
            masterContainer: 'webm',
            deliveryContainer: 'mp4',
            transcodeApplied: false,
        }),
        getRecordingVideoExportCapability,
        saveRecordingVideoExport,
        beginCinematicReplayExport,
        appendCinematicReplayFrame,
        finishCinematicReplayExport,
        cancelCinematicReplayExport,
        getCinematicReplayExportStatus,
        listCinematicReplayExportOrphans,
    });
}

function createRecordingContract() {
    return createNamedContract('recording', PRELOAD_CONTRACT_VERSIONS.recording, {
        supportsCapture: true,
    });
}

function createHangarContract() {
    return createNamedContract('hangar', PRELOAD_CONTRACT_VERSIONS.hangar, {
        openWindow: createInvokeBridge('hangar-window:open'),
        getStatus: createInvokeBridge('hangar-window:get-status'),
        closeWindow: createInvokeBridge('hangar-window:close-from-main'),
    });
}

/**
 * Lifecycle capability contract — exposes the shell's graceful-close handshake.
 *
 * The main process sends 'request-graceful-close' before destroying the window.
 * The renderer calls onGracefulClose(cb) to receive the notification, runs its
 * own dispose/finalize sequence (e.g. facade.dispose()), and then calls
 * confirmGracefulClose() to allow the window to proceed with closing.
 */
function createLifecycleContract() {
    return createNamedContract('lifecycle', PRELOAD_CONTRACT_VERSIONS.lifecycle, {
        /**
         * Register a callback fired when the shell requests a graceful close.
         * The callback may be async; call confirmGracefulClose() once the
         * renderer-side lifecycle teardown is complete.
         *
         * @param {() => void | Promise<void>} callback
         * @returns {() => void} unsubscribe function
         */
        onGracefulClose: (callback) => {
            if (typeof callback !== 'function') return () => {};
            const handler = () => callback();
            ipcRenderer.on('request-graceful-close', handler);
            return () => ipcRenderer.removeListener('request-graceful-close', handler);
        },
        /** Signal to the main process that the renderer is ready to be destroyed. */
        confirmGracefulClose: () => ipcRenderer.send('graceful-close-ready'),
    });
}

let cachedOverrideSnapshot = null;

// Start fetching the snapshot immediately in the background
ipcRenderer.invoke('settings-defaults:read-override').then((snapshot) => {
    if (snapshot && typeof snapshot === 'object') {
        cachedOverrideSnapshot = snapshot;
    } else {
        cachedOverrideSnapshot = {
            contractVersion: PRELOAD_CONTRACT_VERSIONS.settingsDefaults,
            filePath: '',
            exists: false,
            loadedAt: Date.now(),
            readError: 'override_sync_unavailable',
            parseError: null,
            draft: null,
        };
    }
}).catch((error) => {
    cachedOverrideSnapshot = {
        contractVersion: PRELOAD_CONTRACT_VERSIONS.settingsDefaults,
        filePath: '',
        exists: false,
        loadedAt: Date.now(),
        readError: error instanceof Error ? error.message : String(error || 'override_sync_failed'),
        parseError: null,
        draft: null,
    };
});

function readMenuDefaultsOverrideSnapshot() {
    if (cachedOverrideSnapshot !== null) {
        return cachedOverrideSnapshot;
    }

    try {
        const snapshot = ipcRenderer.sendSync('settings-defaults:read-override-sync');
        if (snapshot && typeof snapshot === 'object') {
            cachedOverrideSnapshot = snapshot;
            return cachedOverrideSnapshot;
        }
    } catch (error) {
        cachedOverrideSnapshot = {
            contractVersion: PRELOAD_CONTRACT_VERSIONS.settingsDefaults,
            filePath: '',
            exists: false,
            loadedAt: Date.now(),
            readError: error instanceof Error ? error.message : String(error || 'override_sync_failed'),
            parseError: null,
            draft: null,
        };
        return cachedOverrideSnapshot;
    }

    cachedOverrideSnapshot = {
        contractVersion: PRELOAD_CONTRACT_VERSIONS.settingsDefaults,
        filePath: '',
        exists: false,
        loadedAt: Date.now(),
        readError: 'override_sync_unavailable',
        parseError: null,
        draft: null,
    };
    return cachedOverrideSnapshot;
}

let cachedLocalMapsSnapshot = null;

// Die Kartenliste des Spiels entsteht beim Laden der Module, also bevor ein
// asynchroner Aufruf zurueck waere. Deshalb einmal synchron fragen und merken.
function readLocalMapsSnapshot() {
    if (cachedLocalMapsSnapshot !== null) return cachedLocalMapsSnapshot;
    let maps = {};
    try {
        const snapshot = ipcRenderer.sendSync('local-maps:read-sync');
        if (snapshot?.ok === true && snapshot.maps && typeof snapshot.maps === 'object') maps = snapshot.maps;
    } catch {
        maps = {};
    }
    cachedLocalMapsSnapshot = maps;
    return cachedLocalMapsSnapshot;
}

function createLocalMapsContract() {
    return createNamedContract('localMaps', PRELOAD_CONTRACT_VERSIONS.localMaps, {
        getSnapshot: () => deepCloneJson(readLocalMapsSnapshot()),
        // Der Editor speichert in einem eigenen Fenster. Das Spiel fragt beim
        // Zurueckkehren ueber denselben Kanal neu, statt einen zweiten zu oeffnen.
        refresh: () => {
            cachedLocalMapsSnapshot = null;
            return deepCloneJson(readLocalMapsSnapshot());
        },
    });
}

function createSettingsDefaultsContract() {
    return createNamedContract('settingsDefaults', PRELOAD_CONTRACT_VERSIONS.settingsDefaults, {
        getOverrideSnapshot: () => deepCloneJson(readMenuDefaultsOverrideSnapshot()),
    });
}

function createTuningRuntimeContract() {
    let subscribed = false;
    return createNamedContract('tuningRuntime', PRELOAD_CONTRACT_VERSIONS.tuningRuntime, {
        preloadRequestChannel: TUNING_RUNTIME_REQUEST_CHANNEL,
        preloadResponseChannel: TUNING_RUNTIME_RESPONSE_CHANNEL,
        getStatus: () => ({
            available: true,
            loaded: subscribed,
        }),
        subscribeRequests: (callback) => {
            if (typeof callback !== 'function') return () => {};
            const handler = (_event, payload) => callback(payload);
            subscribed = true;
            ipcRenderer.on(TUNING_RUNTIME_REQUEST_CHANNEL, handler);
            return () => {
                ipcRenderer.removeListener(TUNING_RUNTIME_REQUEST_CHANNEL, handler);
                subscribed = false;
            };
        },
        sendResponse: (payload) => {
            if (!payload || typeof payload !== 'object') return;
            ipcRenderer.send(TUNING_RUNTIME_RESPONSE_CHANNEL, payload);
        },
    });
}

const discoveryContract = createDiscoveryContract();
const hostContract = createHostContract();
const saveContract = createSaveContract();
const recordingContract = createRecordingContract();
const lifecycleContract = createLifecycleContract();
const settingsDefaultsContract = createSettingsDefaultsContract();
const tuningRuntimeContract = createTuningRuntimeContract();
const hangarContract = createHangarContract();
const localMapsContract = createLocalMapsContract();
const platformContracts = Object.freeze({
    discovery: discoveryContract,
    host: hostContract,
    save: saveContract,
    recording: recordingContract,
    lifecycle: lifecycleContract,
    settingsDefaults: settingsDefaultsContract,
    tuningRuntime: tuningRuntimeContract,
    hangar: hangarContract,
    localMaps: localMapsContract,
});
const platformCapabilities = Object.freeze({
    contractVersion: PLATFORM_CAPABILITY_SNAPSHOT_CONTRACT_VERSION,
    runtimeKind: 'electron',
    discovery: createCapabilityDescriptor('discovery', discoveryContract.contractVersion, 'electron-ipc', true, {
        supportsSubscribe: true,
    }),
    host: createCapabilityDescriptor('host', hostContract.contractVersion, 'electron-ipc', true, {
        supportsSessionOwnership: true,
    }),
    save: createCapabilityDescriptor('save', saveContract.contractVersion, 'electron-ipc', true, {
        supportsBinaryExport: true,
    }),
    recording: createCapabilityDescriptor('recording', recordingContract.contractVersion, 'electron-renderer', true, {
        supportsCapture: true,
    }),
    lifecycle: createCapabilityDescriptor('lifecycle', lifecycleContract.contractVersion, 'electron-ipc', true),
});
const curviosApp = Object.freeze({
    contracts: platformContracts,
    capabilities: platformCapabilities,
    discovery: discoveryContract,
    host: hostContract,
    save: saveContract,
    recording: recordingContract,
    lifecycle: lifecycleContract,
    settingsDefaults: settingsDefaultsContract,
    tuningRuntime: tuningRuntimeContract,
    hangar: hangarContract,
    getLanServerStatus: hostContract.getStatus,
    startLanServer: hostContract.start,
    stopLanServer: hostContract.stop,
    saveReplay: saveContract.saveReplay,
    saveVideo: saveContract.saveVideo,
    getRecordingVideoExportCapability: saveContract.getRecordingVideoExportCapability,
    saveRecordingVideoExport: saveContract.saveRecordingVideoExport,
    beginCinematicReplayExport: saveContract.beginCinematicReplayExport,
    appendCinematicReplayFrame: saveContract.appendCinematicReplayFrame,
    finishCinematicReplayExport: saveContract.finishCinematicReplayExport,
    cancelCinematicReplayExport: saveContract.cancelCinematicReplayExport,
    getCinematicReplayExportStatus: saveContract.getCinematicReplayExportStatus,
    listCinematicReplayExportOrphans: saveContract.listCinematicReplayExportOrphans,
    startDiscovery: discoveryContract.start,
    stopDiscovery: discoveryContract.stop,
    getDiscoveredHosts: discoveryContract.listHosts,
    onDiscoveredHosts: discoveryContract.subscribeHosts,
    isApp: true,
});

contextBridge.exposeInMainWorld('__CURVIOS_APP__', true);
contextBridge.exposeInMainWorld('curviosApp', curviosApp);

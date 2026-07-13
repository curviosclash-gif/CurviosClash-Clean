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
    });
}

function createRecordingContract() {
    return createNamedContract('recording', PRELOAD_CONTRACT_VERSIONS.recording, {
        supportsCapture: true,
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

function createSettingsDefaultsContract() {
    return createNamedContract('settingsDefaults', PRELOAD_CONTRACT_VERSIONS.settingsDefaults, {
        getOverrideSnapshot: () => deepCloneJson(readMenuDefaultsOverrideSnapshot()),
    });
}

function createErrorSnapshot(error, fallbackReason = 'tuning_runtime_error') {
    const message = error instanceof Error
        ? error.message
        : String(error || fallbackReason);
    return {
        reason: fallbackReason,
        message,
    };
}

const TUNING_RUNTIME_ACTIONS = Object.freeze({
    getAll: 'tuning:get-all',
    setValue: 'tuning:set-value',
    resetAll: 'tuning:reset-all',
    getRegistry: 'tuning:get-registry',
});

const tuningRuntimeState = {
    runtimeSupportPromise: null,
};

function resolveTuningRuntimeModuleUrl(relativePath) {
    const normalizedPath = String(relativePath || '')
        .replace(/\\/g, '/')
        .replace(/^\.\/+/, '')
        .replace(/^\/+/, '');
    const preloadDirectoryUrl = `file:///${String(__dirname).replace(/\\/g, '/')}/`;
    return new URL(`../${normalizedPath}`, preloadDirectoryUrl).href;
}

async function loadTuningRuntimeSupport() {
    if (!tuningRuntimeState.runtimeSupportPromise) {
        tuningRuntimeState.runtimeSupportPromise = (async () => {
            const bridgeModule = await import(resolveTuningRuntimeModuleUrl('src/dev/tuning/TuningRuntimeBridge.js'));
            const registryModule = await import(resolveTuningRuntimeModuleUrl('src/dev/tuning/TuningParameterRegistry.js'));
            const bridge = typeof bridgeModule.createTuningRuntimeBridge === 'function'
                ? bridgeModule.createTuningRuntimeBridge()
                : new bridgeModule.TuningRuntimeBridge();
            if (!bridge || typeof bridge.getAllValues !== 'function' || typeof bridge.setValue !== 'function') {
                throw new Error('TuningRuntimeBridge konnte nicht initialisiert werden.');
            }
            if (typeof registryModule.getTuningParameterRegistry !== 'function') {
                throw new Error('TuningParameterRegistry ist nicht verfuegbar.');
            }
            return {
                bridge,
                getRegistry: registryModule.getTuningParameterRegistry,
            };
        })().catch((error) => {
            tuningRuntimeState.runtimeSupportPromise = null;
            throw error;
        });
    }

    return tuningRuntimeState.runtimeSupportPromise;
}

async function executeTuningRuntimeAction(action, payload = null) {
    const runtimeSupport = await loadTuningRuntimeSupport();
    const bridge = runtimeSupport.bridge;
    const requestPayload = payload && typeof payload === 'object' ? payload : {};
    const normalizedAction = String(action || '').trim();

    if (normalizedAction === TUNING_RUNTIME_ACTIONS.getRegistry) {
        return {
            ok: true,
            reason: 'ok',
            detail: '',
            value: runtimeSupport.getRegistry(),
        };
    }

    if (normalizedAction === TUNING_RUNTIME_ACTIONS.getAll) {
        return {
            ok: true,
            reason: 'ok',
            detail: '',
            value: bridge.getAllValues(),
        };
    }

    if (normalizedAction === TUNING_RUNTIME_ACTIONS.setValue) {
        const result = bridge.setValue(String(requestPayload.path || ''), requestPayload.value);
        return {
            ok: result?.ok === true,
            reason: String(result?.reason || (result?.ok === true ? 'ok' : 'set_failed')),
            detail: '',
            value: result,
            error: result?.ok === true ? null : createErrorSnapshot(result?.reason || 'set_failed', 'set_failed'),
        };
    }

    if (normalizedAction === TUNING_RUNTIME_ACTIONS.resetAll) {
        const normalizedPaths = Array.isArray(requestPayload.paths)
            ? requestPayload.paths.map((value) => String(value || '').trim()).filter(Boolean)
            : null;
        const result = bridge.resetToDefaults(normalizedPaths);
        return {
            ok: result?.ok === true,
            reason: String(result?.reason || (result?.ok === true ? 'ok' : 'reset_failed')),
            detail: '',
            value: result,
            error: result?.ok === true ? null : createErrorSnapshot(result?.reason || 'reset_failed', 'reset_failed'),
        };
    }

    return {
        ok: false,
        reason: 'unknown_action',
        detail: `Unbekannte Tuning-Action: ${normalizedAction || '<missing>'}`,
        value: null,
        error: createErrorSnapshot(`Unbekannte Tuning-Action: ${normalizedAction || '<missing>'}`, 'unknown_action'),
    };
}

function createTuningRuntimeContract() {
    return createNamedContract('tuningRuntime', PRELOAD_CONTRACT_VERSIONS.tuningRuntime, {
        preloadRequestChannel: TUNING_RUNTIME_REQUEST_CHANNEL,
        preloadResponseChannel: TUNING_RUNTIME_RESPONSE_CHANNEL,
        getStatus: () => ({
            available: true,
            loaded: tuningRuntimeState.runtimeSupportPromise != null,
        }),
    });
}

async function handleTuningRuntimeRequest(payload = null) {
    const request = payload && typeof payload === 'object' ? payload : {};
    const requestId = String(request.requestId || '').trim();
    if (!requestId) {
        return;
    }

    try {
        const response = await executeTuningRuntimeAction(
            String(request.action || '').trim(),
            request.payload
        );
        const normalizedResponse = response && typeof response === 'object'
            ? response
            : { ok: true, value: response };
        const ok = normalizedResponse.ok !== false;
        ipcRenderer.send(TUNING_RUNTIME_RESPONSE_CHANNEL, {
            requestId,
            ok,
            reason: String(normalizedResponse.reason || (ok ? 'ok' : 'runtime_error')),
            detail: String(normalizedResponse.detail || ''),
            value: Object.prototype.hasOwnProperty.call(normalizedResponse, 'value')
                ? normalizedResponse.value
                : null,
            error: ok
                ? null
                : (normalizedResponse.error && typeof normalizedResponse.error === 'object'
                    ? normalizedResponse.error
                    : createErrorSnapshot(normalizedResponse.detail || 'runtime_error', String(normalizedResponse.reason || 'runtime_error'))),
        });
    } catch (error) {
        const snapshot = createErrorSnapshot(error, 'handler_threw');
        ipcRenderer.send(TUNING_RUNTIME_RESPONSE_CHANNEL, {
            requestId,
            ok: false,
            reason: snapshot.reason,
            detail: snapshot.message,
            error: snapshot,
            value: null,
        });
    }
}

ipcRenderer.on(TUNING_RUNTIME_REQUEST_CHANNEL, (_event, payload) => {
    void handleTuningRuntimeRequest(payload);
});

const discoveryContract = createDiscoveryContract();
const hostContract = createHostContract();
const saveContract = createSaveContract();
const recordingContract = createRecordingContract();
const lifecycleContract = createLifecycleContract();
const settingsDefaultsContract = createSettingsDefaultsContract();
const tuningRuntimeContract = createTuningRuntimeContract();
const platformContracts = Object.freeze({
    discovery: discoveryContract,
    host: hostContract,
    save: saveContract,
    recording: recordingContract,
    lifecycle: lifecycleContract,
    settingsDefaults: settingsDefaultsContract,
    tuningRuntime: tuningRuntimeContract,
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
    getLanServerStatus: hostContract.getStatus,
    startLanServer: hostContract.start,
    stopLanServer: hostContract.stop,
    saveReplay: saveContract.saveReplay,
    saveVideo: saveContract.saveVideo,
    getRecordingVideoExportCapability: saveContract.getRecordingVideoExportCapability,
    saveRecordingVideoExport: saveContract.saveRecordingVideoExport,
    startDiscovery: discoveryContract.start,
    stopDiscovery: discoveryContract.stop,
    getDiscoveredHosts: discoveryContract.listHosts,
    onDiscoveredHosts: discoveryContract.subscribeHosts,
    isApp: true,
});

contextBridge.exposeInMainWorld('__CURVIOS_APP__', true);
contextBridge.exposeInMainWorld('curviosApp', curviosApp);

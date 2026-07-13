import {
    createPlatformCapabilitySnapshot,
    PLATFORM_CAPABILITY_IDS,
} from '../../shared/contracts/PlatformCapabilityContract.js';
import {
    PLATFORM_RUNTIME_KINDS,
    resolveCapabilityProviderKind,
} from '../../shared/contracts/PlatformCapabilityRegistry.js';
import {
    createCapabilityAdapterDescriptor,
    createCapabilityIntent,
    resolveCapabilityAvailability,
} from '../PlatformCapabilityAdapterSupport.js';

const PRELOAD_CONTRACT_VERSIONS = Object.freeze({
    discovery: 'preload.discovery.v1',
    host: 'preload.host.v1',
    save: 'preload.save.v2',
    recording: 'preload.recording.v1',
    lifecycle: 'preload.lifecycle.v1',
});

function resolveRuntimeGlobal(runtimeGlobal = globalThis) {
    return runtimeGlobal && typeof runtimeGlobal === 'object' ? runtimeGlobal : globalThis;
}

function resolveAppRuntime(runtimeGlobal = globalThis) {
    const globalRef = resolveRuntimeGlobal(runtimeGlobal);
    const appRuntime = globalRef?.curviosApp && typeof globalRef.curviosApp === 'object'
        ? globalRef.curviosApp
        : {};
    return {
        globalRef,
        appRuntime,
    };
}

function resolveNamedContract(appRuntime, key) {
    const contracts = appRuntime?.contracts && typeof appRuntime.contracts === 'object'
        ? appRuntime.contracts
        : null;
    const contract = contracts?.[key] || appRuntime?.[key] || null;
    return contract && typeof contract === 'object' ? contract : null;
}

export function resolveElectronRuntimeSnapshot(runtimeGlobal = globalThis) {
    const globalRef = resolveRuntimeGlobal(runtimeGlobal);
    const { appRuntime } = resolveAppRuntime(runtimeGlobal);
    const isElectron = appRuntime?.isApp === true || globalRef?.__CURVIOS_APP__ === true;
    const browserDemoSurfacePolicyContract = resolveNamedContract(appRuntime, 'browserDemoSurfacePolicy');
    const settingsDefaultsContract = resolveNamedContract(appRuntime, 'settingsDefaults');
    return Object.freeze({
        runtimeKind: isElectron ? PLATFORM_RUNTIME_KINDS.ELECTRON : PLATFORM_RUNTIME_KINDS.WEB,
        browserDemoSurfacePolicyContract,
        settingsDefaultsContract,
    });
}

function resolveNamedCapability(appRuntime, key) {
    const capabilities = appRuntime?.capabilities && typeof appRuntime.capabilities === 'object'
        ? appRuntime.capabilities
        : null;
    const capability = capabilities?.[key];
    return capability && typeof capability === 'object' ? capability : null;
}

export function isElectronPreloadRuntime(runtimeGlobal = globalThis) {
    return resolveElectronRuntimeSnapshot(runtimeGlobal).runtimeKind === PLATFORM_RUNTIME_KINDS.ELECTRON;
}

export function createElectronPreloadDiscoveryAdapter(runtimeGlobal = globalThis) {
    const { appRuntime } = resolveAppRuntime(runtimeGlobal);
    const discoveryContract = resolveNamedContract(appRuntime, 'discovery');
    const startDiscovery = createCapabilityIntent(
        discoveryContract,
        discoveryContract?.start,
        appRuntime,
        appRuntime?.startDiscovery
    );
    const stopDiscovery = createCapabilityIntent(
        discoveryContract,
        discoveryContract?.stop,
        appRuntime,
        appRuntime?.stopDiscovery
    );
    const getDiscoveredHosts = createCapabilityIntent(
        discoveryContract,
        discoveryContract?.listHosts,
        appRuntime,
        appRuntime?.getDiscoveredHosts
    );
    const onDiscoveredHosts = createCapabilityIntent(
        discoveryContract,
        discoveryContract?.subscribeHosts,
        appRuntime,
        appRuntime?.onDiscoveredHosts
    );
    const available = resolveCapabilityAvailability([
        startDiscovery,
        stopDiscovery,
        getDiscoveredHosts,
        onDiscoveredHosts,
    ]);
    const capability = createCapabilityAdapterDescriptor(
        PLATFORM_CAPABILITY_IDS.DISCOVERY,
        resolveNamedCapability(appRuntime, 'discovery'),
        {
            providerKind: resolveCapabilityProviderKind(PLATFORM_CAPABILITY_IDS.DISCOVERY, {
                runtimeGlobal,
                available,
            }),
            contractVersion: discoveryContract?.contractVersion || PRELOAD_CONTRACT_VERSIONS.discovery,
            degradedReason: isElectronPreloadRuntime(runtimeGlobal) ? 'discovery_unavailable' : 'desktop_shell_unavailable',
        },
        {
            available,
            resolvedFlags: {
                supportsSubscribe: typeof onDiscoveredHosts === 'function',
            },
        }
    );

    return Object.freeze({
        adapterName: 'electron.preload.discovery.v1',
        contractVersion: capability.contractVersion,
        capability,
        isAvailable: () => capability.available === true,
        startDiscovery,
        stopDiscovery,
        getDiscoveredHosts,
        onDiscoveredHosts,
        start: startDiscovery,
        stop: stopDiscovery,
        listHosts: getDiscoveredHosts,
        subscribeHosts: onDiscoveredHosts,
    });
}

export function createElectronPreloadHostAdapter(runtimeGlobal = globalThis) {
    const { appRuntime } = resolveAppRuntime(runtimeGlobal);
    const hostContract = resolveNamedContract(appRuntime, 'host');
    const getLanServerStatus = createCapabilityIntent(
        hostContract,
        hostContract?.getStatus,
        appRuntime,
        appRuntime?.getLanServerStatus
    );
    const startLanServer = createCapabilityIntent(
        hostContract,
        hostContract?.start,
        appRuntime,
        appRuntime?.startLanServer
    );
    const stopLanServer = createCapabilityIntent(
        hostContract,
        hostContract?.stop,
        appRuntime,
        appRuntime?.stopLanServer
    );
    const available = resolveCapabilityAvailability([
        getLanServerStatus,
        startLanServer,
        stopLanServer,
    ]);
    const capability = createCapabilityAdapterDescriptor(
        PLATFORM_CAPABILITY_IDS.HOST,
        resolveNamedCapability(appRuntime, 'host'),
        {
            providerKind: resolveCapabilityProviderKind(PLATFORM_CAPABILITY_IDS.HOST, {
                runtimeGlobal,
                available,
            }),
            contractVersion: hostContract?.contractVersion || PRELOAD_CONTRACT_VERSIONS.host,
            degradedReason: isElectronPreloadRuntime(runtimeGlobal) ? 'host_unavailable' : 'desktop_shell_unavailable',
        },
        {
            available,
            resolvedFlags: {
                supportsSessionOwnership: available,
            },
        }
    );

    return Object.freeze({
        adapterName: 'electron.preload.host.v1',
        contractVersion: capability.contractVersion,
        capability,
        isAvailable: () => capability.available === true,
        getLanServerStatus,
        startLanServer,
        stopLanServer,
        getStatus: getLanServerStatus,
        start: startLanServer,
        stop: stopLanServer,
    });
}

export function createElectronPreloadSaveAdapter(runtimeGlobal = globalThis) {
    const { appRuntime } = resolveAppRuntime(runtimeGlobal);
    const saveContract = resolveNamedContract(appRuntime, 'save');
    const saveReplay = createCapabilityIntent(
        saveContract,
        saveContract?.saveReplay,
        appRuntime,
        appRuntime?.saveReplay
    );
    const saveVideo = createCapabilityIntent(
        saveContract,
        saveContract?.saveVideo,
        appRuntime,
        appRuntime?.saveVideo
    );
    const saveRecordingVideoExport = createCapabilityIntent(
        saveContract,
        saveContract?.saveRecordingVideoExport,
        appRuntime,
        appRuntime?.saveRecordingVideoExport
    );
    const getRecordingVideoExportCapability = createCapabilityIntent(
        saveContract,
        saveContract?.getRecordingVideoExportCapability,
        appRuntime,
        appRuntime?.getRecordingVideoExportCapability
    );
    const available = resolveCapabilityAvailability(
        [saveReplay, saveVideo, saveRecordingVideoExport],
        'any'
    );
    const capability = createCapabilityAdapterDescriptor(
        PLATFORM_CAPABILITY_IDS.SAVE,
        resolveNamedCapability(appRuntime, 'save'),
        {
            providerKind: resolveCapabilityProviderKind(PLATFORM_CAPABILITY_IDS.SAVE, {
                runtimeGlobal,
                available,
            }),
            contractVersion: saveContract?.contractVersion || PRELOAD_CONTRACT_VERSIONS.save,
            degradedReason: isElectronPreloadRuntime(runtimeGlobal) ? 'save_unavailable' : 'desktop_shell_unavailable',
        },
        {
            available,
            resolvedFlags: {
                supportsBinaryExport: typeof saveVideo === 'function'
                    || typeof saveRecordingVideoExport === 'function',
            },
        }
    );

    return Object.freeze({
        adapterName: 'electron.preload.save.v1',
        contractVersion: capability.contractVersion,
        capability,
        isAvailable: () => capability.available === true,
        saveReplay,
        saveVideo,
        saveRecordingVideoExport,
        getRecordingVideoExportCapability,
    });
}

export function createElectronPreloadRecordingAdapter(runtimeGlobal = globalThis) {
    const { appRuntime } = resolveAppRuntime(runtimeGlobal);
    const recordingContract = resolveNamedContract(appRuntime, 'recording');
    const explicitCapability = resolveNamedCapability(appRuntime, 'recording');
    const supportsCapture = recordingContract?.supportsCapture === true
        || explicitCapability?.supportsCapture === true
        || isElectronPreloadRuntime(runtimeGlobal);
    const capability = createCapabilityAdapterDescriptor(
        PLATFORM_CAPABILITY_IDS.RECORDING,
        explicitCapability,
        {
            providerKind: resolveCapabilityProviderKind(PLATFORM_CAPABILITY_IDS.RECORDING, {
                runtimeGlobal,
                available: supportsCapture,
            }),
            contractVersion: recordingContract?.contractVersion || PRELOAD_CONTRACT_VERSIONS.recording,
            degradedReason: isElectronPreloadRuntime(runtimeGlobal) ? 'recording_unavailable' : 'desktop_shell_unavailable',
        },
        {
            available: supportsCapture,
            resolvedFlags: {
                supportsCapture,
            },
        }
    );

    return Object.freeze({
        adapterName: 'electron.preload.recording.v1',
        contractVersion: capability.contractVersion,
        capability,
        isAvailable: () => capability.available === true,
    });
}

/**
 * Lifecycle capability adapter — wraps the shell's graceful-close handshake.
 *
 * When the Electron window is closed, the main process sends 'request-graceful-close'
 * to the renderer.  The adapter surfaces this as onGracefulClose(cb) so the renderer
 * can run its own dispose/finalize sequence and then call confirmGracefulClose() to
 * allow the window to proceed.  All routing goes through facade.dispose() so the same
 * finalizing -> match_finalized -> menu_opened path is used regardless of how the
 * session ends.
 *
 * @param {typeof globalThis} [runtimeGlobal]
 */
export function createElectronPreloadLifecycleAdapter(runtimeGlobal = globalThis) {
    const { appRuntime } = resolveAppRuntime(runtimeGlobal);
    const lifecycleContract = resolveNamedContract(appRuntime, 'lifecycle');

    const rawOnGracefulClose = lifecycleContract?.onGracefulClose;
    const rawConfirmGracefulClose = lifecycleContract?.confirmGracefulClose;
    const available = typeof rawOnGracefulClose === 'function'
        && typeof rawConfirmGracefulClose === 'function';

    return Object.freeze({
        adapterName: 'electron.preload.lifecycle.v1',
        contractVersion: lifecycleContract?.contractVersion || PRELOAD_CONTRACT_VERSIONS.lifecycle,
        isAvailable: () => available,
        /**
         * Register a callback fired when the shell requests a graceful close.
         * Returns an unsubscribe function.
         * @param {() => void | Promise<void>} callback
         * @returns {() => void}
         */
        onGracefulClose: available
            ? (callback) => rawOnGracefulClose(callback)
            : () => () => {},
        /** Signal to the shell that renderer-side teardown is complete. */
        confirmGracefulClose: available
            ? () => rawConfirmGracefulClose()
            : () => {},
    });
}

export function getElectronPlatformCapabilitySnapshot(runtimeGlobal = globalThis) {
    const discoveryAdapter = createElectronPreloadDiscoveryAdapter(runtimeGlobal);
    const hostAdapter = createElectronPreloadHostAdapter(runtimeGlobal);
    const saveAdapter = createElectronPreloadSaveAdapter(runtimeGlobal);
    const recordingAdapter = createElectronPreloadRecordingAdapter(runtimeGlobal);

    return createPlatformCapabilitySnapshot({
        runtimeKind: resolveElectronRuntimeSnapshot(runtimeGlobal).runtimeKind,
        discovery: discoveryAdapter.capability,
        host: hostAdapter.capability,
        save: saveAdapter.capability,
        recording: recordingAdapter.capability,
    });
}

export function isDesktopPlatformRuntime(runtimeGlobal = globalThis) {
    if (isElectronPreloadRuntime(runtimeGlobal)) {
        return true;
    }
    const snapshot = getElectronPlatformCapabilitySnapshot(runtimeGlobal);
    return snapshot.discovery.available || snapshot.host.available || snapshot.save.available;
}

export const createElectronDiscoveryIntentBridge = createElectronPreloadDiscoveryAdapter;
export const createElectronHostIntentBridge = createElectronPreloadHostAdapter;


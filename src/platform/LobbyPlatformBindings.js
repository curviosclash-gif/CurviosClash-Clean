import { createBrowserDiscoveryAdapter } from './browser/BrowserPlatformAdapters.js';
import {
    createElectronDiscoveryIntentBridge,
    createElectronHostIntentBridge,
    createElectronPreloadDiscoveryAdapter,
    getElectronPlatformCapabilitySnapshot,
    isElectronPreloadRuntime,
    resolveElectronRuntimeSnapshot,
} from './electron/ElectronPlatformBridge.js';

export function createLobbyPlatformBindings(runtimeGlobal = globalThis) {
    const electronRuntime = isElectronPreloadRuntime(runtimeGlobal);
    return Object.freeze({
        runtimeSnapshot: resolveElectronRuntimeSnapshot(runtimeGlobal),
        platformCapabilities: getElectronPlatformCapabilitySnapshot(runtimeGlobal),
        hostIntentBridge: createElectronHostIntentBridge(runtimeGlobal),
        discoveryIntentBridge: createElectronDiscoveryIntentBridge(runtimeGlobal),
        discoveryAdapter: electronRuntime
            ? createElectronPreloadDiscoveryAdapter(runtimeGlobal)
            : createBrowserDiscoveryAdapter(),
    });
}

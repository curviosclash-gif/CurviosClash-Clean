import { createBrowserDiscoveryAdapter } from './browser/BrowserPlatformAdapters.js';
import { PLATFORM_CAPABILITY_IDS } from '../shared/contracts/PlatformCapabilityContract.js';
import { resolveSurfaceCapabilityAccess } from '../shared/contracts/PlatformCapabilityRegistry.js';
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
    const runtimeSnapshot = resolveElectronRuntimeSnapshot(runtimeGlobal);
    return Object.freeze({
        runtimeSnapshot,
        discoveryAccess: resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.DISCOVERY, {
            runtimeGlobal, platformRuntimeSnapshot: runtimeSnapshot,
        }),
        platformCapabilities: getElectronPlatformCapabilitySnapshot(runtimeGlobal),
        hostIntentBridge: createElectronHostIntentBridge(runtimeGlobal),
        discoveryIntentBridge: createElectronDiscoveryIntentBridge(runtimeGlobal),
        discoveryAdapter: electronRuntime
            ? createElectronPreloadDiscoveryAdapter(runtimeGlobal)
            : createBrowserDiscoveryAdapter(),
    });
}

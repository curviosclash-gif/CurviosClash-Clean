import { createBrowserDiscoveryAdapter } from '../../platform/browser/BrowserPlatformAdapters.js';
import {
    createElectronPreloadDiscoveryAdapter,
    isElectronPreloadRuntime,
    resolveElectronRuntimeSnapshot,
} from '../../platform/electron/ElectronPlatformBridge.js';
import { PLATFORM_CAPABILITY_IDS } from '../../shared/contracts/PlatformCapabilityContract.js';
import { resolveSurfaceCapabilityAccess } from '../../shared/contracts/PlatformCapabilityRegistry.js';
import { resolveGlobalObject, toCallable } from './LobbyRuntimeEnvironment.js';

const NOOP_UNSUBSCRIBE = () => {};

function toHostList(value) {
    return Array.isArray(value) ? value.filter((host) => host && typeof host === 'object') : [];
}

export function createNetworkLobbyDiscoveryPort(options = {}) {
    const runtimeGlobal = resolveGlobalObject(options.runtime);
    const discoverySurfaceCapability = resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.DISCOVERY, {
        runtimeGlobal,
        platformRuntimeSnapshot: resolveElectronRuntimeSnapshot(runtimeGlobal),
    });
    const discoveryRuntime = options.discoveryRuntime && typeof options.discoveryRuntime === 'object'
        ? options.discoveryRuntime
        : (isElectronPreloadRuntime(runtimeGlobal)
            ? createElectronPreloadDiscoveryAdapter(runtimeGlobal)
            : createBrowserDiscoveryAdapter());

    const startDiscovery = toCallable(discoveryRuntime?.startDiscovery, null);
    const stopDiscovery = toCallable(discoveryRuntime?.stopDiscovery, null);
    const getDiscoveredHosts = toCallable(discoveryRuntime?.getDiscoveredHosts, null);
    const onDiscoveredHosts = toCallable(discoveryRuntime?.onDiscoveredHosts, null);

    function isAvailable() {
        if (discoverySurfaceCapability.available !== true) {
            return false;
        }
        if (typeof discoveryRuntime?.isAvailable === 'function') {
            return discoveryRuntime.isAvailable() === true;
        }
        if (discoveryRuntime?.capability && typeof discoveryRuntime.capability === 'object') {
            return discoveryRuntime.capability.available === true;
        }
        return !!(startDiscovery && stopDiscovery && onDiscoveredHosts);
    }

    function start() {
        if (!isAvailable()) {
            return;
        }
        startDiscovery?.call(discoveryRuntime);
    }

    function stop() {
        stopDiscovery?.call(discoveryRuntime);
    }

    async function getHosts() {
        if (discoverySurfaceCapability.available !== true) {
            return [];
        }
        if (!getDiscoveredHosts) return [];
        try {
            const hosts = await getDiscoveredHosts.call(discoveryRuntime);
            return toHostList(hosts);
        } catch {
            return [];
        }
    }

    function subscribe(onHostsChanged) {
        if (discoverySurfaceCapability.available !== true) {
            return NOOP_UNSUBSCRIBE;
        }
        if (!onDiscoveredHosts || typeof onHostsChanged !== 'function') {
            return NOOP_UNSUBSCRIBE;
        }
        try {
            const dispose = onDiscoveredHosts.call(discoveryRuntime, (hosts) => {
                onHostsChanged(toHostList(hosts));
            });
            return typeof dispose === 'function' ? dispose : NOOP_UNSUBSCRIBE;
        } catch {
            return NOOP_UNSUBSCRIBE;
        }
    }

    return Object.freeze({
        isAvailable,
        start,
        stop,
        getHosts,
        subscribe,
    });
}

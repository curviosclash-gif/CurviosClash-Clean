import { createBrowserHostAdapter } from '../../../platform/browser/BrowserPlatformAdapters.js';
import {
    createElectronPreloadHostAdapter,
    isElectronPreloadRuntime,
    resolveElectronRuntimeSnapshot,
} from '../../../platform/electron/ElectronPlatformBridge.js';
import { PLATFORM_CAPABILITY_IDS } from '../../../shared/contracts/PlatformCapabilityContract.js';
import { resolveSurfaceCapabilityAccess } from '../../../shared/contracts/PlatformCapabilityRegistry.js';
import { resolveGlobalObject, toCallable } from './MenuMultiplayerBridgeRuntime.js';

function normalizeIp(value) {
    const text = String(value || '').trim();
    return text || 'localhost';
}

function resolveLocalIpWithWebRtc({ runtimeGlobal, timeoutMs = 2000 } = {}) {
    return new Promise((resolve) => {
        const PeerConnection = runtimeGlobal?.RTCPeerConnection;
        if (typeof PeerConnection !== 'function') {
            resolve('localhost');
            return;
        }

        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(normalizeIp(value));
        };

        let peer = null;
        try {
            peer = new PeerConnection({ iceServers: [] });
            peer.createDataChannel('');
            peer.createOffer()
                .then((offer) => peer.setLocalDescription(offer))
                .catch(() => finish('localhost'));

            peer.onicecandidate = (event) => {
                const candidateValue = String(event?.candidate?.candidate || '');
                const match = candidateValue.match(/(\d+\.\d+\.\d+\.\d+)/);
                if (match && match[1] !== '0.0.0.0') {
                    try { peer.close(); } catch { /* ignore */ }
                    finish(match[1]);
                }
            };
        } catch {
            try { peer?.close?.(); } catch { /* ignore */ }
            finish('localhost');
            return;
        }

        const setTimeoutImpl = toCallable(runtimeGlobal?.setTimeout, setTimeout);
        setTimeoutImpl(() => {
            try { peer?.close?.(); } catch { /* ignore */ }
            finish('localhost');
        }, timeoutMs);
    });
}

async function resolveFromDiscoveryEndpoint(options) {
    const { runtimeGlobal, discoveryRuntime, hostSurfaceCapability } = options;
    if (hostSurfaceCapability?.available !== true) {
        return null;
    }
    if (typeof discoveryRuntime?.isAvailable === 'function' && discoveryRuntime.isAvailable() !== true) {
        return null;
    }
    if (
        (!discoveryRuntime?.isAvailable || typeof discoveryRuntime.isAvailable !== 'function')
        && discoveryRuntime?.capability
        && typeof discoveryRuntime.capability === 'object'
        && discoveryRuntime.capability.available !== true
    ) {
        return null;
    }
    const fetchImpl = toCallable(options.fetch, runtimeGlobal?.fetch);
    const getLanServerStatus = toCallable(discoveryRuntime?.getLanServerStatus, null);
    if (!fetchImpl || !getLanServerStatus) return null;

    try {
        const status = await getLanServerStatus.call(discoveryRuntime);
        const statusHostIp = normalizeIp(status?.hostIp || status?.localIps?.[0] || '');
        if (statusHostIp !== 'localhost') {
            return statusHostIp;
        }
        const port = Number(status?.port) > 0
            ? Number(status.port)
            : (Number(status?.selectedPort) > 0 ? Number(status.selectedPort) : 9090);
        const response = await fetchImpl(`http://localhost:${port}/discovery/info`);
        if (!response?.ok) return null;
        const payload = await response.json();
        return normalizeIp(payload?.ip || payload?.hostIp);
    } catch {
        return null;
    }
}

export function createMenuMultiplayerHostIpResolver(options = {}) {
    const runtimeGlobal = resolveGlobalObject(options.runtime);
    const hostSurfaceCapability = resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.HOST, {
        runtimeGlobal,
        platformRuntimeSnapshot: resolveElectronRuntimeSnapshot(runtimeGlobal),
    });
    const discoveryRuntime = options.discoveryRuntime && typeof options.discoveryRuntime === 'object'
        ? options.discoveryRuntime
        : (isElectronPreloadRuntime(runtimeGlobal)
            ? createElectronPreloadHostAdapter(runtimeGlobal)
            : createBrowserHostAdapter());
    const customResolveHostIp = toCallable(options.resolveHostIp, null);

    let cachedPromise = null;

    async function resolveHostIp() {
        if (hostSurfaceCapability.available !== true) {
            return 'localhost';
        }
        if (customResolveHostIp) {
            return normalizeIp(await customResolveHostIp());
        }

        const discoveryIp = await resolveFromDiscoveryEndpoint({
            runtimeGlobal,
            discoveryRuntime,
            hostSurfaceCapability,
            fetch: options.fetch,
        });
        if (discoveryIp) return discoveryIp;

        return resolveLocalIpWithWebRtc({ runtimeGlobal });
    }

    return Object.freeze({
        resolve() {
            if (!cachedPromise) {
                cachedPromise = Promise.resolve(resolveHostIp()).catch(() => 'localhost');
            }
            return cachedPromise.then((value) => normalizeIp(value));
        },
        reset() {
            cachedPromise = null;
        },
    });
}

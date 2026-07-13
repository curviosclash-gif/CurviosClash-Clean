import { resolveDefaultLobbyTransport } from '../../shared/contracts/PlatformCapabilityRegistry.js';
import { resolveElectronRuntimeSnapshot } from '../../platform/electron/ElectronPlatformBridge.js';
import {
    LOBBY_SERVICE_TRANSPORTS,
    matchesLobbyServiceTransport,
    normalizeLobbyServiceTransport,
} from '../../shared/contracts/LobbyServiceContract.js';
import { LanLobbyService } from './NetworkLobbyService.js';
import { OnlineLobbyService } from './OnlineLobbyService.js';
import { StorageLobbyService } from './StorageLobbyService.js';

function resolveRuntimeGlobal(runtime = null) {
    if (runtime && typeof runtime === 'object' && runtime.global && typeof runtime.global === 'object') {
        return runtime.global;
    }
    return typeof globalThis !== 'undefined' ? globalThis : null;
}

function resolveDefaultTransport(runtime = null) {
    const runtimeGlobal = resolveRuntimeGlobal(runtime);
    const e2eTransport = typeof __CURVIOS_E2E__ !== 'undefined' && __CURVIOS_E2E__ === true
        ? normalizeLobbyServiceTransport(runtimeGlobal?.__CURVIOS_E2E_LOBBY_TRANSPORT__, '')
        : '';
    if (e2eTransport) {
        return e2eTransport;
    }
    return resolveDefaultLobbyTransport({
        runtimeGlobal,
        // Adapter-Snapshot statt Raw-Globals: sonst faellt die Desktop-App auf Browser-Demo-Defaults zurueck.
        platformRuntimeSnapshot: resolveElectronRuntimeSnapshot(runtimeGlobal),
    });
}

function resolveCustomFactory(serviceFactories = null, transport = '') {
    const registry = serviceFactories && typeof serviceFactories === 'object' ? serviceFactories : null;
    const factory = registry?.[transport];
    return typeof factory === 'function' ? factory : null;
}

export function resolveMenuLobbyServiceTransport(options = {}) {
    const resolvedTransport = normalizeLobbyServiceTransport(options.transport, '');
    return resolvedTransport || resolveDefaultTransport(options.runtime);
}

export function matchesMenuLobbyServiceTransport(service, transport) {
    return matchesLobbyServiceTransport(service, transport);
}

export function createMenuLobbyService(options = {}) {
    const transport = resolveMenuLobbyServiceTransport(options);
    const customFactory = resolveCustomFactory(options.serviceFactories, transport);
    if (customFactory) {
        return customFactory({
            ...options,
            transport,
        });
    }
    if (transport === LOBBY_SERVICE_TRANSPORTS.LAN) {
        return new LanLobbyService({
            ...options,
            transport,
        });
    }
    if (transport === LOBBY_SERVICE_TRANSPORTS.ONLINE) {
        return new OnlineLobbyService({
            ...options,
            transport,
        });
    }
    return new StorageLobbyService({
        ...options,
        transport: LOBBY_SERVICE_TRANSPORTS.STORAGE_BRIDGE,
    });
}

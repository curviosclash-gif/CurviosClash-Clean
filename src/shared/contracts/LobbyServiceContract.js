import { MULTIPLAYER_TRANSPORTS } from './RuntimeSessionContract.js';
import { resolveLobbyProviderKind } from './PlatformCapabilityRegistry.js';
import { normalizeString } from './ContractNormalizeUtils.js';

export const LOBBY_SERVICE_CONTRACT_VERSION = 'lobby-service.v1';

export const LOBBY_SERVICE_TRANSPORTS = Object.freeze({
    STORAGE_BRIDGE: MULTIPLAYER_TRANSPORTS.STORAGE_BRIDGE,
    LAN: MULTIPLAYER_TRANSPORTS.LAN,
    ONLINE: MULTIPLAYER_TRANSPORTS.ONLINE,
});

export const LOBBY_SERVICE_EVENT_TYPES = Object.freeze({
    HOST: 'multiplayer_host',
    JOIN: 'multiplayer_join',
    READY_TOGGLE: 'multiplayer_ready_toggle',
    READY_INVALIDATED: 'multiplayer_ready_invalidated',
    MATCH_START: 'multiplayer_match_start',
});

const VALID_LOBBY_SERVICE_TRANSPORTS = new Set(Object.values(LOBBY_SERVICE_TRANSPORTS));

function resolveTransportCandidate(value) {
    if (value && typeof value === 'object') {
        return normalizeString(
            value.transport
            || value.bridgeKind
            || value.serviceDescriptor?.transport,
            ''
        );
    }
    return normalizeString(value, '');
}

export function normalizeLobbyServiceTransport(value, fallback = LOBBY_SERVICE_TRANSPORTS.LAN) {
    const normalized = resolveTransportCandidate(value).toLowerCase();
    return VALID_LOBBY_SERVICE_TRANSPORTS.has(normalized) ? normalized : fallback;
}

export function isNetworkLobbyServiceTransport(value) {
    const transport = normalizeLobbyServiceTransport(value, '');
    return transport === LOBBY_SERVICE_TRANSPORTS.LAN || transport === LOBBY_SERVICE_TRANSPORTS.ONLINE;
}

export function createLobbyServiceDescriptor(source = {}) {
    const transport = normalizeLobbyServiceTransport(source.transport, LOBBY_SERVICE_TRANSPORTS.LAN);
    return Object.freeze({
        contractVersion: LOBBY_SERVICE_CONTRACT_VERSION,
        transport,
        providerKind: normalizeString(
            source.providerKind,
            resolveLobbyProviderKind(transport)
        ),
        lifecycleContractVersion: normalizeString(source.lifecycleContractVersion, ''),
        supportsConnectionContext: source.supportsConnectionContext === true || isNetworkLobbyServiceTransport(transport),
        supportsDiscovery: source.supportsDiscovery === true,
    });
}

export function matchesLobbyServiceTransport(service, transport) {
    const currentTransport = normalizeLobbyServiceTransport(service, '');
    if (!currentTransport) return false;
    return currentTransport === normalizeLobbyServiceTransport(transport, currentTransport);
}

export function implementsLobbyServiceContract(value) {
    const transport = normalizeLobbyServiceTransport(value, '');
    if (!transport) return false;
    return typeof value?.host === 'function'
        && typeof value?.join === 'function'
        && typeof value?.leave === 'function'
        && typeof value?.toggleReady === 'function'
        && typeof value?.invalidateReadyForAll === 'function'
        && typeof value?.publishHostSettings === 'function'
        && typeof value?.requestMatchStart === 'function'
        && typeof value?.syncActorIdentity === 'function'
        && typeof value?.getSessionState === 'function'
        && typeof value?.getSnapshot === 'function'
        && typeof value?.getEvents === 'function'
        && typeof value?.dispose === 'function';
}

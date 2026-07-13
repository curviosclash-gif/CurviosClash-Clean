/**
 * DesktopMultiplayerRoleContract — V64 64.1.1 + 64.1.2
 *
 * Translates the "Desktop first fuer Multiplayer" product decision into
 * explicit roles, duties, and constraints per product surface (64.1.1),
 * and defines a transport-neutral compatibility matrix for single/splitscreen/
 * lan/online (64.1.2).
 *
 * This module is a derived READ layer over PlatformCapabilityRegistry.
 * Single source of truth: PlatformCapabilityData / resolveSurfacePolicy.
 * This file does NOT introduce new transport or role constants.
 *
 * V64 64.1 leitplanke: Produktrollen kommen ausschliesslich aus
 * resolveSurfacePolicy / resolveSurfaceMultiplayerGateAccess. V64 fuehrt
 * keine zweite Produkt- oder Transport-Terminologie ein.
 */
import { PLATFORM_CAPABILITY_IDS } from './PlatformCapabilityContract.js';
import {
    PLATFORM_PRODUCT_SURFACE_IDS,
    PLATFORM_SURFACE_SESSION_TYPES,
} from './PlatformCapabilityData.js';
import {
    normalizePlatformProductSurfaceId,
    resolveSurfaceCapabilityAccess,
    resolveSurfacePolicy,
} from './PlatformCapabilityRegistry.js';
import { MULTIPLAYER_TRANSPORTS, RUNTIME_SESSION_TYPES } from './RuntimeSessionContract.js';

export const DESKTOP_MULTIPLAYER_ROLE_CONTRACT_VERSION = 'desktop-multiplayer-role.v1';

// ---------------------------------------------------------------------------
// V64 64.1.2 — Transport-neutrale Kompatibilitaetsmatrix
// ---------------------------------------------------------------------------

/**
 * Network requirements per session type (transport-neutral).
 * Describes what connectivity a session type requires regardless of surface.
 */
export const DESKTOP_SESSION_TRANSPORT_REQUIREMENT = Object.freeze({
    /** single: offline, no network needed */
    [PLATFORM_SURFACE_SESSION_TYPES.SINGLE]: 'none',
    /** splitscreen: offline, local controller-only */
    [PLATFORM_SURFACE_SESSION_TYPES.SPLITSCREEN]: 'none',
    /** multiplayer: network requirement depends on multiplayerTransport */
    [PLATFORM_SURFACE_SESSION_TYPES.MULTIPLAYER]: 'transport-driven',
});

/**
 * Network requirements per multiplayer transport (transport-neutral).
 */
export const DESKTOP_TRANSPORT_NETWORK_REQUIREMENT = Object.freeze({
    /** lan: local network (UDP broadcast or direct peer on LAN) */
    [MULTIPLAYER_TRANSPORTS.LAN]: 'local-network',
    /** online: internet-reachable signaling server + ICE */
    [MULTIPLAYER_TRANSPORTS.ONLINE]: 'internet',
    /** storage-bridge: legacy browser-only coordination via localStorage */
    [MULTIPLAYER_TRANSPORTS.STORAGE_BRIDGE]: 'legacy-local-only',
});

/**
 * Transport-neutral compatibility matrix for single/splitscreen/lan/online.
 * Declares whether each session/transport combination is offline-safe,
 * which real multiplayerTransport it maps to, and whether it supports
 * splitscreen co-location.
 *
 * Used by V64 consumers to drive UI hints and validation without
 * re-deriving transport requirements from surface policy on every call.
 */
export const DESKTOP_MULTIPLAYER_COMPATIBILITY_MATRIX = Object.freeze({
    [RUNTIME_SESSION_TYPES.SINGLE]: Object.freeze({
        sessionType: RUNTIME_SESSION_TYPES.SINGLE,
        networkRequirement: DESKTOP_SESSION_TRANSPORT_REQUIREMENT[PLATFORM_SURFACE_SESSION_TYPES.SINGLE],
        offlineCompatible: true,
        multiplayerTransportRequired: null,
        splitscreenCompatible: false,
    }),
    [RUNTIME_SESSION_TYPES.SPLITSCREEN]: Object.freeze({
        sessionType: RUNTIME_SESSION_TYPES.SPLITSCREEN,
        networkRequirement: DESKTOP_SESSION_TRANSPORT_REQUIREMENT[PLATFORM_SURFACE_SESSION_TYPES.SPLITSCREEN],
        offlineCompatible: true,
        multiplayerTransportRequired: null,
        splitscreenCompatible: true,
    }),
    [RUNTIME_SESSION_TYPES.LAN]: Object.freeze({
        sessionType: RUNTIME_SESSION_TYPES.LAN,
        networkRequirement: DESKTOP_TRANSPORT_NETWORK_REQUIREMENT[MULTIPLAYER_TRANSPORTS.LAN],
        offlineCompatible: false,
        multiplayerTransportRequired: MULTIPLAYER_TRANSPORTS.LAN,
        splitscreenCompatible: false,
    }),
    [RUNTIME_SESSION_TYPES.ONLINE]: Object.freeze({
        sessionType: RUNTIME_SESSION_TYPES.ONLINE,
        networkRequirement: DESKTOP_TRANSPORT_NETWORK_REQUIREMENT[MULTIPLAYER_TRANSPORTS.ONLINE],
        offlineCompatible: false,
        multiplayerTransportRequired: MULTIPLAYER_TRANSPORTS.ONLINE,
        splitscreenCompatible: false,
    }),
});

// ---------------------------------------------------------------------------
// V64 64.1.1 — Host-Join-Offline-Matrix per Product Surface
// ---------------------------------------------------------------------------

/**
 * Resolves the explicit multiplayer role matrix for a single product surface.
 * Derived from resolveSurfacePolicy; never overrides registry values.
 *
 * @param {string} productSurfaceId - one of PLATFORM_PRODUCT_SURFACE_IDS values
 * @returns {{
 *   contractVersion: string,
 *   productSurfaceId: string,
 *   multiplayerRole: string,
 *   canHost: boolean,
 *   canJoin: boolean,
 *   hostTransports: readonly string[],
 *   joinTransports: readonly string[],
 *   defaultTransport: string,
 *   offlineSessionTypes: readonly string[],
 *   legacyTransports: readonly string[],
 * }}
 */
export function resolveDesktopMultiplayerRoleSurface(productSurfaceId) {
    const resolvedSurfaceId = normalizePlatformProductSurfaceId(
        productSurfaceId,
        PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO
    );

    const policy = resolveSurfacePolicy({ productSurfaceId: resolvedSurfaceId });
    const hostCapability = resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.HOST, {
        productSurfaceId: resolvedSurfaceId,
    });

    const offlineSessionTypes = policy.allowedSessionTypes.filter(
        (t) => t !== PLATFORM_SURFACE_SESSION_TYPES.MULTIPLAYER
    );

    return Object.freeze({
        contractVersion: DESKTOP_MULTIPLAYER_ROLE_CONTRACT_VERSION,
        productSurfaceId: resolvedSurfaceId,
        multiplayerRole: policy.multiplayerRole,
        canHost: hostCapability.available === true && policy.hostMultiplayerTransports.length > 0,
        canJoin: policy.joinMultiplayerTransports.length > 0,
        hostTransports: policy.hostMultiplayerTransports,
        joinTransports: policy.joinMultiplayerTransports,
        defaultTransport: policy.defaultMultiplayerTransport,
        offlineSessionTypes: Object.freeze([...offlineSessionTypes]),
        legacyTransports: policy.legacyMultiplayerTransports,
    });
}

// ---------------------------------------------------------------------------
// V64 64.7.2 — Desktop Connectivity Profile
// Characterises which session types are valid in each connectivity state.
// ---------------------------------------------------------------------------

/**
 * Connectivity states for the Desktop product (V64 64.7.2).
 * Distinguishes the three relevant scenarios a Desktop user can be in.
 */
export const DESKTOP_CONNECTIVITY_STATES = Object.freeze({
    /** No network adapter active; all local modes work, network modes do not. */
    NO_NETWORK: 'no-network',
    /** LAN available but no internet route; local modes + lan work, online does not. */
    LOCAL_NETWORK_ONLY: 'local-network-only',
    /** Full internet access; all session types available. */
    INTERNET: 'internet',
});

/**
 * Returns the connectivity profile for the Desktop product — which session
 * types are valid in each connectivity scenario.
 *
 * Used by UI validation and diagnostics to produce meaningful per-transport
 * error or hint messages without re-deriving from surface policy on every call.
 *
 * V64 64.7.2: Desktop without internet is a valid product state for local
 * modes and LAN.  Online requires a reachable internet signaling endpoint.
 *
 * @returns {{
 *   noNetworkSessionTypes: readonly string[],
 *   localNetworkOnlySessionTypes: readonly string[],
 *   internetRequiredSessionTypes: readonly string[],
 *   onlineUnavailableHint: string,
 *   lanOfflineHint: string,
 * }}
 */
export function resolveDesktopConnectivityProfile() {
    return Object.freeze({
        /** Session types that work with zero network connectivity. */
        noNetworkSessionTypes: Object.freeze([
            RUNTIME_SESSION_TYPES.SINGLE,
            RUNTIME_SESSION_TYPES.SPLITSCREEN,
        ]),
        /** Session types that work with a local network but without internet. */
        localNetworkOnlySessionTypes: Object.freeze([
            RUNTIME_SESSION_TYPES.MULTIPLAYER,
        ]),
        /** Session types that require an internet-reachable signaling endpoint. */
        internetRequiredSessionTypes: Object.freeze([
            RUNTIME_SESSION_TYPES.ONLINE,
        ]),
        /** User-facing hint shown when Online is unavailable (no internet or unreachable server). */
        onlineUnavailableHint: 'Online nicht erreichbar: Internetverbindung und Signaling-Endpoint pruefen.',
        /** User-facing hint shown when LAN is unavailable (no local network detected). */
        lanOfflineHint: 'LAN nicht erreichbar: Lokale Netzwerkverbindung pruefen.',
    });
}

/**
 * Resolves the full Host-Join-Offline matrix for all product surfaces.
 * Output: canonical matrix for V64 64.1 — one entry per PLATFORM_PRODUCT_SURFACE_IDS value.
 *
 * @returns {{
 *   contractVersion: string,
 *   surfaces: { [surfaceId: string]: ReturnType<resolveDesktopMultiplayerRoleSurface> }
 * }}
 */
export function resolveDesktopMultiplayerRoleMatrix() {
    const surfaces = Object.values(PLATFORM_PRODUCT_SURFACE_IDS).reduce((acc, surfaceId) => {
        acc[surfaceId] = resolveDesktopMultiplayerRoleSurface(surfaceId);
        return acc;
    }, {});

    return Object.freeze({
        contractVersion: DESKTOP_MULTIPLAYER_ROLE_CONTRACT_VERSION,
        surfaces: Object.freeze(surfaces),
    });
}

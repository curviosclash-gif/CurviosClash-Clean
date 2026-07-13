import {
    PLATFORM_CAPABILITY_REGISTRY,
    PLATFORM_PRODUCT_SURFACE_IDS,
    PLATFORM_PROVIDER_KINDS,
    PLATFORM_SURFACE_MENU_MODE_PATHS,
    PLATFORM_SURFACE_POLICY_MODES,
    PLATFORM_TOOLING_IDS,
} from './PlatformCapabilityData.js';
import { MULTIPLAYER_TRANSPORTS } from './RuntimeSessionContract.js';
import {
    normalizeLobbyProviderTransport,
    normalizePlatformProductSurfaceId,
    normalizeString,
    normalizeSurfaceMenuModePath,
    normalizeSurfaceQuickStartActionId,
    normalizeSurfaceSessionType,
    sanitizeUniqueStringArray,
} from './PlatformCapabilityRegistryNormalization.js';
import { resolvePlatformProductSurfaceId } from './PlatformCapabilityRegistryRuntimeResolution.js';

export function resolveProductEntry(productSurfaceId) {
    return PLATFORM_CAPABILITY_REGISTRY.products[productSurfaceId]
        || PLATFORM_CAPABILITY_REGISTRY.products[PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO];
}

export function resolveSurfaceCapabilitySpec(capabilityId, productSurfaceId) {
    const normalizedCapabilityId = normalizeString(capabilityId, '');
    if (!normalizedCapabilityId) {
        return null;
    }
    return resolveProductEntry(productSurfaceId)?.capabilities?.[normalizedCapabilityId] || null;
}

export function resolveSurfaceDefaultAccessMode(surfacePolicy) {
    return normalizeString(
        surfacePolicy?.defaultAccessMode,
        PLATFORM_SURFACE_POLICY_MODES.DEFAULT_DENY
    );
}

export function resolveSurfaceDefaultProviderKind(productSurfaceId, defaultAccessMode) {
    if (defaultAccessMode !== PLATFORM_SURFACE_POLICY_MODES.DEFAULT_FULL) {
        return PLATFORM_PROVIDER_KINDS.UNAVAILABLE;
    }
    if (productSurfaceId === PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP) {
        return PLATFORM_PROVIDER_KINDS.ELECTRON_IPC;
    }
    if (productSurfaceId === PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO) {
        return PLATFORM_PROVIDER_KINDS.BROWSER_DEMO;
    }
    return PLATFORM_PROVIDER_KINDS.UNAVAILABLE;
}

export function resolveSurfaceDeveloperPolicy(surfacePolicy) {
    return surfacePolicy?.developerAccess && typeof surfacePolicy.developerAccess === 'object'
        ? surfacePolicy.developerAccess
        : null;
}

export function resolveSurfaceAllowedModePaths(surfacePolicy) {
    return sanitizeUniqueStringArray(
        surfacePolicy?.allowedModePaths,
        normalizeSurfaceMenuModePath
    );
}

export function resolveSurfaceAllowedSessionTypes(surfacePolicy) {
    return sanitizeUniqueStringArray(surfacePolicy?.allowedSessionTypes, normalizeSurfaceSessionType);
}

export function resolveSurfaceAllowedMultiplayerTransports(surfacePolicy) {
    return sanitizeUniqueStringArray(
        surfacePolicy?.allowedMultiplayerTransports,
        normalizeLobbyProviderTransport
    );
}

export function resolveSurfaceTransportSubset(values, allowedTransports, fallbackToAllowed = false) {
    if (!Array.isArray(values)) {
        return fallbackToAllowed === true
            ? Object.freeze([...allowedTransports])
            : Object.freeze([]);
    }
    const allowedSet = new Set(allowedTransports);
    const sanitized = sanitizeUniqueStringArray(values, normalizeLobbyProviderTransport)
        .filter((transport) => allowedSet.has(transport));
    return Object.freeze(sanitized);
}

export function resolveSurfaceDefaultMultiplayerTransport(surfacePolicy, allowedMultiplayerTransports) {
    const fallbackTransport = allowedMultiplayerTransports[0] || MULTIPLAYER_TRANSPORTS.LAN;
    return normalizeLobbyProviderTransport(surfacePolicy?.defaultMultiplayerTransport, fallbackTransport);
}

export function resolveSurfaceAllowedQuickStartActionIds(surfacePolicy) {
    return sanitizeUniqueStringArray(
        surfacePolicy?.allowedQuickStartActionIds,
        normalizeSurfaceQuickStartActionId
    );
}

export function resolveSurfaceAllowedPresetIds(surfacePolicy) {
    return sanitizeUniqueStringArray(surfacePolicy?.allowedPresetIds, normalizeString);
}

export function resolveSurfaceCuratedMapKeysByModePath(surfacePolicy) {
    const source = surfacePolicy?.curatedMapKeysByModePath;
    if (!source || typeof source !== 'object') {
        return Object.freeze({});
    }
    const resolved = {};
    Object.entries(source).forEach(([modePath, mapKeys]) => {
        const normalizedModePath = normalizeSurfaceMenuModePath(modePath, '');
        if (!normalizedModePath) {
            return;
        }
        resolved[normalizedModePath] = sanitizeUniqueStringArray(mapKeys, normalizeString);
    });
    return Object.freeze(resolved);
}

export function resolveSurfaceDefaultModePath(surfacePolicy, allowedModePaths) {
    const fallbackModePath = allowedModePaths[0] || PLATFORM_SURFACE_MENU_MODE_PATHS.NORMAL;
    return normalizeSurfaceMenuModePath(surfacePolicy?.defaultModePath, fallbackModePath)
        || fallbackModePath;
}

export function resolveSurfaceCapabilityConfiguredAvailability(providerSpec, fallbackAvailable = false) {
    if (providerSpec && typeof providerSpec === 'object') {
        if (Object.prototype.hasOwnProperty.call(providerSpec, 'enabled')) {
            return providerSpec.enabled === true;
        }
        return normalizeString(providerSpec.available, PLATFORM_PROVIDER_KINDS.UNAVAILABLE)
            !== PLATFORM_PROVIDER_KINDS.UNAVAILABLE;
    }
    if (typeof providerSpec !== 'string') {
        return fallbackAvailable === true;
    }
    return normalizeString(providerSpec, PLATFORM_PROVIDER_KINDS.UNAVAILABLE)
        !== PLATFORM_PROVIDER_KINDS.UNAVAILABLE;
}

export function isLegacyLobbyTransport(transport) {
    const normalized = normalizeString(transport, '').toLowerCase();
    return normalized === MULTIPLAYER_TRANSPORTS.STORAGE_BRIDGE;
}

/**
 * @param {unknown} transport
 * @param {string} [fallback]
 * @returns {string}
 */
export function resolveLobbyProviderKind(
    transport,
    fallback = PLATFORM_PROVIDER_KINDS.MENU_LAN_LOBBY
) {
    const normalizedTransport = normalizeLobbyProviderTransport(transport, fallback === ''
        ? ''
        : MULTIPLAYER_TRANSPORTS.LAN);
    if (!normalizedTransport) {
        return normalizeString(fallback, PLATFORM_PROVIDER_KINDS.MENU_LAN_LOBBY);
    }
    return normalizeString(
        PLATFORM_CAPABILITY_REGISTRY.lobbyProviders[normalizedTransport],
        normalizeString(fallback, PLATFORM_PROVIDER_KINDS.MENU_LAN_LOBBY)
    );
}

export function resolveCapabilityProviderKind(capabilityId, options = {}) {
    const normalizedCapabilityId = normalizeString(capabilityId, '');
    const productSurfaceId = resolvePlatformProductSurfaceId(options);
    const providerSpec = resolveSurfaceCapabilitySpec(normalizedCapabilityId, productSurfaceId);
    if (providerSpec && typeof providerSpec === 'object') {
        return options.available === false
            ? normalizeString(providerSpec.unavailable, PLATFORM_PROVIDER_KINDS.UNAVAILABLE)
            : normalizeString(providerSpec.available, PLATFORM_PROVIDER_KINDS.UNAVAILABLE);
    }
    return normalizeString(providerSpec, PLATFORM_PROVIDER_KINDS.UNAVAILABLE);
}

/**
 * @param {string} [toolingId]
 * @param {string} [fallback]
 * @returns {string}
 */
export function resolveToolingSurfaceId(
    toolingId = PLATFORM_TOOLING_IDS.DEFAULT,
    fallback = PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP
) {
    const normalizedToolingId = normalizeString(toolingId, PLATFORM_TOOLING_IDS.DEFAULT);
    return normalizePlatformProductSurfaceId(
        PLATFORM_CAPABILITY_REGISTRY.tooling?.[normalizedToolingId]?.surfaceId,
        fallback
    );
}

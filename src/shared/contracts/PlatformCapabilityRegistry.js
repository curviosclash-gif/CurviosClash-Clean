/**
 * PlatformCapabilityRegistry - resolver layer for platform capabilities.
 *
 * Static registry data still lives in PlatformCapabilityData.js, while the
 * resolver internals are now split into focused modules for normalization,
 * runtime/source resolution and surface/capability helpers.
 *
 * This file intentionally stays as the public compatibility entrypoint so
 * existing import sites do not need to change.
 */
export {
    PLATFORM_CAPABILITY_REGISTRY_CONTRACT_VERSION,
    PLATFORM_SURFACE_POLICY_CONTRACT_VERSION,
    PLATFORM_PRODUCT_SURFACE_IDS,
    PLATFORM_RUNTIME_KINDS,
    PLATFORM_PROVIDER_KINDS,
    PLATFORM_TOOLING_IDS,
    PLATFORM_SURFACE_POLICY_MODES,
    PLATFORM_SURFACE_DEVELOPER_ACCESS_MODES,
    PLATFORM_SURFACE_DEVELOPER_ACCESS_REASONS,
    PLATFORM_SURFACE_MULTIPLAYER_ROLES,
    PLATFORM_SURFACE_SESSION_TYPES,
    PLATFORM_SURFACE_MENU_MODE_PATHS,
    PLATFORM_SURFACE_QUICK_START_ACTION_IDS,
    PLATFORM_CAPABILITY_REGISTRY,
} from './PlatformCapabilityData.js';

export {
    normalizeLobbyProviderTransport,
    normalizePlatformProductSurfaceId,
    normalizePlatformRuntimeKind,
} from './PlatformCapabilityRegistryNormalization.js';
export {
    resolvePlatformProductSurfaceId,
    resolvePlatformRuntimeKind,
} from './PlatformCapabilityRegistryRuntimeResolution.js';
export {
    isLegacyLobbyTransport,
    resolveCapabilityProviderKind,
    resolveLobbyProviderKind,
    resolveToolingSurfaceId,
} from './PlatformCapabilityRegistrySurfaceHelpers.js';

import {
    PLATFORM_CAPABILITY_REGISTRY,
    PLATFORM_PRODUCT_SURFACE_IDS,
    PLATFORM_PROVIDER_KINDS,
    PLATFORM_SURFACE_DEVELOPER_ACCESS_MODES,
    PLATFORM_SURFACE_DEVELOPER_ACCESS_REASONS,
    PLATFORM_SURFACE_MULTIPLAYER_ROLES,
    PLATFORM_SURFACE_POLICY_CONTRACT_VERSION,
    PLATFORM_SURFACE_POLICY_MODES,
} from './PlatformCapabilityData.js';
import { MULTIPLAYER_TRANSPORTS } from './RuntimeSessionContract.js';
import { normalizeString } from './PlatformCapabilityRegistryNormalization.js';
import {
    resolvePlatformProductSurfaceId,
    resolvePlatformRuntimeKind,
} from './PlatformCapabilityRegistryRuntimeResolution.js';
import { resolveSurfacePolicySource } from './PlatformCapabilityRegistrySourceResolution.js';
import {
    resolveCapabilityProviderKind,
    resolveSurfaceAllowedModePaths,
    resolveSurfaceAllowedMultiplayerTransports,
    resolveSurfaceAllowedPresetIds,
    resolveSurfaceAllowedQuickStartActionIds,
    resolveSurfaceAllowedSessionTypes,
    resolveSurfaceCapabilityConfiguredAvailability,
    resolveSurfaceCapabilitySpec,
    resolveSurfaceCuratedMapKeysByModePath,
    resolveSurfaceDefaultAccessMode,
    resolveSurfaceDefaultModePath,
    resolveSurfaceDefaultMultiplayerTransport,
    resolveSurfaceDefaultProviderKind,
    resolveSurfaceDeveloperPolicy,
    resolveSurfaceTransportSubset,
} from './PlatformCapabilityRegistrySurfaceHelpers.js';

export function resolvePlatformEnvironment(options = {}) {
    const surfacePolicySource = resolveSurfacePolicySource(options);
    const productSurfaceId = surfacePolicySource.productSurfaceId;
    const runtimeKind = resolvePlatformRuntimeKind(options);
    const productEntry = surfacePolicySource.productEntry;
    const surfacePolicy = surfacePolicySource.surfacePolicy && typeof surfacePolicySource.surfacePolicy === 'object'
        ? surfacePolicySource.surfacePolicy
        : {
            defaultAccessMode: PLATFORM_SURFACE_POLICY_MODES.DEFAULT_DENY,
            multiplayerRole: PLATFORM_SURFACE_MULTIPLAYER_ROLES.JOIN_ONLY,
        };
    const allowedMultiplayerTransports = resolveSurfaceAllowedMultiplayerTransports(surfacePolicy);
    const defaultMultiplayerTransport = resolveSurfaceDefaultMultiplayerTransport(
        surfacePolicy,
        allowedMultiplayerTransports
    );
    return Object.freeze({
        contractVersion: PLATFORM_CAPABILITY_REGISTRY.contractVersion,
        surfacePolicyContractVersion: PLATFORM_SURFACE_POLICY_CONTRACT_VERSION,
        productSurfaceId,
        runtimeKind,
        defaultLobbyTransport: defaultMultiplayerTransport,
        toolingSurfaceId: productEntry.toolingSurfaceId,
        defaultAccessMode: resolveSurfaceDefaultAccessMode(surfacePolicy),
        multiplayerRole: normalizeString(
            surfacePolicy.multiplayerRole,
            PLATFORM_SURFACE_MULTIPLAYER_ROLES.JOIN_ONLY
        ),
        browserDemoOverrideDiagnostics: surfacePolicySource.browserDemoOverrideDiagnostics,
    });
}

export function isDesktopProductSurface(options = {}) {
    return resolvePlatformProductSurfaceId(options) === PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP;
}

export function resolveDefaultLobbyTransport(options = {}) {
    return resolvePlatformEnvironment(options).defaultLobbyTransport;
}

export function resolveSurfacePolicy(options = {}) {
    const surfacePolicySource = resolveSurfacePolicySource(options);
    const productSurfaceId = surfacePolicySource.productSurfaceId;
    const policy = surfacePolicySource.surfacePolicy && typeof surfacePolicySource.surfacePolicy === 'object'
        ? surfacePolicySource.surfacePolicy
        : null;
    const allowedSessionTypes = resolveSurfaceAllowedSessionTypes(policy);
    const allowedMultiplayerTransports = resolveSurfaceAllowedMultiplayerTransports(policy);
    const allowedModePaths = resolveSurfaceAllowedModePaths(policy);
    const allowedQuickStartActionIds = resolveSurfaceAllowedQuickStartActionIds(policy);
    const allowedPresetIds = resolveSurfaceAllowedPresetIds(policy);
    const curatedMapKeysByModePath = resolveSurfaceCuratedMapKeysByModePath(policy);
    const allowedGameModes = Array.isArray(policy?.allowedGameModes)
        ? Object.freeze([...policy.allowedGameModes])
        : Object.freeze([]);
    const defaultMultiplayerTransport = resolveSurfaceDefaultMultiplayerTransport(
        policy,
        allowedMultiplayerTransports
    );
    const hostMultiplayerTransports = resolveSurfaceTransportSubset(
        policy?.hostMultiplayerTransports,
        allowedMultiplayerTransports,
        true
    );
    const joinMultiplayerTransports = resolveSurfaceTransportSubset(
        policy?.joinMultiplayerTransports,
        allowedMultiplayerTransports,
        true
    );
    const legacyMultiplayerTransports = resolveSurfaceTransportSubset(
        policy?.legacyMultiplayerTransports,
        Object.values(MULTIPLAYER_TRANSPORTS)
    );

    return Object.freeze({
        contractVersion: PLATFORM_SURFACE_POLICY_CONTRACT_VERSION,
        productSurfaceId,
        defaultAccessMode: resolveSurfaceDefaultAccessMode(policy),
        multiplayerRole: normalizeString(
            policy?.multiplayerRole,
            PLATFORM_SURFACE_MULTIPLAYER_ROLES.JOIN_ONLY
        ),
        allowedSessionTypes,
        defaultMultiplayerTransport,
        allowedMultiplayerTransports,
        hostMultiplayerTransports,
        joinMultiplayerTransports,
        legacyMultiplayerTransports,
        defaultModePath: resolveSurfaceDefaultModePath(policy, allowedModePaths),
        allowedGameModes,
        allowedModePaths,
        allowedQuickStartActionIds,
        allowedPresetIds,
        curatedMapKeysByModePath,
        requiresCuratedMaps: policy?.requiresCuratedMaps === true,
        browserDemoOverrideDiagnostics: surfacePolicySource.browserDemoOverrideDiagnostics,
    });
}

export function resolveSurfaceDeveloperAccess(options = {}) {
    const surfacePolicySource = resolveSurfacePolicySource(options);
    const productSurfaceId = surfacePolicySource.productSurfaceId;
    const surfacePolicy = surfacePolicySource.surfacePolicy && typeof surfacePolicySource.surfacePolicy === 'object'
        ? surfacePolicySource.surfacePolicy
        : null;
    const developerPolicy = resolveSurfaceDeveloperPolicy(surfacePolicy);
    const available = developerPolicy?.available !== false;
    const accessMode = normalizeString(
        developerPolicy?.accessMode,
        available
            ? PLATFORM_SURFACE_DEVELOPER_ACCESS_MODES.LOCAL_UNLOCK
            : PLATFORM_SURFACE_DEVELOPER_ACCESS_MODES.BLOCKED
    );
    const defaultReason = productSurfaceId === PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO
        ? PLATFORM_SURFACE_DEVELOPER_ACCESS_REASONS.DEMO_LOCAL_DEVTOOLS
        : PLATFORM_SURFACE_DEVELOPER_ACCESS_REASONS.LOCAL_DEVTOOLS;
    const reason = normalizeString(
        developerPolicy?.reason,
        available ? defaultReason : PLATFORM_SURFACE_DEVELOPER_ACCESS_REASONS.UNAVAILABLE
    );
    const message = normalizeString(
        developerPolicy?.message,
        available
            ? 'Developer-, Debug- und Training-Schalter bleiben lokale Diagnosepfade.'
            : 'Developer-, Debug- und Training-Schalter sind fuer diese Surface nicht verfuegbar.'
    );

    return Object.freeze({
        contractVersion: PLATFORM_SURFACE_POLICY_CONTRACT_VERSION,
        productSurfaceId,
        available,
        accessMode,
        reason,
        message,
        browserDemoOverrideDiagnostics: surfacePolicySource.browserDemoOverrideDiagnostics,
    });
}

export function resolveSurfaceCapabilityAccess(capabilityId, options = {}) {
    const normalizedCapabilityId = normalizeString(capabilityId, '');
    const hasCapabilityId = normalizedCapabilityId.length > 0;
    const surfacePolicySource = resolveSurfacePolicySource(options);
    const productSurfaceId = surfacePolicySource.productSurfaceId;
    const providerSpec = hasCapabilityId
        ? resolveSurfaceCapabilitySpec(normalizedCapabilityId, productSurfaceId)
        : null;
    const surfacePolicy = surfacePolicySource.surfacePolicy && typeof surfacePolicySource.surfacePolicy === 'object'
        ? surfacePolicySource.surfacePolicy
        : null;
    const defaultAccessMode = resolveSurfaceDefaultAccessMode(surfacePolicy);
    const usesDefaultPolicy = hasCapabilityId && providerSpec === null;
    const capabilityFlags = surfacePolicySource.capabilityFlags && typeof surfacePolicySource.capabilityFlags === 'object'
        ? surfacePolicySource.capabilityFlags
        : null;
    let configuredAvailable = resolveSurfaceCapabilityConfiguredAvailability(
        providerSpec,
        usesDefaultPolicy && defaultAccessMode === PLATFORM_SURFACE_POLICY_MODES.DEFAULT_FULL
    );
    if (capabilityFlags && Object.prototype.hasOwnProperty.call(capabilityFlags, normalizedCapabilityId)) {
        configuredAvailable = configuredAvailable && capabilityFlags[normalizedCapabilityId] === true;
    }
    const providerKind = usesDefaultPolicy
        ? resolveSurfaceDefaultProviderKind(productSurfaceId, defaultAccessMode)
        : resolveCapabilityProviderKind(normalizedCapabilityId, {
            productSurfaceId,
            available: configuredAvailable,
        });

    return Object.freeze({
        capabilityId: normalizedCapabilityId,
        productSurfaceId,
        available: configuredAvailable,
        providerKind,
        defaultAccessMode,
        multiplayerRole: normalizeString(
            surfacePolicy?.multiplayerRole,
            PLATFORM_SURFACE_MULTIPLAYER_ROLES.JOIN_ONLY
        ),
        resolvedByDefaultPolicy: usesDefaultPolicy,
        browserDemoOverrideDiagnostics: surfacePolicySource.browserDemoOverrideDiagnostics,
    });
}

import { PLATFORM_CAPABILITY_IDS } from '../../shared/contracts/PlatformCapabilityContract.js';
import {
    isDesktopProductSurface,
    resolveSurfacePolicy,
    resolveSurfaceCapabilityAccess,
} from '../../shared/contracts/PlatformCapabilityRegistry.js';
import { resolveElectronRuntimeSnapshot } from '../../platform/electron/ElectronPlatformBridge.js';
import { createMenuFeatureFlags } from './MenuStateContracts.js';

/* global __APP_MODE__, __APP_TARGET__ */

function resolveAppTarget() {
    return typeof __APP_TARGET__ !== 'undefined' ? String(__APP_TARGET__).trim().toLowerCase() : '';
}

export function isDesktopAppRuntime(runtimeGlobal = globalThis) {
    const appMode = typeof __APP_MODE__ !== 'undefined' ? String(__APP_MODE__).trim().toLowerCase() : 'web';
    const platformRuntimeSnapshot = resolveElectronRuntimeSnapshot(runtimeGlobal);
    return isDesktopProductSurface({
        appMode,
        appTarget: resolveAppTarget(),
        platformRuntimeSnapshot,
    });
}

export function resolveRuntimeMenuFeatureFlags(sourceFlags = null, runtimeGlobal = globalThis) {
    const featureFlags = createMenuFeatureFlags(sourceFlags);
    const appMode = typeof __APP_MODE__ !== 'undefined' ? String(__APP_MODE__).trim().toLowerCase() : 'web';
    const platformRuntimeSnapshot = resolveElectronRuntimeSnapshot(runtimeGlobal);
    const capabilityResolverOptions = {
        appMode,
        appTarget: resolveAppTarget(),
        platformRuntimeSnapshot,
        runtimeGlobal,
    };
    const surfacePolicy = resolveSurfacePolicy(capabilityResolverOptions);
    const hostCapability = resolveSurfaceCapabilityAccess(
        PLATFORM_CAPABILITY_IDS.HOST,
        capabilityResolverOptions
    );
    return {
        ...featureFlags,
        canHost: hostCapability.available,
        surfacePolicy,
    };
}

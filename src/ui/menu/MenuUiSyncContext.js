import { resolveSurfaceMenuState } from '../../shared/contracts/PlatformSurfacePolicyOps.js';
import { resolveMenuAccessContext } from './MenuAccessPolicy.js';
import { resolveRuntimeMenuFeatureFlags } from './MenuRuntimeFeatureFlags.js';

function resolveSettingsObject(settings) {
    return settings && typeof settings === 'object' ? settings : {};
}

export function resolveDeveloperReleaseState(settings = null) {
    const resolvedSettings = resolveSettingsObject(settings);
    const localSettings = resolvedSettings?.localSettings && typeof resolvedSettings.localSettings === 'object'
        ? resolvedSettings.localSettings
        : {};
    const featureEnabled = resolvedSettings?.menuFeatureFlags?.developerModeEnabled !== false;
    const releasePreviewEnabled = !!localSettings.releasePreviewEnabled;
    return {
        featureEnabled,
        releasePreviewEnabled,
        developerUiHidden: !featureEnabled,
        releaseCutEnabled: !featureEnabled || releasePreviewEnabled,
    };
}

export function resolveMenuUiSyncContext(settings = null, options = {}) {
    const resolvedSettings = resolveSettingsObject(settings);
    const runtimeFeatureFlags = resolveRuntimeMenuFeatureFlags(
        resolvedSettings?.menuFeatureFlags,
        options.runtimeGlobal
    );
    const surfacePolicy = runtimeFeatureFlags?.surfacePolicy || null;
    const surfaceMenuState = resolveSurfaceMenuState(resolvedSettings, {
        productSurfaceId: surfacePolicy?.productSurfaceId,
    });
    return {
        settings: resolvedSettings,
        accessContext: resolveMenuAccessContext(resolvedSettings),
        runtimeFeatureFlags,
        surfacePolicy,
        surfaceMenuState,
        releaseState: resolveDeveloperReleaseState(resolvedSettings),
    };
}

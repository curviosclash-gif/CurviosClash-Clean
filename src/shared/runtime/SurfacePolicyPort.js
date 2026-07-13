import {
    isSurfaceSessionTypeAllowed,
    isSurfaceModePathAllowed,
    isSurfaceMapKeyAllowedForModePath,
    isSurfacePresetAllowed,
    isSurfaceQuickStartActionAllowed,
    listSurfaceAllowedMapKeysForModePath,
    resolveSurfaceFallbackSessionType,
    resolveSurfaceFallbackModePath,
    resolveSurfaceBlockedFeatureFeedback,
    resolveSurfaceMultiplayerGateAccess,
    resolveSurfaceEntryCopy,
    applySurfaceMenuState
} from '../contracts/PlatformSurfacePolicyOps.js';
import { resolveSurfacePolicy } from '../contracts/PlatformCapabilityRegistry.js';

export function createSurfacePolicyPort(deps = {}) {
    const getProductSurfaceId = typeof deps.getProductSurfaceId === 'function' 
        ? deps.getProductSurfaceId 
        : () => '';
    
    const getSettings = typeof deps.getSettings === 'function' 
        ? deps.getSettings 
        : () => null;

    function buildOptions() {
        const productSurfaceId = getProductSurfaceId();
        if (productSurfaceId) {
            return { productSurfaceId };
        }
        
        // Fallback to reading from settings -> surfacePolicy if no explicit id is provided
        const settings = getSettings();
        const settingsSurfaceId = settings?.localSettings?.toolsState?.surfacePolicy?.productSurfaceId 
            || settings?.localSettings?.runtimeFeatureFlags?.surfacePolicy?.productSurfaceId;
        
        return { productSurfaceId: settingsSurfaceId || '' };
    }

    return Object.freeze({
        isSessionTypeAllowed: (sessionType) => isSurfaceSessionTypeAllowed(sessionType, buildOptions()),
        isModePathAllowed: (modePath) => isSurfaceModePathAllowed(modePath, buildOptions()),
        isMapAllowed: (mapKey, modePath) => isSurfaceMapKeyAllowedForModePath(mapKey, modePath, buildOptions()),
        isPresetAllowed: (presetId) => isSurfacePresetAllowed(presetId, buildOptions()),
        isQuickStartAllowed: (actionId) => isSurfaceQuickStartActionAllowed(actionId, buildOptions()),
        listAllowedMapKeysForModePath: (modePath) => listSurfaceAllowedMapKeysForModePath(modePath, buildOptions()),
        resolveMultiplayerGateAccess: (gateId) => resolveSurfaceMultiplayerGateAccess(gateId, buildOptions()),
        resolveFallbackSessionType: () => resolveSurfaceFallbackSessionType(buildOptions()),
        resolveFallbackModePath: () => resolveSurfaceFallbackModePath(buildOptions()),
        resolveBlockedFeatureFeedback: (featureLabel) => resolveSurfaceBlockedFeatureFeedback(featureLabel, buildOptions()),
        resolveEntryCopy: (sessionType) => resolveSurfaceEntryCopy({ ...buildOptions(), sessionType }),
        applyMenuState: (settingsToMutate, extraOptions = {}) => applySurfaceMenuState(settingsToMutate, { ...buildOptions(), ...extraOptions }),
        resolvePolicy: () => resolveSurfacePolicy(buildOptions())
    });
}

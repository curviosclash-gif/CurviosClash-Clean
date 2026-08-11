import {
    PLATFORM_PRODUCT_SURFACE_IDS,
    PLATFORM_RUNTIME_KINDS,
} from './PlatformCapabilityData.js';
import {
    normalizePlatformProductSurfaceId,
    normalizePlatformRuntimeKind,
    normalizeString,
} from './PlatformCapabilityRegistryNormalization.js';

export function resolvePlatformRuntimeKind(options = {}) {
    const explicitRuntimeKind = normalizePlatformRuntimeKind(options.runtimeKind, '');
    if (explicitRuntimeKind) {
        return explicitRuntimeKind;
    }
    // Kein Raw-Global-Sniffing hier: Electron-Erkennung ist Adapter-Sache
    // (resolveElectronRuntimeSnapshot in src/platform/electron/ElectronPlatformBridge.js);
    // Aufrufer reichen das Ergebnis als options.platformRuntimeSnapshot durch.
    const snapshotRuntimeKind = normalizePlatformRuntimeKind(options?.platformRuntimeSnapshot?.runtimeKind, '');
    return snapshotRuntimeKind || PLATFORM_RUNTIME_KINDS.WEB;
}

export function resolvePlatformProductSurfaceId(options = {}) {
    const explicitProductSurfaceId = normalizePlatformProductSurfaceId(options.productSurfaceId, '');
    if (explicitProductSurfaceId) {
        return explicitProductSurfaceId;
    }
    const normalizedAppTarget = normalizeString(options.appTarget, '').toLowerCase();
    if (normalizedAppTarget === 'mobile-classic') {
        return PLATFORM_PRODUCT_SURFACE_IDS.MOBILE_APP;
    }
    const normalizedAppMode = normalizeString(options.appMode, '').toLowerCase();
    if (normalizedAppMode === 'app') {
        return PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP;
    }
    return resolvePlatformRuntimeKind(options) === PLATFORM_RUNTIME_KINDS.ELECTRON
        ? PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP
        : PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO;
}

import { PLATFORM_PRODUCT_SURFACE_IDS } from '../../shared/contracts/PlatformCapabilityRegistry.js';
import {
    PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS,
    resolveSurfaceBlockedFeatureFeedback,
    resolveSurfaceFeatureClassification,
} from '../../shared/contracts/PlatformSurfacePolicyOps.js';

export function resolveSurfaceFeatureLaunchGuard(surfacePolicy, featureId, featureLabel) {
    const productSurfaceId = String(surfacePolicy?.productSurfaceId || '').trim().toLowerCase();
    if (!productSurfaceId) return Object.freeze({ allowed: true });
    const featureClassification = resolveSurfaceFeatureClassification(featureId, { productSurfaceId });
    const blockedBySurface = featureClassification.classification === PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DESKTOP_ONLY
        && productSurfaceId !== PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP;
    if (!blockedBySurface) return Object.freeze({ allowed: true, featureClassification });
    const feedback = resolveSurfaceBlockedFeatureFeedback(featureLabel, { productSurfaceId });
    return Object.freeze({
        allowed: false,
        featureClassification,
        reason: feedback.reason,
        message: feedback.message,
        tone: feedback.tone,
        duration: feedback.durationMs,
        durationMs: feedback.durationMs,
    });
}

export function syncDesktopOnlyFeatureButton(button, surfacePolicy, featureId, featureLabel) {
    if (!button) return;
    if (!button.dataset.surfaceDefaultLabel) {
        button.dataset.surfaceDefaultLabel = String(button.textContent || '').trim();
    }
    const defaultLabel = button.dataset.surfaceDefaultLabel || String(button.textContent || '').trim();
    const featureAccess = resolveSurfaceFeatureLaunchGuard(surfacePolicy, featureId, featureLabel);
    if (!surfacePolicy?.productSurfaceId) {
        button.textContent = defaultLabel;
        button.title = '';
        button.disabled = false;
        button.setAttribute('aria-disabled', 'false');
        return;
    }
    button.textContent = featureAccess.allowed ? defaultLabel : `${defaultLabel} (Nur Desktop)`;
    button.title = featureAccess.allowed
        ? String(featureAccess.featureClassification?.rationale || '')
        : String(featureAccess.message || '');
    button.disabled = !featureAccess.allowed;
    button.setAttribute('aria-disabled', String(!featureAccess.allowed));
}

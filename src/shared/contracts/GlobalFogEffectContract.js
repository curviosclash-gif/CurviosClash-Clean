import { resolveMapLighting } from './MapLightingContract.js';
import { resolveFogRange } from './ViewDistanceContract.js';

export const GLOBAL_FOG_EFFECT_DURATION_SECONDS = 8;
export const GLOBAL_FOG_CLEAR_MAP_NEAR = 5;
export const GLOBAL_FOG_CLEAR_MAP_FAR = 20;
export const GLOBAL_FOG_CAMERA_VISIBILITY_LIMIT = 200;

function toNonNegativeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, numeric) : fallback;
}

export function createGlobalFogEffectState(value = null) {
    const source = value && typeof value === 'object' ? value : {};
    const remainingSeconds = toNonNegativeNumber(source.remainingSeconds ?? source.remaining, 0);
    const visibilityRange = toNonNegativeNumber(source.visibilityRange, 0);
    return {
        active: source.active === true && remainingSeconds > 0,
        remainingSeconds,
        visibilityRange,
    };
}

export function resolveGlobalFogMapRange(mapLighting = null, cameraFar = GLOBAL_FOG_CAMERA_VISIBILITY_LIMIT) {
    const lighting = resolveMapLighting(mapLighting);
    const normalNear = toNonNegativeNumber(lighting?.fog?.near, 0);
    const normalFar = Math.max(1, toNonNegativeNumber(lighting?.fog?.far, 1));
    const clearMap = normalFar >= Math.max(1, Number(cameraFar) || GLOBAL_FOG_CAMERA_VISIBILITY_LIMIT);
    return {
        clearMap,
        near: clearMap ? GLOBAL_FOG_CLEAR_MAP_NEAR : normalNear / 3,
        far: clearMap ? GLOBAL_FOG_CLEAR_MAP_FAR : normalFar / 3,
        normalNear,
        normalFar,
    };
}

export function resolveGlobalFogRenderRange({
    mapLighting = null,
    cameraFar = GLOBAL_FOG_CAMERA_VISIBILITY_LIMIT,
    viewDistance = 0,
} = {}) {
    const itemRange = resolveGlobalFogMapRange(mapLighting, cameraFar);
    const renderedRange = resolveFogRange({
        viewDistance,
        brightnessFogFactor: 1,
        baseNear: itemRange.near,
        baseFar: itemRange.far,
    });
    return {
        ...itemRange,
        near: Math.min(itemRange.near, renderedRange.near),
        far: Math.min(itemRange.far, renderedRange.far),
    };
}

export function isWithinGlobalFogRange(observerPosition, targetPosition, visibilityRange) {
    if (!observerPosition || !targetPosition) return false;
    const range = Math.max(0, Number(visibilityRange) || 0);
    const dx = (Number(targetPosition.x) || 0) - (Number(observerPosition.x) || 0);
    const dy = (Number(targetPosition.y) || 0) - (Number(observerPosition.y) || 0);
    const dz = (Number(targetPosition.z) || 0) - (Number(observerPosition.z) || 0);
    return (dx * dx) + (dy * dy) + (dz * dz) <= range * range;
}

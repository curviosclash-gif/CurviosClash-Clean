import { normalizeWaterZone } from '../../shared/contracts/WaterZoneContract.js';

export function sanitizeWaterZone(value) {
    return value && typeof value === 'object' ? normalizeWaterZone(value) : null;
}

export function toRuntimeWaterZone(value, invScale) {
    const normalized = sanitizeWaterZone(value);
    if (!normalized) return null;
    return normalizeWaterZone({
        ...normalized,
        bounds: {
            min: normalized.bounds.min.map((entry) => entry * invScale),
            max: normalized.bounds.max.map((entry) => entry * invScale),
        },
        ...(normalized.reservoirBounds ? {
            reservoirBounds: {
                min: normalized.reservoirBounds.min.map((entry) => entry * invScale),
                max: normalized.reservoirBounds.max.map((entry) => entry * invScale),
            },
        } : {}),
        startLevel: normalized.startLevel * invScale,
        targetLevel: normalized.targetLevel * invScale,
    });
}

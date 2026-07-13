// ============================================
// ObservationNormalizeOps.js - normalization helpers for bot observations
// ============================================

import { clamp, clamp01 } from '../../../utils/MathOps.js';
export { clamp, clamp01 };

export function toBinaryFlag(value) {
    return value ? 1 : 0;
}

export function normalizeRatio(value, baseline, fallback = 0) {
    const numericValue = Number(value);
    const numericBaseline = Number(baseline);
    if (!Number.isFinite(numericValue) || !Number.isFinite(numericBaseline) || numericBaseline <= 0) {
        return clamp01(fallback);
    }
    return clamp01(numericValue / numericBaseline);
}

export function normalizeSigned(value, min = -1, max = 1, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return clamp(fallback, min, max);
    return clamp(numeric, min, max);
}

export function normalizeDistanceRatio(distance, maxDistance, fallback = 1) {
    const numericDistance = Number(distance);
    const numericMaxDistance = Number(maxDistance);
    if (!Number.isFinite(numericDistance) || !Number.isFinite(numericMaxDistance) || numericMaxDistance <= 0) {
        return clamp01(fallback);
    }
    return clamp01(numericDistance / numericMaxDistance);
}

export function normalizeSpeedRatio(speed, baseSpeed) {
    return normalizeRatio(speed, baseSpeed, 1);
}

export function normalizeHealthRatio(hp, maxHp) {
    return normalizeRatio(hp, maxHp, 1);
}

export function normalizeShieldRatio(shieldHp, maxShieldHp) {
    return normalizeRatio(shieldHp, maxShieldHp, 0);
}

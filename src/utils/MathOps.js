// ============================================
// MathOps.js - shared math utility functions
// ============================================

/**
 * Clamp a numeric value to [min, max]. Non-finite inputs return min.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

/**
 * Clamp a numeric value to [0, 1].
 * @param {number} value
 * @returns {number}
 */
export function clamp01(value) {
    return clamp(value, 0, 1);
}

/**
 * Coerce to finite number; return fallback for NaN/Infinity/non-numeric values.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

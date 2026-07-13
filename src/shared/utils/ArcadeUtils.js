/**
 * Shared utility functions for Arcade modules.
 * Extracted from duplicated implementations across ArcadeRunState, ArcadeScoreOps,
 * ArcadeMissionState, ArcadeMapProgression, ArcadeEncounterCatalog, ArcadeVehicleProfile.
 */

/**
 * Parse a value to a finite number, returning fallback if not finite.
 * @param {*} value
 * @param {number} [fallback=0]
 * @returns {number}
 */
export function toSafeNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Clamp a numeric value between min and max. Non-finite values use fallback.
 * @param {*} value
 * @param {number} min
 * @param {number} max
 * @param {number} [fallback]
 * @returns {number}
 */
export function clampNumber(value, min, max, fallback) {
    const parsed = toSafeNumber(value, fallback);
    return Math.max(min, Math.min(max, parsed));
}

/**
 * Clamp a value to an integer between min and max.
 * @param {*} value
 * @param {number} min
 * @param {number} max
 * @param {number} [fallback]
 * @returns {number}
 */
export function clampInteger(value, min, max, fallback) {
    return Math.floor(clampNumber(value, min, max, fallback));
}

/**
 * FNV-1a hash of a seed string, producing a 32-bit unsigned integer.
 * @param {*} seed
 * @param {string} [defaultText='arcade-default']
 * @returns {number}
 */
export function normalizeSeed(seed, defaultText = 'arcade-default') {
    const text = String(seed ?? defaultText);
    let hash = 2166136261 >>> 0;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash >>> 0;
}

/**
 * Create a seeded pseudo-random number generator (LCG).
 * @param {*} seed
 * @param {string} [defaultText='arcade-default']
 * @returns {() => number} Returns values in [0, 1)
 */
export function createSeededRandom(seed, defaultText = 'arcade-default') {
    let state = normalizeSeed(seed, defaultText) || 1;
    return () => {
        state = Math.imul(1664525, state) + 1013904223;
        state >>>= 0;
        return state / 0x100000000;
    };
}

/**
 * Compute a deterministic integer seed from a UTC calendar date.
 * All players on the same calendar day get the same seed.
 * @param {Date|string|null} [date=null] - Date to use (defaults to current UTC date)
 * @returns {number} Positive integer seed (e.g., 20260327 for 2026-03-27)
 */
export function computeDailySeed(date = null) {
    const d = date instanceof Date ? date : (date ? new Date(date) : new Date());
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    return year * 10000 + month * 100 + day;
}

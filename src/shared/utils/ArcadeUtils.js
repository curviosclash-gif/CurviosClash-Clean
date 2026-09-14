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
 * Round a value down to an integer, returning fallback if not finite.
 * @param {*} value
 * @param {number} [fallback=0]
 * @returns {number}
 */
export function toSafeInt(value, fallback = 0) {
    const parsed = Math.floor(Number(value));
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

// The daily turns over at midnight German time, not UTC, which would switch at 01:00 or 02:00 local.
const DAILY_SEED_TIME_ZONE = 'Europe/Berlin';
let dailySeedDateFormat;

function resolveDailySeedDateFormat() {
    if (dailySeedDateFormat !== undefined) return dailySeedDateFormat;
    try {
        dailySeedDateFormat = new Intl.DateTimeFormat('en-CA', {
            timeZone: DAILY_SEED_TIME_ZONE, year: 'numeric', month: 'numeric', day: 'numeric',
        });
    } catch {
        // A runtime without time zone data falls back to UTC rather than failing the menu.
        dailySeedDateFormat = null;
    }
    return dailySeedDateFormat;
}

/**
 * Compute a deterministic integer seed from the calendar date in Germany (Europe/Berlin).
 * All players on the same calendar day get the same seed.
 * @param {Date|string|null} [date=null] - Date to use (defaults to now)
 * @returns {number} Positive integer seed (e.g., 20260327 for 2026-03-27)
 */
export function computeDailySeed(date = null) {
    const d = date instanceof Date ? date : (date ? new Date(date) : new Date());
    const format = resolveDailySeedDateFormat();
    if (!format) return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    const parts = {};
    for (const part of format.formatToParts(d)) parts[part.type] = Number(part.value);
    return parts.year * 10000 + parts.month * 100 + parts.day;
}

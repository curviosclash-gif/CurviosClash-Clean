// German display formatting for the post-match scoreboard.
//
// The stats contract (src/shared/contracts/PostMatchStatsContract.js, v2) hands over raw numbers
// plus a type ('duration', 'percent', 'count', 'distance', 'ratio', 'text'). Turning such a value
// into visible text is presentation, so it lives here and not in the contract: the round board, the
// match board and the arcade panels all call the same functions and therefore write "12,5 s",
// "1:05", "25 %" and "1.250 m" the same way.
//
// Pure functions only — no DOM, no runtime access. Two rules are worth remembering:
// - `percent` receives a fraction, so 0.25 is 25 %.
// - Number and unit are joined by a non-breaking space (U+00A0) so the unit never wraps alone.

/** Shown instead of a number whenever the value is missing or broken. Never "NaN". */
export const POST_MATCH_VALUE_PLACEHOLDER = '–';

const NON_BREAKING_SPACE = '\u00a0';
const LOCALE = 'de-DE';

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const METRES_PER_KILOMETRE = 1000;
// From this distance on, metres stop being readable and the board switches to kilometres.
const KILOMETRE_THRESHOLD_METRES = 10000;
const KILOMETRE_PRECISION = 1;

const MIN_PRECISION = 0;
const MAX_PRECISION = 3;

// Mirrors the per-type defaults of PostMatchStatsContract, used whenever a row carries no precision.
const DEFAULT_PRECISION = Object.freeze({
    duration: 1,
    percent: 0,
    count: 0,
    distance: 0,
    ratio: 1,
    text: 0,
});

/**
 * One Intl.NumberFormat per precision. Building one costs far more than formatting with it, and the
 * board formats dozens of values per round end.
 * @type {Map<number, Intl.NumberFormat>}
 */
const numberFormatterCache = new Map();

/**
 * @param {number} precision decimals, already clamped
 * @returns {Intl.NumberFormat}
 */
export function getPostMatchNumberFormatter(precision) {
    const decimals = clampPrecision(precision, 0);
    const cached = numberFormatterCache.get(decimals);
    if (cached) return cached;
    const formatter = new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping: true,
    });
    numberFormatterCache.set(decimals, formatter);
    return formatter;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function clampPrecision(value, fallback) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(MIN_PRECISION, Math.min(MAX_PRECISION, Math.trunc(numeric)));
}

/**
 * Anything that is not a finite number becomes `null`, so every caller has one place to decide on
 * the placeholder instead of leaking "NaN" onto the board.
 * @param {unknown} value
 * @returns {number|null}
 */
function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

/**
 * @param {number} value
 * @param {number} decimals
 * @returns {number}
 */
function roundToPrecision(value, decimals) {
    const factor = 10 ** decimals;
    const rounded = Math.round(Math.abs(value) * factor) / factor;
    return value < 0 ? -rounded : rounded;
}

/**
 * @param {number} value
 * @param {number} decimals
 * @returns {string}
 */
function formatNumber(value, decimals) {
    // Avoids a stray "-0,0" for values that round away to zero.
    const safe = Object.is(value, -0) ? 0 : value;
    return getPostMatchNumberFormatter(decimals).format(safe);
}

/**
 * @param {number} value
 * @returns {string}
 */
function padTwoDigits(value) {
    return String(value).padStart(2, '0');
}

/**
 * Seconds as "12,5 s" below a minute, "1:05" below an hour and "1:02:05" from an hour on.
 *
 * The order matters: the value is rounded to its decimals *first*, so 59,96 s does not appear as
 * "60,0 s" but flips into the minute form ("1:00"). The minute form rounds to whole seconds before
 * splitting, which is why ":60" can never appear.
 * @param {unknown} seconds
 * @param {unknown} [precision]
 * @returns {string}
 */
export function formatDuration(seconds, precision) {
    const numeric = toFiniteNumber(seconds);
    if (numeric === null || numeric < 0) return POST_MATCH_VALUE_PLACEHOLDER;
    const decimals = clampPrecision(precision, DEFAULT_PRECISION.duration);
    const rounded = roundToPrecision(numeric, decimals);
    if (rounded < SECONDS_PER_MINUTE) {
        return `${formatNumber(rounded, decimals)}${NON_BREAKING_SPACE}s`;
    }
    const totalSeconds = Math.round(numeric);
    const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
    const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    const restSeconds = totalSeconds % SECONDS_PER_MINUTE;
    if (hours > 0) {
        return `${hours}:${padTwoDigits(minutes)}:${padTwoDigits(restSeconds)}`;
    }
    return `${minutes}:${padTwoDigits(restSeconds)}`;
}

/**
 * Takes a fraction: 0.256 becomes "26 %", with precision 1 "25,6 %".
 * @param {unknown} fraction
 * @param {unknown} [precision]
 * @returns {string}
 */
export function formatPercent(fraction, precision) {
    const numeric = toFiniteNumber(fraction);
    if (numeric === null) return POST_MATCH_VALUE_PLACEHOLDER;
    const decimals = clampPrecision(precision, DEFAULT_PRECISION.percent);
    return `${formatNumber(numeric * 100, decimals)}${NON_BREAKING_SPACE}%`;
}

/**
 * Whole numbers with a thousands dot: 1250 becomes "1.250".
 * @param {unknown} value
 * @returns {string}
 */
export function formatCount(value) {
    const numeric = toFiniteNumber(value);
    if (numeric === null) return POST_MATCH_VALUE_PLACEHOLDER;
    return formatNumber(Math.round(numeric), DEFAULT_PRECISION.count);
}

/**
 * Metres with a thousands dot, kilometres with one decimal from 10 000 m on. The unit is decided on
 * the already rounded value, so 9999,6 m shows up as "10,0 km" rather than "10.000 m".
 * @param {unknown} metres
 * @param {unknown} [precision]
 * @returns {string}
 */
export function formatDistance(metres, precision) {
    const numeric = toFiniteNumber(metres);
    if (numeric === null) return POST_MATCH_VALUE_PLACEHOLDER;
    const decimals = clampPrecision(precision, DEFAULT_PRECISION.distance);
    const rounded = roundToPrecision(numeric, decimals);
    if (Math.abs(rounded) >= KILOMETRE_THRESHOLD_METRES) {
        const kilometres = rounded / METRES_PER_KILOMETRE;
        return `${formatNumber(kilometres, KILOMETRE_PRECISION)}${NON_BREAKING_SPACE}km`;
    }
    return `${formatNumber(rounded, decimals)}${NON_BREAKING_SPACE}m`;
}

/**
 * A bare number that may go below zero (deltas, multipliers). The sign is kept.
 * @param {unknown} value
 * @param {unknown} [precision]
 * @returns {string}
 */
export function formatRatio(value, precision) {
    const numeric = toFiniteNumber(value);
    if (numeric === null) return POST_MATCH_VALUE_PLACEHOLDER;
    return formatNumber(numeric, clampPrecision(precision, DEFAULT_PRECISION.ratio));
}

/**
 * Text rows are shown as written; only a missing value falls back to the placeholder.
 * @param {unknown} value
 * @returns {string}
 */
export function formatText(value) {
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return POST_MATCH_VALUE_PLACEHOLDER;
}

/**
 * Formats one value row of the v2 stats contract. Unknown types are read as text, so a newer
 * producer never breaks an older board.
 * @param {{ value?: unknown, type?: unknown, precision?: unknown }|null|undefined} row
 * @returns {string}
 */
export function formatPostMatchValue(row) {
    if (!row || typeof row !== 'object') return POST_MATCH_VALUE_PLACEHOLDER;
    const type = typeof row.type === 'string' ? row.type : 'text';
    switch (type) {
        case 'duration':
            return formatDuration(row.value, row.precision);
        case 'percent':
            return formatPercent(row.value, row.precision);
        case 'count':
            return formatCount(row.value);
        case 'distance':
            return formatDistance(row.value, row.precision);
        case 'ratio':
            return formatRatio(row.value, row.precision);
        default:
            return formatText(row.value);
    }
}

/**
 * Shared normalization helpers for contract files.
 *
 * All contract normalization goes through these utilities so that
 * the logic doesn't drift across individual contract files.
 */

/**
 * Trims a string value and returns the fallback if the result is empty.
 * Does not lowercase — use `.toLowerCase()` at the call site when needed.
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

/**
 * Trims a text value and returns the fallback if the result is empty.
 * Alias for normalizeString; use when the value is human-readable text
 * rather than an identifier, for clarity at the call site.
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeText(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

export const VIEWPORT_LAYOUTS = Object.freeze({
    SINGLE: 'single',
    TWO_COLUMNS: 'two_columns',
    FOUR_GRID: 'four_grid',
});

/** @typedef {typeof VIEWPORT_LAYOUTS[keyof typeof VIEWPORT_LAYOUTS]} ViewportLayout */

/** @type {Set<string>} */
const VALID_VIEWPORT_LAYOUTS = new Set(Object.values(VIEWPORT_LAYOUTS));

/**
 * @param {unknown} value
 * @param {ViewportLayout} [fallback]
 * @returns {ViewportLayout}
 */
export function normalizeViewportLayout(value, fallback = VIEWPORT_LAYOUTS.SINGLE) {
    const normalizedFallback = VALID_VIEWPORT_LAYOUTS.has(fallback)
        ? fallback
        : VIEWPORT_LAYOUTS.SINGLE;
    const candidate = String(value || '').trim().toLowerCase();
    return VALID_VIEWPORT_LAYOUTS.has(candidate)
        ? /** @type {ViewportLayout} */ (candidate)
        : normalizedFallback;
}

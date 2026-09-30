export const VIEWPORT_LAYOUTS = Object.freeze({
    SINGLE: 'single',
    TWO_COLUMNS: 'two_columns',
    THREE_COLUMNS: 'three_columns',
    THREE_ROWS: 'three_rows',
    FOUR_GRID: 'four_grid',
});

/** @typedef {typeof VIEWPORT_LAYOUTS[keyof typeof VIEWPORT_LAYOUTS]} ViewportLayout */

/** @type {Set<string>} */
const VALID_VIEWPORT_LAYOUTS = new Set(Object.values(VIEWPORT_LAYOUTS));

/**
 * Screen area of the first local player as fractions of the canvas, top-left origin like
 * the DOM crosshairs: left column, top row or top-left quarter.
 * @param {unknown} layout
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
export function resolveFirstViewportFraction(layout) {
    switch (normalizeViewportLayout(layout)) {
    case VIEWPORT_LAYOUTS.TWO_COLUMNS: return { x: 0, y: 0, width: 0.5, height: 1 };
    case VIEWPORT_LAYOUTS.THREE_COLUMNS: return { x: 0, y: 0, width: 1 / 3, height: 1 };
    case VIEWPORT_LAYOUTS.THREE_ROWS: return { x: 0, y: 0, width: 1, height: 1 / 3 };
    case VIEWPORT_LAYOUTS.FOUR_GRID: return { x: 0, y: 0, width: 0.5, height: 0.5 };
    default: return { x: 0, y: 0, width: 1, height: 1 };
    }
}

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

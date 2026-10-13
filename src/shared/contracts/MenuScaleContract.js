// Menu size in percent. 100 keeps the design size; the tokens in MenuTokens.css only scale upwards
// from their 16 px floor, so the setting never makes text smaller.
export const MENU_SCALE_MIN = 100;
export const MENU_SCALE_MAX = 150;
export const MENU_SCALE_STEP = 10;
export const DEFAULT_MENU_SCALE = MENU_SCALE_MIN;

/** @param {unknown} value */
function parsePercent(value) {
    return value === null || value === undefined || value === '' ? NaN : Number(value);
}

/** @param {number} numeric */
function toStep(numeric) {
    const stepped = Math.round(numeric / MENU_SCALE_STEP) * MENU_SCALE_STEP;
    return Math.min(MENU_SCALE_MAX, Math.max(MENU_SCALE_MIN, stepped));
}

/**
 * @param {unknown} value
 * @param {unknown} [fallback]
 */
export function normalizeMenuScale(value, fallback = DEFAULT_MENU_SCALE) {
    const numeric = parsePercent(value);
    if (Number.isFinite(numeric)) return toStep(numeric);
    const fallbackNumeric = parsePercent(fallback);
    return Number.isFinite(fallbackNumeric) ? toStep(fallbackNumeric) : DEFAULT_MENU_SCALE;
}

/** Factor for the --menu-scale CSS variable, e.g. 120 -> 1.2. */
/** @param {unknown} value */
export function resolveMenuScaleFactor(value) {
    return normalizeMenuScale(value) / 100;
}

/** @param {unknown} value */
export function resolveMenuScaleLabel(value) {
    return `${normalizeMenuScale(value)}%`;
}

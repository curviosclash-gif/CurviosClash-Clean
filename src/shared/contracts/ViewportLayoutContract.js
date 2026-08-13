export const VIEWPORT_LAYOUTS = Object.freeze({
    SINGLE: 'single',
    TWO_COLUMNS: 'two_columns',
    FOUR_GRID: 'four_grid',
});

const VALID_VIEWPORT_LAYOUTS = new Set(Object.values(VIEWPORT_LAYOUTS));

export function normalizeViewportLayout(value, fallback = VIEWPORT_LAYOUTS.SINGLE) {
    const normalizedFallback = VALID_VIEWPORT_LAYOUTS.has(fallback)
        ? fallback
        : VIEWPORT_LAYOUTS.SINGLE;
    const candidate = String(value || '').trim().toLowerCase();
    return VALID_VIEWPORT_LAYOUTS.has(candidate) ? candidate : normalizedFallback;
}

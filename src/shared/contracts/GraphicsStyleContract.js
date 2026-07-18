export const GRAPHICS_STYLES = Object.freeze({
    CLASSIC: 'classic',
    MODERN: 'modern',
});

export function normalizeGraphicsStyle(value, fallback = GRAPHICS_STYLES.MODERN) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === GRAPHICS_STYLES.CLASSIC || normalized === GRAPHICS_STYLES.MODERN) {
        return normalized;
    }
    return fallback === GRAPHICS_STYLES.CLASSIC ? GRAPHICS_STYLES.CLASSIC : GRAPHICS_STYLES.MODERN;
}

export function isModernGraphicsStyle(value) {
    return normalizeGraphicsStyle(value) === GRAPHICS_STYLES.MODERN;
}

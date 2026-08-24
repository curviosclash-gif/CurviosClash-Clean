export const MAP_BRIGHTNESS_LEVELS = Object.freeze({
    DARK: 'dunkel',
    MEDIUM: 'mittel',
    BRIGHT: 'hell',
});

export const DEFAULT_MAP_BRIGHTNESS = MAP_BRIGHTNESS_LEVELS.MEDIUM;

export const MAP_BRIGHTNESS_ORDER = Object.freeze([
    MAP_BRIGHTNESS_LEVELS.DARK,
    MAP_BRIGHTNESS_LEVELS.MEDIUM,
    MAP_BRIGHTNESS_LEVELS.BRIGHT,
]);

// Faktoren auf die Basiswerte des Grafikstils. Ambient ist staerker gewichtet als die
// Belichtung: das hebt dunkle Bereiche an, ohne dass helle Flaechen bei 'hell' ausbrennen.
//
// 'dunkel' ist bewusst eine Nachtstimmung: Ambient faellt stark ab, sodass nur noch das
// gerichtete Key-Light traegt (harte Kontraste, schwarze Schatten). Die Helligkeit aendert
// die Sichtweite nicht; kurze Sichtweite wird ausschliesslich ueber den Sichtweitenregler
// eingestellt.
const MAP_BRIGHTNESS_FACTORS = Object.freeze({
    [MAP_BRIGHTNESS_LEVELS.DARK]: Object.freeze({ exposure: 0.62, ambient: 0.28, fog: 1 }),
    [MAP_BRIGHTNESS_LEVELS.MEDIUM]: Object.freeze({ exposure: 1, ambient: 1, fog: 1 }),
    [MAP_BRIGHTNESS_LEVELS.BRIGHT]: Object.freeze({ exposure: 1.3, ambient: 1.55, fog: 1 }),
});

const MAP_BRIGHTNESS_LABELS = Object.freeze({
    [MAP_BRIGHTNESS_LEVELS.DARK]: 'Dunkel',
    [MAP_BRIGHTNESS_LEVELS.MEDIUM]: 'Mittel',
    [MAP_BRIGHTNESS_LEVELS.BRIGHT]: 'Hell',
});

export function normalizeMapBrightness(value, fallback = DEFAULT_MAP_BRIGHTNESS) {
    const normalized = String(value || '').trim().toLowerCase();
    if (MAP_BRIGHTNESS_ORDER.some((level) => level === normalized)) {
        return normalized;
    }
    const normalizedFallback = String(fallback || '').trim().toLowerCase();
    return MAP_BRIGHTNESS_ORDER.some((level) => level === normalizedFallback)
        ? normalizedFallback
        : DEFAULT_MAP_BRIGHTNESS;
}

export function resolveMapBrightnessFactors(value) {
    return MAP_BRIGHTNESS_FACTORS[normalizeMapBrightness(value)];
}

export function resolveMapBrightnessLabel(value) {
    return MAP_BRIGHTNESS_LABELS[normalizeMapBrightness(value)];
}

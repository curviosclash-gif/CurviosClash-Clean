// Sichtweite in Welteinheiten. 0 bedeutet 'Automatisch': dann bestimmt die
// Karten-Helligkeit die Sichtweite ('dunkel' rueckt den Fog fuer Nachtstimmung heran).
// Jeder Wert > 0 ueberschreibt das und gilt unabhaengig von der Helligkeitsstufe.
export const VIEW_DISTANCE_AUTO = 0;
export const VIEW_DISTANCE_MIN = 20;
// CONFIG.CAMERA.FAR liegt bei 200 - jenseits davon wird ohnehin weggeschnitten.
export const VIEW_DISTANCE_MAX = 190;
export const VIEW_DISTANCE_STEP = 10;

export const DEFAULT_VIEW_DISTANCE = VIEW_DISTANCE_AUTO;

export function normalizeViewDistance(value, fallback = DEFAULT_VIEW_DISTANCE) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return Number.isFinite(Number(fallback)) ? normalizeViewDistance(fallback) : DEFAULT_VIEW_DISTANCE;
    }
    if (numeric <= 0) return VIEW_DISTANCE_AUTO;

    const stepped = Math.round(numeric / VIEW_DISTANCE_STEP) * VIEW_DISTANCE_STEP;
    return Math.min(VIEW_DISTANCE_MAX, Math.max(VIEW_DISTANCE_MIN, stepped));
}

export function isAutomaticViewDistance(value) {
    return normalizeViewDistance(value) === VIEW_DISTANCE_AUTO;
}

export function resolveViewDistanceLabel(value) {
    const normalized = normalizeViewDistance(value);
    return normalized === VIEW_DISTANCE_AUTO ? 'Automatisch' : String(normalized);
}

// Liefert die konkrete Fog-Spanne. Der Grafikstil gibt die Basis vor, die Helligkeitsstufe
// einen Faktor darauf - eine explizite Sichtweite ersetzt beides fuer die Reichweite.
// Der Fog-Beginn skaliert proportional mit, damit der Verlauf seine Form behaelt.
export function resolveFogRange({ viewDistance, brightnessFogFactor = 1, baseNear, baseFar }) {
    const safeBaseFar = Number(baseFar) > 0 ? Number(baseFar) : 1;
    const safeBaseNear = Number(baseNear) >= 0 ? Number(baseNear) : 0;
    const normalized = normalizeViewDistance(viewDistance);
    const far = normalized === VIEW_DISTANCE_AUTO
        ? safeBaseFar * (Number(brightnessFogFactor) || 1)
        : normalized;
    return { near: far * (safeBaseNear / safeBaseFar), far };
}

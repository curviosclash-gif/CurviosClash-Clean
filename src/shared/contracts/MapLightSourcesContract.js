// Point lights a map places in its own world, for interiors that have to glow from inside and spill
// out through their openings. The global profile in MapLightingContract shapes the whole scene from
// outside - key, fill, rim, sky - and cannot light one room. This is the local counterpart.
//
// Positions are authored in the same space as playerSpawn and the aircraft decorations, so a map
// with scaleAuthoredAnchors gets them scaled the same way.

const INTENSITY_MAX = 100000;
const DISTANCE_MAX = 4000;
const DECAY_MAX = 4;

export const DEFAULT_MAP_LIGHT_SOURCE = Object.freeze({
    id: null,
    x: 0,
    y: 0,
    z: 0,
    color: 0xffffff,
    intensity: 100,
    // 0 would mean "never falls off", which lets one interior lamp brighten the whole map. A map has
    // to state a range.
    distance: 60,
    decay: 2,
});

function normalizeNumber(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
}

function normalizeColor(value, fallback) {
    if (typeof value === 'string') {
        const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
        if (match) return Number.parseInt(match[1], 16);
        return fallback;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(0xffffff, Math.max(0, Math.round(numeric)));
}

/** @param {unknown} source */
export function normalizeMapLightSource(source) {
    const entry = source && typeof source === 'object' ? source : {};
    const id = typeof entry.id === 'string' && entry.id.trim().length > 0 ? entry.id.trim() : null;
    return Object.freeze({
        id,
        x: normalizeNumber(entry.x, DEFAULT_MAP_LIGHT_SOURCE.x, -DISTANCE_MAX, DISTANCE_MAX),
        y: normalizeNumber(entry.y, DEFAULT_MAP_LIGHT_SOURCE.y, -DISTANCE_MAX, DISTANCE_MAX),
        z: normalizeNumber(entry.z, DEFAULT_MAP_LIGHT_SOURCE.z, -DISTANCE_MAX, DISTANCE_MAX),
        color: normalizeColor(entry.color, DEFAULT_MAP_LIGHT_SOURCE.color),
        intensity: normalizeNumber(entry.intensity, DEFAULT_MAP_LIGHT_SOURCE.intensity, 0, INTENSITY_MAX),
        distance: normalizeNumber(entry.distance, DEFAULT_MAP_LIGHT_SOURCE.distance, 0.01, DISTANCE_MAX),
        decay: normalizeNumber(entry.decay, DEFAULT_MAP_LIGHT_SOURCE.decay, 0, DECAY_MAX),
    });
}

// Every extra point light costs shader work on every lit surface in the scene, so the count is
// capped here rather than left to whoever authors a map.
export const MAP_LIGHT_SOURCE_LIMIT = 8;

/** @param {unknown} source */
export function normalizeMapLightSources(source) {
    if (!Array.isArray(source)) return Object.freeze([]);
    return Object.freeze(
        source
            .filter((entry) => entry && typeof entry === 'object')
            .slice(0, MAP_LIGHT_SOURCE_LIMIT)
            .map(normalizeMapLightSource)
    );
}

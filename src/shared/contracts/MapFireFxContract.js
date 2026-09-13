const MAX_EMITTERS = 8;
const MAX_FLICKER_LIGHTS = 8;
const MAX_PARTICLES_PER_LAYER = 128;

function clamp(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
}

function normalizeColor(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(0xffffff, Math.max(0, Math.round(numeric)));
}

function normalizeVector(source, fallback, min = -1000, max = 1000) {
    const values = Array.isArray(source) ? source : fallback;
    return Object.freeze([
        clamp(values[0], fallback[0], min, max),
        clamp(values[1], fallback[1], min, max),
        clamp(values[2], fallback[2], min, max),
    ]);
}

function normalizeEmitter(source) {
    const entry = source && typeof source === 'object' ? source : {};
    return Object.freeze({
        position: normalizeVector(entry.position, [0, 0, 0]),
        radius: clamp(entry.radius, 8, 0.1, 200),
        smokeHeight: clamp(entry.smokeHeight, 60, 1, 400),
        emberHeight: clamp(entry.emberHeight, 28, 1, 200),
        phase: clamp(entry.phase, 0, 0, 1),
    });
}

function normalizeFlicker(source) {
    const entry = source && typeof source === 'object' ? source : {};
    const lightId = typeof entry.lightId === 'string' ? entry.lightId.trim() : '';
    return Object.freeze({
        lightId,
        amplitude: clamp(entry.amplitude, 0.1, 0, 0.25),
        frequency: clamp(entry.frequency, 1.5, 0.1, 8),
        phase: clamp(entry.phase, 0, 0, Math.PI * 2),
    });
}

function normalizeLayer(source, defaults) {
    const entry = source && typeof source === 'object' ? source : {};
    return Object.freeze({
        count: Math.round(clamp(entry.count, defaults.count, 0, MAX_PARTICLES_PER_LAYER)),
        color: normalizeColor(entry.color, defaults.color),
        size: clamp(entry.size, defaults.size, 0.05, 30),
        lifetime: clamp(entry.lifetime, defaults.lifetime, 0.25, 60),
        opacity: clamp(entry.opacity, defaults.opacity, 0, 1),
    });
}

/**
 * Normalizes the optional, arena-local fire presentation authored by a map.
 * The result is immutable so build and replay code cannot drift the profile at runtime.
 * @param {unknown} source
 */
export function normalizeMapFireFx(source) {
    if (!source || typeof source !== 'object') return null;
    const emitters = (Array.isArray(source.emitters) ? source.emitters : [])
        .filter((entry) => entry && typeof entry === 'object')
        .slice(0, MAX_EMITTERS)
        .map(normalizeEmitter);
    if (emitters.length === 0) return null;

    const flicker = (Array.isArray(source.flicker) ? source.flicker : [])
        .filter((entry) => entry && typeof entry === 'object')
        .slice(0, MAX_FLICKER_LIGHTS)
        .map(normalizeFlicker)
        .filter((entry) => entry.lightId && entry.amplitude > 0);

    return Object.freeze({
        emitters: Object.freeze(emitters),
        smoke: normalizeLayer(source.smoke, {
            count: 42, color: 0x2a1714, size: 9, lifetime: 10, opacity: 0.2,
        }),
        embers: normalizeLayer(source.embers, {
            count: 48, color: 0xff7a24, size: 0.65, lifetime: 4.5, opacity: 0.9,
        }),
        ash: normalizeLayer(source.ash, {
            count: 64, color: 0xb8aaa0, size: 0.38, lifetime: 12, opacity: 0.5,
        }),
        wind: normalizeVector(source.wind, [-2.4, 0.7, 1.2], -50, 50),
        ashVolumeMin: normalizeVector(source.ashVolumeMin, [-110, 4, -75]),
        ashVolumeMax: normalizeVector(source.ashVolumeMax, [105, 105, 75]),
        flicker: Object.freeze(flicker),
    });
}

export const MAP_FIRE_FX_LIMITS = Object.freeze({
    maxEmitters: MAX_EMITTERS,
    maxFlickerLights: MAX_FLICKER_LIGHTS,
    maxParticlesPerLayer: MAX_PARTICLES_PER_LAYER,
});

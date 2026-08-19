const COLOR_MIN = 0x000000;
const COLOR_MAX = 0xffffff;
const DIRECTION_COMPONENT_LIMIT = 100;
const LIGHT_INTENSITY_MAX = 4;
const FOG_DISTANCE_MAX = 200;
const EXPOSURE_OFFSET_LIMIT = 0.5;

function freezeLight(light) {
    return Object.freeze({
        direction: Object.freeze([...light.direction]),
        color: light.color,
        intensity: light.intensity,
    });
}

export const DEFAULT_MAP_LIGHTING = Object.freeze({
    key: freezeLight({ direction: [30, 50, 30], color: 0xfff4e8, intensity: 1.35 }),
    fill: freezeLight({ direction: [-20, 30, -10], color: 0x4f86d9, intensity: 0.32 }),
    rim: freezeLight({ direction: [-35, 18, -45], color: 0x39d9ff, intensity: 0.62 }),
    hemisphere: Object.freeze({ skyColor: 0x9bc8ff, groundColor: 0x334466 }),
    fog: Object.freeze({ color: 0x0b1020, near: 55, far: 190 }),
    skyDome: Object.freeze({
        zenithColor: 0x02050f,
        horizonColor: 0x17355a,
        nadirColor: 0x070914,
    }),
    starsVisible: true,
    exposureOffset: 0,
});

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeNumber(value, fallback, min, max) {
    const numeric = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
}

function normalizeColor(value, fallback) {
    let numeric = value;
    if (typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value.trim())) {
        numeric = Number.parseInt(value.trim().replace('#', ''), 16);
    }
    return Math.round(normalizeNumber(numeric, fallback, COLOR_MIN, COLOR_MAX));
}

function normalizeDirection(value, fallback) {
    if (!Array.isArray(value) || value.length !== 3) return [...fallback];
    const direction = value.map((component, index) => normalizeNumber(
        component,
        fallback[index],
        -DIRECTION_COMPONENT_LIMIT,
        DIRECTION_COMPONENT_LIMIT,
    ));
    return direction.some((component) => component !== 0) ? direction : [...fallback];
}

function normalizeLight(value, fallback) {
    const source = asObject(value);
    return {
        direction: normalizeDirection(source.direction, fallback.direction),
        color: normalizeColor(source.color, fallback.color),
        intensity: normalizeNumber(source.intensity, fallback.intensity, 0, LIGHT_INTENSITY_MAX),
    };
}

export function normalizeMapLighting(value, fallback = DEFAULT_MAP_LIGHTING) {
    const safeFallback = fallback === DEFAULT_MAP_LIGHTING
        ? DEFAULT_MAP_LIGHTING
        : normalizeMapLighting(fallback, DEFAULT_MAP_LIGHTING);
    const source = asObject(value);
    const hemisphere = asObject(source.hemisphere);
    const fog = asObject(source.fog);
    const skyDome = asObject(source.skyDome);
    const fogFar = normalizeNumber(fog.far, safeFallback.fog.far, 1, FOG_DISTANCE_MAX);
    const fogNear = normalizeNumber(fog.near, safeFallback.fog.near, 0, FOG_DISTANCE_MAX);

    return {
        key: normalizeLight(source.key, safeFallback.key),
        fill: normalizeLight(source.fill, safeFallback.fill),
        rim: normalizeLight(source.rim, safeFallback.rim),
        hemisphere: {
            skyColor: normalizeColor(hemisphere.skyColor, safeFallback.hemisphere.skyColor),
            groundColor: normalizeColor(hemisphere.groundColor, safeFallback.hemisphere.groundColor),
        },
        fog: {
            color: normalizeColor(fog.color, safeFallback.fog.color),
            near: Math.min(fogNear, fogFar),
            far: fogFar,
        },
        skyDome: {
            zenithColor: normalizeColor(skyDome.zenithColor, safeFallback.skyDome.zenithColor),
            horizonColor: normalizeColor(skyDome.horizonColor, safeFallback.skyDome.horizonColor),
            nadirColor: normalizeColor(skyDome.nadirColor, safeFallback.skyDome.nadirColor),
        },
        starsVisible: typeof source.starsVisible === 'boolean'
            ? source.starsVisible
            : safeFallback.starsVisible,
        exposureOffset: normalizeNumber(
            source.exposureOffset,
            safeFallback.exposureOffset,
            -EXPOSURE_OFFSET_LIMIT,
            EXPOSURE_OFFSET_LIMIT,
        ),
    };
}

export function resolveMapLighting(value, baseLighting = DEFAULT_MAP_LIGHTING) {
    const normalizedBase = normalizeMapLighting(baseLighting, DEFAULT_MAP_LIGHTING);
    return normalizeMapLighting(value, normalizedBase);
}

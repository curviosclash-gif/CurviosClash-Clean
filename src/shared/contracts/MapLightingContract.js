const COLOR_MIN = 0x000000;
const COLOR_MAX = 0xffffff;
const DIRECTION_COMPONENT_LIMIT = 100;
const LIGHT_INTENSITY_MAX = 4;
const FOG_DISTANCE_MAX = 1000;
const FOG_HEIGHT_MAX = 200;
const EXPOSURE_OFFSET_LIMIT = 0.5;
// Above 0.5 the fog would be gone within two metres of the base height, which no map can want.
const FOG_HEIGHT_FALLOFF_MAX = 0.5;

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
    // height/heightFalloff/turbulence shape the fog beyond pure distance: full density up to
    // `height` in world units, thinning out above it, with `turbulence` modulating the density in
    // world space. Distance alone gave every surface at the same range an identical colour, which is
    // what made the darkness look like a painted surface instead of like air.
    // skyBlend decides what distant surfaces turn into. At 1 they take the sky's own horizon colour,
    // which is what aerial perspective does in the real world: far things get *lighter*, not darker,
    // and stay readable as depth. At 0 they take the authored `color` instead. A dark authored fog
    // colour under an unrelated sky is what made the distance read as a black wall standing in the
    // scene, so 1 is the default and `color` is the dial-back for a map that deliberately wants a
    // void behind it.
    fog: Object.freeze({
        color: 0x0b1020,
        near: 55,
        far: 190,
        height: 18,
        heightFalloff: 0.014,
        turbulence: 0.12,
        skyBlend: 1,
        // The fog's colour runs on the elevation a surface is seen at, on the same curve the sky's
        // haze band uses: `color` at the horizon, releasing to separate colours overhead and below.
        // Keeping the two ends separate matters when a map wants a black sky but still needs its
        // distant floor to read as depth instead of as a black plate.
        colorHigh: 0x0b1020,
        colorLow: 0x0b1020,
        // Where the forced close towards the camera's far plane begins, as a fraction of it. Maps
        // pull this in opposite directions: a thin fog needs a long blend or it has to gain all its
        // remaining density in a few dozen metres, which reads as a boundary; a dense fog wants a
        // late start so its mid range keeps structure instead of washing flat. One shared constant
        // could only ever suit one of them.
        clipClosureStart: 0.8,
    }),
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
            height: normalizeNumber(fog.height, safeFallback.fog.height, 0, FOG_HEIGHT_MAX),
            heightFalloff: normalizeNumber(
                fog.heightFalloff,
                safeFallback.fog.heightFalloff,
                0,
                FOG_HEIGHT_FALLOFF_MAX,
            ),
            turbulence: normalizeNumber(fog.turbulence, safeFallback.fog.turbulence, 0, 1),
            skyBlend: normalizeNumber(fog.skyBlend, safeFallback.fog.skyBlend, 0, 1),
            colorHigh: normalizeColor(fog.colorHigh, safeFallback.fog.colorHigh),
            colorLow: normalizeColor(fog.colorLow, safeFallback.fog.colorLow),
            clipClosureStart: normalizeNumber(fog.clipClosureStart, safeFallback.fog.clipClosureStart, 0.1, 0.95),
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

const AUTHORED_SECTIONS = Object.freeze(['key', 'fill', 'rim', 'hemisphere', 'fog', 'skyDome']);

/**
 * Stored form of a map's own lighting (editor map files): only the fields the author stated,
 * each clamped by the same rules as normalizeMapLighting. Keeping the gaps matters: at runtime
 * resolveMapLighting fills them from the active graphics style, as it does for built-in maps,
 * so a saved map looks like its source under every style.
 *
 * @param {unknown} value
 * @returns {Record<string, any>|undefined} undefined when nothing usable was stated
 */
export function normalizeAuthoredMapLighting(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const authored = /** @type {Record<string, any>} */ (value);
    const full = /** @type {Record<string, any>} */ (normalizeMapLighting(authored));
    /** @type {Record<string, any>} */
    const result = {};
    for (const section of AUTHORED_SECTIONS) {
        const stated = asObject(authored[section]);
        const fields = Object.keys(full[section]).filter((field) => stated[field] !== undefined);
        if (fields.length > 0) {
            result[section] = Object.fromEntries(fields.map((field) => [field, full[section][field]]));
        }
    }
    if (typeof authored.starsVisible === 'boolean') result.starsVisible = authored.starsVisible;
    if (authored.exposureOffset !== undefined) result.exposureOffset = full.exposureOffset;
    return Object.keys(result).length > 0 ? result : undefined;
}

// A map's own camera far plane in world units (reactor_site states 2000). Ten times the fog's
// reach is far beyond any map; a larger far plane only costs depth precision (z-fighting).
export const MAP_CAMERA_FAR_MAX = FOG_DISTANCE_MAX * 10;

/**
 * @param {unknown} value
 * @returns {number|undefined} the far plane capped at MAP_CAMERA_FAR_MAX, undefined when unusable
 */
export function normalizeMapCameraFar(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
    return Math.min(numeric, MAP_CAMERA_FAR_MAX);
}

export function resolveMapLighting(value, baseLighting = DEFAULT_MAP_LIGHTING) {
    const normalizedBase = normalizeMapLighting(baseLighting, DEFAULT_MAP_LIGHTING);
    return normalizeMapLighting(value, normalizedBase);
}

export const CAMERA_PERSPECTIVE_MODE = Object.freeze({
    CLASSIC: 'classic',
    CINEMATIC_SOFT: 'cinematic_soft',
    CINEMATIC_ACTION: 'cinematic_action',
});

export const CAMERA_PERSPECTIVE_EFFECT_INTENSITY_MIN = 0;
export const CAMERA_PERSPECTIVE_EFFECT_INTENSITY_MAX = 1.5;

export const DEFAULT_CAMERA_PERSPECTIVE_SETTINGS = Object.freeze({
    normal: CAMERA_PERSPECTIVE_MODE.CLASSIC,
    reduceMotion: true,
    speedFovEnabled: true,
    speedFovIntensity: 1,
    thrusterExhaustEnabled: true,
    thrusterExhaustIntensity: 1,
});

/** @type {Set<string>} */
const VALID_CAMERA_PERSPECTIVE_MODE_SET = new Set(Object.values(CAMERA_PERSPECTIVE_MODE));

function normalizeString(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeBoolean(value, fallback) {
    if (typeof value === 'boolean') return value;
    return fallback === true;
}

function normalizeIntensity(value, fallback = 1) {
    const normalizedFallback = Number.isFinite(Number(fallback))
        ? Number(fallback)
        : DEFAULT_CAMERA_PERSPECTIVE_SETTINGS.speedFovIntensity;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return Math.min(
            CAMERA_PERSPECTIVE_EFFECT_INTENSITY_MAX,
            Math.max(CAMERA_PERSPECTIVE_EFFECT_INTENSITY_MIN, normalizedFallback)
        );
    }
    return Math.min(
        CAMERA_PERSPECTIVE_EFFECT_INTENSITY_MAX,
        Math.max(CAMERA_PERSPECTIVE_EFFECT_INTENSITY_MIN, numeric)
    );
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeCameraPerspectiveMode(value, fallback = DEFAULT_CAMERA_PERSPECTIVE_SETTINGS.normal) {
    const normalizedFallback = VALID_CAMERA_PERSPECTIVE_MODE_SET.has(fallback)
        ? fallback
        : DEFAULT_CAMERA_PERSPECTIVE_SETTINGS.normal;
    const candidate = normalizeString(value);
    return VALID_CAMERA_PERSPECTIVE_MODE_SET.has(candidate) ? candidate : normalizedFallback;
}

export function createDefaultCameraPerspectiveSettings() {
    return {
        normal: DEFAULT_CAMERA_PERSPECTIVE_SETTINGS.normal,
        reduceMotion: DEFAULT_CAMERA_PERSPECTIVE_SETTINGS.reduceMotion,
        speedFovEnabled: DEFAULT_CAMERA_PERSPECTIVE_SETTINGS.speedFovEnabled,
        speedFovIntensity: DEFAULT_CAMERA_PERSPECTIVE_SETTINGS.speedFovIntensity,
        thrusterExhaustEnabled: DEFAULT_CAMERA_PERSPECTIVE_SETTINGS.thrusterExhaustEnabled,
        thrusterExhaustIntensity: DEFAULT_CAMERA_PERSPECTIVE_SETTINGS.thrusterExhaustIntensity,
    };
}

export function normalizeCameraPerspectiveSettings(source, fallback = DEFAULT_CAMERA_PERSPECTIVE_SETTINGS) {
    const src = source && typeof source === 'object' ? source : {};
    const normalizedFallback = fallback && typeof fallback === 'object'
        ? fallback
        : DEFAULT_CAMERA_PERSPECTIVE_SETTINGS;
    return {
        normal: normalizeCameraPerspectiveMode(src.normal, normalizedFallback.normal),
        reduceMotion: normalizeBoolean(src.reduceMotion, normalizedFallback.reduceMotion),
        speedFovEnabled: normalizeBoolean(
            src.speedFovEnabled,
            normalizeBoolean(normalizedFallback.speedFovEnabled, DEFAULT_CAMERA_PERSPECTIVE_SETTINGS.speedFovEnabled)
        ),
        speedFovIntensity: normalizeIntensity(
            src.speedFovIntensity,
            normalizedFallback.speedFovIntensity
        ),
        thrusterExhaustEnabled: normalizeBoolean(
            src.thrusterExhaustEnabled,
            normalizeBoolean(normalizedFallback.thrusterExhaustEnabled, DEFAULT_CAMERA_PERSPECTIVE_SETTINGS.thrusterExhaustEnabled)
        ),
        thrusterExhaustIntensity: normalizeIntensity(
            src.thrusterExhaustIntensity,
            normalizedFallback.thrusterExhaustIntensity
        ),
    };
}

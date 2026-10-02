export const GRAPHICS_QUALITY_LEVELS = Object.freeze({
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    ULTRA: 'ULTRA',
});

/** @typedef {'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA'} GraphicsQualityLevel */

export const GRAPHICS_QUALITY_AUTO = 'auto';
export const DEFAULT_GRAPHICS_QUALITY_SETTING = GRAPHICS_QUALITY_AUTO;

/** @type {Set<string>} */
const LEVEL_SET = new Set(Object.values(GRAPHICS_QUALITY_LEVELS));

/** @param {string} value @returns {value is GraphicsQualityLevel} */
function isGraphicsQualityLevel(value) {
    return LEVEL_SET.has(value);
}

const SETTING_LABELS = Object.freeze({
    [GRAPHICS_QUALITY_AUTO]: 'Automatisch',
    LOW: 'Niedrig',
    MEDIUM: 'Mittel',
    HIGH: 'Hoch',
    ULTRA: 'Sehr hoch',
});

// Device cache for the automatic ULTRA decision. It belongs to the machine, not to a profile,
// and is never shared through presets or config links.
export const GRAPHICS_AUTO_PROFILE_STORAGE_KEY = 'cuviosclash.graphics-auto-profile.v1';
export const GRAPHICS_AUTO_VERDICTS = Object.freeze({
    UNKNOWN: 'unknown',
    ULTRA: 'ultra',
    BLOCKED: 'blocked',
});
/** @type {Set<string>} */
const VERDICT_SET = new Set(Object.values(GRAPHICS_AUTO_VERDICTS));

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {GraphicsQualityLevel}
 */
export function normalizeGraphicsQualityLevel(value, fallback = GRAPHICS_QUALITY_LEVELS.HIGH) {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (isGraphicsQualityLevel(normalized)) return normalized;
    return isGraphicsQualityLevel(fallback)
        ? fallback
        : GRAPHICS_QUALITY_LEVELS.HIGH;
}

/**
 * @param {unknown} value
 * @returns {string} 'auto' or one of GRAPHICS_QUALITY_LEVELS
 */
export function normalizeGraphicsQualitySetting(value) {
    const raw = String(value ?? '').trim();
    if (raw.toLowerCase() === GRAPHICS_QUALITY_AUTO) return GRAPHICS_QUALITY_AUTO;
    const level = raw.toUpperCase();
    return LEVEL_SET.has(level) ? level : DEFAULT_GRAPHICS_QUALITY_SETTING;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function resolveGraphicsQualitySettingLabel(value) {
    return SETTING_LABELS[normalizeGraphicsQualitySetting(value)];
}

/**
 * @param {unknown} raw
 * @returns {{version: number, gpuKey: string, verdict: string, downgrades: number, supersample: boolean}}
 */
export function normalizeGraphicsAutoProfile(raw) {
    const source = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
    const verdict = String(source.verdict || '');
    const downgrades = Math.trunc(Number(source.downgrades));
    return {
        version: 1,
        gpuKey: String(source.gpuKey || '').trim().slice(0, 200),
        verdict: VERDICT_SET.has(verdict) ? verdict : GRAPHICS_AUTO_VERDICTS.UNKNOWN,
        downgrades: Number.isFinite(downgrades) && downgrades > 0 ? downgrades : 0,
        supersample: source.supersample === true,
    };
}

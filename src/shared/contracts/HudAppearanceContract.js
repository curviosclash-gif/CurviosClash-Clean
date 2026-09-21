// ============================================
// HudAppearanceContract.js - HUD appearance settings contract
// ============================================
// Canonical value object for the local HUD appearance settings
// (scale, opacity, color preset) persisted under localSettings.hud.

export const HUD_COLOR_PRESET = Object.freeze({
    GREEN: 'green',
    AMBER: 'amber',
    CYAN: 'cyan',
    WHITE: 'white',
});

export const HUD_APPEARANCE_LIMITS = Object.freeze({
    SCALE_MIN: 0.6,
    SCALE_MAX: 1.4,
    OPACITY_MIN: 0.4,
    OPACITY_MAX: 1.0,
});

export const DEFAULT_HUD_APPEARANCE = Object.freeze({
    scale: 1,
    opacity: 1,
    colorPreset: HUD_COLOR_PRESET.GREEN,
});

/** @type {Set<string>} */
const HUD_COLOR_PRESET_SET = new Set(Object.values(HUD_COLOR_PRESET));

// HUD blocks are laid out in fixed pixels and scale around their own centre, so a larger
// HUD needs a larger window. Measured in the desktop app: overlap-free up to 1.3 at
// 1920x1080 and only 1.0 at 1280x720, which gives the room per scale step below.
const HUD_FIT_WIDTH_PER_SCALE = 1477;
const HUD_FIT_HEIGHT_PER_SCALE = 831;

/**
 * The scale the HUD is drawn with: the chosen scale, but never larger than the window leaves
 * room for without overlaps. A scale of 1 or below always stays as chosen.
 * @param {number} requestedScale
 * @param {{ width?: number, height?: number } | null} viewport
 * @returns {number}
 */
export function resolveEffectiveHudScale(requestedScale, viewport) {
    const scale = Number(requestedScale);
    if (!Number.isFinite(scale) || scale <= 1) return Number.isFinite(scale) ? scale : DEFAULT_HUD_APPEARANCE.scale;
    const width = Number(viewport?.width);
    const height = Number(viewport?.height);
    if (!(width > 0) || !(height > 0)) return scale;
    const fit = Math.max(1, Math.min(width / HUD_FIT_WIDTH_PER_SCALE, height / HUD_FIT_HEIGHT_PER_SCALE));
    return Math.round(Math.min(scale, fit) * 100) / 100;
}

function clampHudNumber(value, min, max, fallback) {
    // null/undefined/'' coerce to 0 via Number(); treat them as missing.
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}

/** @param {unknown} value @param {string} fallback */
export function normalizeHudColorPreset(value, fallback = DEFAULT_HUD_APPEARANCE.colorPreset) {
    const normalized = String(value || '').trim().toLowerCase();
    if (HUD_COLOR_PRESET_SET.has(normalized)) return normalized;
    return HUD_COLOR_PRESET_SET.has(fallback) ? fallback : DEFAULT_HUD_APPEARANCE.colorPreset;
}

/**
 * Normalizes a HUD appearance value object. Unknown or invalid fields fall
 * back to the provided fallback (or the canonical defaults).
 *
 * @param {object|null} value - Raw value from settings/local storage.
 * @param {object} [fallback] - Fallback appearance (defaults to DEFAULT_HUD_APPEARANCE).
 * @returns {{ scale: number, opacity: number, colorPreset: string }}
 */
export function normalizeHudAppearance(value = null, fallback = DEFAULT_HUD_APPEARANCE) {
    const normalizedFallback = {
        scale: clampHudNumber(
            fallback?.scale,
            HUD_APPEARANCE_LIMITS.SCALE_MIN,
            HUD_APPEARANCE_LIMITS.SCALE_MAX,
            DEFAULT_HUD_APPEARANCE.scale
        ),
        opacity: clampHudNumber(
            fallback?.opacity,
            HUD_APPEARANCE_LIMITS.OPACITY_MIN,
            HUD_APPEARANCE_LIMITS.OPACITY_MAX,
            DEFAULT_HUD_APPEARANCE.opacity
        ),
        colorPreset: normalizeHudColorPreset(fallback?.colorPreset),
    };
    const source = value && typeof value === 'object' ? value : {};
    return {
        scale: clampHudNumber(
            source.scale,
            HUD_APPEARANCE_LIMITS.SCALE_MIN,
            HUD_APPEARANCE_LIMITS.SCALE_MAX,
            normalizedFallback.scale
        ),
        opacity: clampHudNumber(
            source.opacity,
            HUD_APPEARANCE_LIMITS.OPACITY_MIN,
            HUD_APPEARANCE_LIMITS.OPACITY_MAX,
            normalizedFallback.opacity
        ),
        colorPreset: normalizeHudColorPreset(source.colorPreset, normalizedFallback.colorPreset),
    };
}

export function createDefaultHudAppearance() {
    return { ...DEFAULT_HUD_APPEARANCE };
}

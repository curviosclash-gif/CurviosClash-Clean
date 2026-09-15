// ─── Audio Settings Contract: Persistent Audio Preference Shape ───
// Layer: Shared (settings UI and runtime can both depend on this)

const VOLUME_KEYS = Object.freeze([
    'masterVolume',
    'musicVolume',
    'sfxVolume',
    'engineVolume',
    'uiVolume',
    'ambienceVolume',
]);

export const DEFAULT_AUDIO_SETTINGS = Object.freeze({
    enabled: true,
    masterVolume: 0.32,
    musicVolume: 0.34,
    sfxVolume: 0.9,
    engineVolume: 0.38,
    uiVolume: 0.72,
    ambienceVolume: 0.32,
});

/**
 * @typedef {object} AudioSettings
 * @property {boolean} enabled
 * @property {number} masterVolume
 * @property {number} musicVolume
 * @property {number} sfxVolume
 * @property {number} engineVolume
 * @property {number} uiVolume
 * @property {number} ambienceVolume
 */

function normalizeVolume(value, fallback) {
    const numericValue = typeof value === 'string' ? Number(value.trim()) : value;
    if (!Number.isFinite(numericValue)) return fallback;
    return Math.min(1, Math.max(0, numericValue));
}

/**
 * Normalizes persisted audio settings without retaining references to input.
 * @param {unknown} source
 * @param {Partial<AudioSettings>} [fallback]
 * @returns {AudioSettings}
 */
export function normalizeAudioSettings(source, fallback = DEFAULT_AUDIO_SETTINGS) {
    const rawSource = /** @type {Partial<AudioSettings>} */ (
        source && typeof source === 'object' ? source : {}
    );
    const rawFallback = fallback && typeof fallback === 'object' ? fallback : DEFAULT_AUDIO_SETTINGS;
    const normalized = /** @type {AudioSettings} */ ({
        // A boolean in the source always wins: otherwise a fallback carrying the
        // current muted state would swallow a re-enable request.
        enabled: typeof rawSource.enabled === 'boolean'
            ? rawSource.enabled
            : rawFallback.enabled !== false,
    });

    for (const key of VOLUME_KEYS) {
        const defaultValue = DEFAULT_AUDIO_SETTINGS[key];
        const fallbackValue = normalizeVolume(rawFallback[key], defaultValue);
        normalized[key] = normalizeVolume(rawSource[key], fallbackValue);
    }

    return normalized;
}

/**
 * Creates an independent default audio settings object.
 * @returns {AudioSettings}
 */
export function createDefaultAudioSettings() {
    return normalizeAudioSettings(DEFAULT_AUDIO_SETTINGS);
}

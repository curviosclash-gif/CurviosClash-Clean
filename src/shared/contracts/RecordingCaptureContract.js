export const RECORDING_CAPTURE_PROFILE = Object.freeze({
    STANDARD: 'standard',
    YOUTUBE_SHORT: 'youtube_short',
    CINEMATIC: 'cinematic',
    // Legacy alias for persisted settings. New code should use CINEMATIC.
    CINEMATIC_MP4: 'cinematic',
});

export const RECORDING_EXPORT_PRESET = Object.freeze({
    MASTER: 'master',
    YOUTUBE_MP4: 'youtube-mp4',
});

export const RECORDING_DOWNLOAD_DIRECTORY = 'videos';
export const RECORDING_ARCHIVE_DIRECTORY = 'tmp/workspace-archive/videos';

export const RECORDING_HUD_MODE = Object.freeze({
    CLEAN: 'clean',
    WITH_HUD: 'with_hud',
});

export const DEFAULT_RECORDING_CAPTURE_SETTINGS = Object.freeze({
    profile: RECORDING_CAPTURE_PROFILE.STANDARD,
    hudMode: RECORDING_HUD_MODE.CLEAN,
    exportPreset: RECORDING_EXPORT_PRESET.YOUTUBE_MP4,
});

export const RECORDING_CINEMATIC_QUALITY_PROFILE = Object.freeze({
    maxWidth: 1920,
    maxHeight: 1080,
    supersampleScale: 1.25,
    targetFps: 60,
    bitrate1080p: 18_000_000,
    bitrate720p: 14_000_000,
    bitrateBase: 10_000_000,
});

const VALID_PROFILE_SET = new Set(Object.values(RECORDING_CAPTURE_PROFILE));
const VALID_HUD_MODE_SET = new Set(Object.values(RECORDING_HUD_MODE));
const VALID_EXPORT_PRESET_SET = new Set(Object.values(RECORDING_EXPORT_PRESET));
const LEGACY_CAPTURE_PROFILE_ALIASES = Object.freeze({
    cinematic_mp4: RECORDING_CAPTURE_PROFILE.CINEMATIC,
});

/**
 * @typedef {'standard' | 'youtube_short' | 'cinematic'} RecordingCaptureProfile
 * @typedef {'clean' | 'with_hud'} RecordingHudMode
 * @typedef {Readonly<{ profile: RecordingCaptureProfile, hudMode: RecordingHudMode, exportPreset: string }>} RecordingCaptureSettings
 */

function normalizeString(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeCaptureProfileCandidate(value) {
    const normalized = normalizeString(value);
    return LEGACY_CAPTURE_PROFILE_ALIASES[normalized] || normalized;
}

export function normalizeEnumValue(value, validSet, defaultValue) {
    const candidate = normalizeString(value);
    if (validSet.has(candidate)) return candidate;
    return validSet.has(defaultValue) ? defaultValue : validSet.values().next().value;
}

/**
 * @param {unknown} value
 * @param {RecordingCaptureProfile} [fallback]
 * @returns {RecordingCaptureProfile}
 */
export function normalizeRecordingCaptureProfile(value, fallback = DEFAULT_RECORDING_CAPTURE_SETTINGS.profile) {
    const normalizedFallback = normalizeCaptureProfileCandidate(fallback);
    const fallbackValue = VALID_PROFILE_SET.has(normalizedFallback)
        ? normalizedFallback
        : DEFAULT_RECORDING_CAPTURE_SETTINGS.profile;
    const candidate = normalizeCaptureProfileCandidate(value);
    if (VALID_PROFILE_SET.has(candidate)) {
        return candidate;
    }
    return fallbackValue;
}

/**
 * @param {unknown} value
 * @param {RecordingHudMode} [fallback]
 * @returns {RecordingHudMode}
 */
export function normalizeRecordingHudMode(value, fallback = DEFAULT_RECORDING_CAPTURE_SETTINGS.hudMode) {
    return normalizeEnumValue(value, VALID_HUD_MODE_SET, fallback);
}

/**
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeRecordingExportPreset(value, fallback = DEFAULT_RECORDING_CAPTURE_SETTINGS.exportPreset) {
    return normalizeEnumValue(value, VALID_EXPORT_PRESET_SET, fallback);
}

export function isCinematicCaptureProfile(value) {
    return normalizeCaptureProfileCandidate(value) === RECORDING_CAPTURE_PROFILE.CINEMATIC;
}

/** @returns {RecordingCaptureSettings} */
export function createDefaultRecordingCaptureSettings() {
    return {
        profile: DEFAULT_RECORDING_CAPTURE_SETTINGS.profile,
        hudMode: DEFAULT_RECORDING_CAPTURE_SETTINGS.hudMode,
        exportPreset: DEFAULT_RECORDING_CAPTURE_SETTINGS.exportPreset,
    };
}

/**
 * @param {unknown} source
 * @param {RecordingCaptureSettings} [fallback]
 * @returns {RecordingCaptureSettings}
 */
export function normalizeRecordingCaptureSettings(source, fallback = DEFAULT_RECORDING_CAPTURE_SETTINGS) {
    const src = /** @type {Partial<RecordingCaptureSettings>} */ (
        source && typeof source === 'object' ? source : {}
    );
    const normalizedFallback = fallback && typeof fallback === 'object'
        ? fallback
        : DEFAULT_RECORDING_CAPTURE_SETTINGS;
    return {
        profile: normalizeRecordingCaptureProfile(src.profile, normalizedFallback.profile),
        hudMode: normalizeRecordingHudMode(src.hudMode, normalizedFallback.hudMode),
        exportPreset: normalizeRecordingExportPreset(
            src.exportPreset,
            normalizedFallback.exportPreset
        ),
    };
}

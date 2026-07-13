import {
    CAMERA_PERSPECTIVE_EFFECT_INTENSITY_MAX,
    CAMERA_PERSPECTIVE_EFFECT_INTENSITY_MIN,
    CAMERA_PERSPECTIVE_MODE,
} from '../../shared/contracts/CameraPerspectiveContract.js';
import { RECORDING_CAPTURE_PROFILE, RECORDING_HUD_MODE } from '../../shared/contracts/RecordingCaptureContract.js';
import { clamp } from '../../utils/MathOps.js';

export function resolveRecordingProfileLabel(profile) {
    return profile === RECORDING_CAPTURE_PROFILE.YOUTUBE_SHORT
        ? 'YouTube Shorts'
        : 'Standard';
}

export function resolveRecordingHudLabel(hudMode) {
    return hudMode === RECORDING_HUD_MODE.WITH_HUD
        ? 'mit HUD'
        : 'clean';
}

export function resolveNormalCameraPerspectiveLabel(mode) {
    if (mode === CAMERA_PERSPECTIVE_MODE.CINEMATIC_SOFT) return 'Cinematic Soft';
    if (mode === CAMERA_PERSPECTIVE_MODE.CINEMATIC_ACTION) return 'Cinematic Action';
    return 'Klassisch';
}

function clampCameraPerspectiveIntensity(value, fallback = 1) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return clamp(
        numeric,
        CAMERA_PERSPECTIVE_EFFECT_INTENSITY_MIN,
        CAMERA_PERSPECTIVE_EFFECT_INTENSITY_MAX
    );
}

export function readCameraPerspectiveIntensityFromSlider(input, fallback = 1) {
    const sliderValue = Number(input?.value);
    if (!Number.isFinite(sliderValue)) return fallback;
    return clampCameraPerspectiveIntensity(sliderValue / 100, fallback);
}

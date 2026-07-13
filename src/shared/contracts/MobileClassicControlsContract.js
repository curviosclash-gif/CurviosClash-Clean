export const MOBILE_CLASSIC_TILT_PITCH_MODES = Object.freeze({
    TILT: 'tilt',
    TOUCH: 'touch',
});

export const MOBILE_CLASSIC_TILT_ASSIST_MODES = Object.freeze({
    OFF: 'off',
    SOFT: 'soft',
    ARCADE: 'arcade',
});

export const MOBILE_CLASSIC_TILT_SENSITIVITY_LIMITS = Object.freeze({
    min: 0.6,
    max: 1.8,
    step: 0.05,
});

export const DEFAULT_MOBILE_CLASSIC_CONTROLS = Object.freeze({
    tiltSensitivity: 1,
    tiltPitchMode: MOBILE_CLASSIC_TILT_PITCH_MODES.TILT,
    tiltAssistMode: MOBILE_CLASSIC_TILT_ASSIST_MODES.SOFT,
    tiltDebugVisible: false,
    tiltSensorHzVisible: false,
});

function clamp(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    if (numeric < min) return min;
    if (numeric > max) return max;
    return numeric;
}

function normalizeStringEnum(value, validValues, fallback) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return validValues.includes(normalized) ? normalized : fallback;
}

export function normalizeMobileClassicTiltSensitivity(value, fallback = DEFAULT_MOBILE_CLASSIC_CONTROLS.tiltSensitivity) {
    const fallbackValue = clamp(
        fallback,
        MOBILE_CLASSIC_TILT_SENSITIVITY_LIMITS.min,
        MOBILE_CLASSIC_TILT_SENSITIVITY_LIMITS.max
    );
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallbackValue;
    return clamp(
        numeric,
        MOBILE_CLASSIC_TILT_SENSITIVITY_LIMITS.min,
        MOBILE_CLASSIC_TILT_SENSITIVITY_LIMITS.max
    );
}

export function normalizeMobileClassicControlSettings(source = null) {
    const input = source && typeof source === 'object' ? source : {};
    return {
        tiltSensitivity: normalizeMobileClassicTiltSensitivity(input.tiltSensitivity),
        tiltPitchMode: normalizeStringEnum(
            input.tiltPitchMode,
            Object.values(MOBILE_CLASSIC_TILT_PITCH_MODES),
            DEFAULT_MOBILE_CLASSIC_CONTROLS.tiltPitchMode
        ),
        tiltAssistMode: normalizeStringEnum(
            input.tiltAssistMode,
            Object.values(MOBILE_CLASSIC_TILT_ASSIST_MODES),
            DEFAULT_MOBILE_CLASSIC_CONTROLS.tiltAssistMode
        ),
        tiltDebugVisible: typeof input.tiltDebugVisible === 'boolean'
            ? input.tiltDebugVisible
            : DEFAULT_MOBILE_CLASSIC_CONTROLS.tiltDebugVisible,
        tiltSensorHzVisible: typeof input.tiltSensorHzVisible === 'boolean'
            ? input.tiltSensorHzVisible
            : DEFAULT_MOBILE_CLASSIC_CONTROLS.tiltSensorHzVisible,
    };
}

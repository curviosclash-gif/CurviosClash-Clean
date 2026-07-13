import {
    MOBILE_CLASSIC_TILT_ASSIST_MODES,
    normalizeMobileClassicTiltSensitivity,
} from '../../shared/contracts/MobileClassicControlsContract.js';

export const TILT_DEFAULT_DEADZONE_DEG = 2.5;
export const TILT_DEFAULT_RANGE_DEG = 26;
export const TILT_DEFAULT_CURVE_EXPONENT = 1.1;

export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function normalizeOrientationAngle(value = 0) {
    const normalized = Math.round(Number(value) || 0) % 360;
    return normalized < 0 ? normalized + 360 : normalized;
}

function normalizeTiltDelta(rawValue = 0, neutralValue = 0) {
    let delta = (Number(rawValue) || 0) - (Number(neutralValue) || 0);
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    return delta;
}

function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
}

export function resolveTiltCalibrationNeutral(samples = [], fallback = {}) {
    const validSamples = Array.isArray(samples)
        ? samples.filter((sample) => isFiniteNumber(sample?.beta) && isFiniteNumber(sample?.gamma))
        : [];
    if (validSamples.length === 0) {
        return {
            neutralBeta: Number(fallback.neutralBeta) || 0,
            neutralGamma: Number(fallback.neutralGamma) || 0,
            neutralOrientationAngle: normalizeOrientationAngle(fallback.neutralOrientationAngle),
        };
    }

    const totals = validSamples.reduce((acc, sample) => {
        acc.beta += Number(sample.beta);
        acc.gamma += Number(sample.gamma);
        return acc;
    }, { beta: 0, gamma: 0 });
    const lastSample = validSamples[validSamples.length - 1];
    return {
        neutralBeta: totals.beta / validSamples.length,
        neutralGamma: totals.gamma / validSamples.length,
        neutralOrientationAngle: normalizeOrientationAngle(lastSample.orientationAngle),
    };
}

function applyTiltResponseCurve(axis, deadzoneAxis, curveExponent) {
    const absAxis = Math.abs(axis);
    if (absAxis <= deadzoneAxis) return 0;
    const safeRange = Math.max(0.0001, 1 - deadzoneAxis);
    const normalized = clamp((absAxis - deadzoneAxis) / safeRange, 0, 1);
    const curved = Math.pow(normalized, Math.max(1, Number(curveExponent) || TILT_DEFAULT_CURVE_EXPONENT));
    return Math.sign(axis) * curved;
}

function applyTiltSensitivity(axis, sensitivity) {
    const scaled = axis * normalizeMobileClassicTiltSensitivity(sensitivity);
    return clamp(scaled, -1, 1);
}

function applyTiltAssist(axis, assistMode) {
    const magnitude = Math.abs(axis);
    if (magnitude <= 0) return 0;
    const mode = assistMode === MOBILE_CLASSIC_TILT_ASSIST_MODES.ARCADE
        ? MOBILE_CLASSIC_TILT_ASSIST_MODES.ARCADE
        : (assistMode === MOBILE_CLASSIC_TILT_ASSIST_MODES.SOFT
            ? MOBILE_CLASSIC_TILT_ASSIST_MODES.SOFT
            : MOBILE_CLASSIC_TILT_ASSIST_MODES.OFF);
    if (mode === MOBILE_CLASSIC_TILT_ASSIST_MODES.OFF) return axis;

    const exponent = mode === MOBILE_CLASSIC_TILT_ASSIST_MODES.ARCADE ? 0.55 : 0.72;
    const blend = mode === MOBILE_CLASSIC_TILT_ASSIST_MODES.ARCADE ? 0.42 : 0.24;
    const assistedMagnitude = (magnitude * (1 - blend)) + (Math.pow(magnitude, exponent) * blend);
    return Math.sign(axis) * clamp(assistedMagnitude, 0, 1);
}

export function deriveTiltSteeringState({
    beta = 0,
    gamma = 0,
    neutralBeta = 0,
    neutralGamma = 0,
    orientationAngle = 0,
    deadzoneDeg = TILT_DEFAULT_DEADZONE_DEG,
    rangeDeg = TILT_DEFAULT_RANGE_DEG,
    curveExponent = TILT_DEFAULT_CURVE_EXPONENT,
    sensitivity = 1,
    assistMode = MOBILE_CLASSIC_TILT_ASSIST_MODES.OFF,
} = {}) {
    const betaDelta = normalizeTiltDelta(beta, neutralBeta);
    const gammaDelta = normalizeTiltDelta(gamma, neutralGamma);
    const angle = normalizeOrientationAngle(orientationAngle);
    // Mapping deckt alle vier Winkel ab: Android Classic ist per Manifest auf
    // sensorLandscape (90/270) gelockt, der Browser-Pfad bleibt orientation-frei (0/180 inklusive).
    let yawDeg = gammaDelta;
    let pitchDeg = betaDelta;

    if (angle === 90) {
        yawDeg = betaDelta;
        pitchDeg = -gammaDelta;
    } else if (angle === 270) {
        yawDeg = -betaDelta;
        pitchDeg = gammaDelta;
    } else if (angle === 180) {
        yawDeg = -gammaDelta;
        pitchDeg = -betaDelta;
    }

    const safeRange = Math.max(1, Number(rangeDeg) || TILT_DEFAULT_RANGE_DEG);
    const deadzoneAxis = clamp(Math.max(0, Number(deadzoneDeg) || 0) / safeRange, 0, 0.95);
    const rawYawAxis = clamp(yawDeg / safeRange, -1, 1);
    const rawPitchAxis = clamp(pitchDeg / safeRange, -1, 1);
    const yawAxis = applyTiltAssist(
        applyTiltSensitivity(applyTiltResponseCurve(rawYawAxis, deadzoneAxis, curveExponent), sensitivity),
        assistMode
    );
    const pitchAxis = applyTiltAssist(
        applyTiltSensitivity(applyTiltResponseCurve(rawPitchAxis, deadzoneAxis, curveExponent), sensitivity),
        assistMode
    );

    return {
        yawAxis,
        pitchAxis,
        rawYawAxis,
        rawPitchAxis,
        pitchUp: pitchAxis < 0,
        pitchDown: pitchAxis > 0,
        yawLeft: yawAxis < 0,
        yawRight: yawAxis > 0,
    };
}

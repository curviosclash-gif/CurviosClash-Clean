export const DEFAULT_GRAVITY_STRENGTH = 20;
export const MAX_GRAVITY_STRENGTH = 50;
export const ALTITUDE_SPEED_CHANGE = MAX_GRAVITY_STRENGTH / 100;
export const ALTITUDE_SPEED_SETTLE_SECONDS = 1;
export const ALTITUDE_SPEED_REMAINING_FRACTION = 0.05;
export const ALTITUDE_SPEED_MAX_MULTIPLIER = 1 + ALTITUDE_SPEED_CHANGE;

export function resolveAltitudeSpeedChange(strength = DEFAULT_GRAVITY_STRENGTH) {
    return (Number.isFinite(strength) ? Math.max(0, Math.min(MAX_GRAVITY_STRENGTH, strength)) : DEFAULT_GRAVITY_STRENGTH) / 100;
}

export function normalizeAltitudeSpeedFactor(value, fallback = 1) {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(1 - ALTITUDE_SPEED_CHANGE, Math.min(ALTITUDE_SPEED_MAX_MULTIPLIER, value));
}

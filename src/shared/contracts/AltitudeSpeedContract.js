export const ALTITUDE_SPEED_CHANGE = 0.1;
export const ALTITUDE_SPEED_SETTLE_SECONDS = 1;
export const ALTITUDE_SPEED_REMAINING_FRACTION = 0.05;
export const ALTITUDE_SPEED_MAX_MULTIPLIER = 1 + ALTITUDE_SPEED_CHANGE;

export function normalizeAltitudeSpeedFactor(value, fallback = 1) {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(1 - ALTITUDE_SPEED_CHANGE, Math.min(ALTITUDE_SPEED_MAX_MULTIPLIER, value));
}

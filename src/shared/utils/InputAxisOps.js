// ============================================
// InputAxisOps.js - shared steering axis math
// ============================================
//
// Every analog steering source (gamepad stick, mouse, tilt, touch joystick) has
// to silence a small rest zone around the centre. Doing that by simply zeroing
// values below the threshold makes the deflection jump from 0 to the raw value
// the moment the threshold is crossed. These helpers instead rescale the travel
// that is left above the deadzone onto the full [-1, 1] range, so the axis grows
// from 0 continuously. Pure math: no imports from implementation layers.

/**
 * Coerce a value to a finite number, using 0 for anything else.
 * @param {unknown} value
 * @returns {number}
 */
function toFiniteAxis(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Clamp the deadzone into the usable range [0, 1).
 * @param {unknown} deadzone
 * @returns {number}
 */
function normalizeDeadzone(deadzone) {
    const numeric = toFiniteAxis(deadzone);
    if (numeric <= 0) return 0;
    return numeric >= 0.99 ? 0.99 : numeric;
}

/**
 * Apply a deadzone to a single axis and rescale the remaining travel to [-1, 1].
 * Values at or below the deadzone become 0, values beyond the range are clamped,
 * and non-numeric input is treated as the rest position.
 * @param {unknown} value raw axis value, expected in [-1, 1]
 * @param {number} deadzone rest zone as a fraction of full deflection
 * @returns {number}
 */
export function applyAxisDeadzone(value, deadzone) {
    const zone = normalizeDeadzone(deadzone);
    const clamped = Math.max(-1, Math.min(1, toFiniteAxis(value)));
    const magnitude = Math.abs(clamped);
    if (magnitude <= zone) return 0;
    const scaled = (magnitude - zone) / (1 - zone);
    return clamped < 0 ? -scaled : scaled;
}

/**
 * Apply a deadzone to a two-axis stick as one vector, so a diagonal hold is
 * judged by its length instead of per axis. The direction is preserved, the
 * magnitude is clamped to 1 and the travel above the deadzone is rescaled to
 * the full range.
 * @param {unknown} x raw horizontal axis value
 * @param {unknown} y raw vertical axis value
 * @param {number} deadzone rest zone as a fraction of full deflection
 * @param {{ x: number, y: number }} [out] optional target object, reused to keep
 *   the per-frame input path free of allocations
 * @returns {{ x: number, y: number }}
 */
export function applyRadialDeadzone(x, y, deadzone, out = { x: 0, y: 0 }) {
    const zone = normalizeDeadzone(deadzone);
    const rawX = toFiniteAxis(x);
    const rawY = toFiniteAxis(y);
    const magnitude = Math.sqrt(rawX * rawX + rawY * rawY);
    if (magnitude <= zone || magnitude <= 0) {
        out.x = 0;
        out.y = 0;
        return out;
    }
    const clampedMagnitude = magnitude > 1 ? 1 : magnitude;
    const scaled = (clampedMagnitude - zone) / (1 - zone);
    out.x = (rawX / magnitude) * scaled;
    out.y = (rawY / magnitude) * scaled;
    return out;
}

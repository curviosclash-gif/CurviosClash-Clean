// One steering ramp for the whole game. PlayerController uses it for the entity it
// simulates, the network input source uses it so a guest sends the very axis it
// predicted with. Two ramps would drift apart, and the reconciler would fight them.
// Pure functions only: the step size is handed in, never read from a clock.

export const DEFAULT_AXIS_ATTACK_RATE = 18.0;
export const DEFAULT_AXIS_RELEASE_RATE = 12.0;
export const AXIS_RELEASE_DEADZONE = 0.0005;
export const DEFAULT_STEERING_STEP_SECONDS = 1 / 60;

export function clampSteeringAxis(value) {
    if (!Number.isFinite(value)) return 0;
    if (value > 1) return 1;
    if (value < -1) return -1;
    return value;
}

export function toPositiveSteeringRate(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return numeric;
}

export function resolveSteeringStepSeconds(dt) {
    return Number.isFinite(dt) && dt > 0 ? dt : DEFAULT_STEERING_STEP_SECONDS;
}

export function digitalAxisInput(positive, negative) {
    return (positive ? 1 : 0) - (negative ? 1 : 0);
}

// Analog sources (gamepad, mouse, tilt, touch stick) deliver a settled deflection
// as a finite *Axis number. Digital sources (keyboard, four player planar keys,
// touch roll buttons) leave the field undefined, so their booleans are ramped.
// One read per axis: the value doubles as the analog flag.
export function readAnalogAxis(input, axisKey) {
    return Number(input?.[axisKey]);
}

export function resolveSteeringAxisTarget(analogValue, input, positiveKey, negativeKey) {
    return Number.isFinite(analogValue)
        ? analogValue
        : digitalAxisInput(input?.[positiveKey], input?.[negativeKey]);
}

export function stepSteeringAxisToward(current, target, attackRate, releaseRate, dt) {
    const diff = target - current;
    if (Math.abs(diff) <= 0.000001) return target;
    if (!Number.isFinite(dt) || dt <= 0) return target;

    const sameDirection = Math.sign(target) === Math.sign(current);
    const absTarget = Math.abs(target);
    const absCurrent = Math.abs(current);
    const isAttackPhase = !sameDirection || absTarget > absCurrent;
    const rate = isAttackPhase ? attackRate : releaseRate;
    const step = Math.max(0, rate) * dt;

    if (step <= 0 || Math.abs(diff) <= step) {
        return target;
    }
    return current + Math.sign(diff) * step;
}

export function applySteeringReleaseDeadzone(value) {
    return Math.abs(value) < AXIS_RELEASE_DEADZONE ? 0 : value;
}

export function createSteeringRampState() {
    return { pitch: 0, yaw: 0, roll: 0 };
}

/**
 * Advances one axis of a ramp state and returns the value to steer with.
 * A finite analog value snaps the state to the stick so a later fall back to the
 * keys continues from the deflection the stick had, instead of from zero.
 */
export function advanceSteeringAxis(state, stateKey, target, analogValue, rates, dt) {
    const clampedTarget = clampSteeringAxis(target);
    if (Number.isFinite(analogValue)) {
        state[stateKey] = clampedTarget;
        return clampedTarget;
    }
    const next = clampSteeringAxis(stepSteeringAxisToward(
        state[stateKey],
        clampedTarget,
        rates.attackRate,
        rates.releaseRate,
        dt
    ));
    state[stateKey] = next;
    return next;
}

import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';

function axisInput(positive, negative) {
    return (positive ? 1 : 0) - (negative ? 1 : 0);
}

function resolveInputAxis(input, axisKey, positiveKey, negativeKey) {
    const axisValue = Number(input?.[axisKey]);
    return Number.isFinite(axisValue)
        ? axisValue
        : axisInput(input?.[positiveKey], input?.[negativeKey]);
}

function clampAxis(value) {
    if (!Number.isFinite(value)) return 0;
    if (value > 1) return 1;
    if (value < -1) return -1;
    return value;
}

function toPositiveRate(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return numeric;
}

function stepAxisToward(current, target, attackRate, releaseRate, dt) {
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

const DEFAULT_AXIS_ATTACK_RATE = 12.0;
const DEFAULT_AXIS_RELEASE_RATE = 8.5;
const AXIS_RELEASE_DEADZONE = 0.0005;

export class PlayerController {
    constructor() {
        this._controlState = {
            pitchInput: 0,
            yawInput: 0,
            rollInput: 0,
            boost: false,
            boostPressed: false,
        };
        this._axisState = {
            pitch: 0,
            yaw: 0,
            roll: 0,
        };
        this.rampAttackRate = DEFAULT_AXIS_ATTACK_RATE;
        this.rampReleaseRate = DEFAULT_AXIS_RELEASE_RATE;
    }

    setRampRates({ attackRate, releaseRate } = {}) {
        this.rampAttackRate = toPositiveRate(attackRate, this.rampAttackRate);
        this.rampReleaseRate = toPositiveRate(releaseRate, this.rampReleaseRate);
    }

    resetAxisState() {
        this._axisState.pitch = 0;
        this._axisState.yaw = 0;
        this._axisState.roll = 0;
    }

    _shouldUseAxisRamps(player) {
        if (!player || typeof player !== 'object') return true;
        if (player.isBot) {
            return player.controlRampEnabled === true;
        }
        return player.controlRampEnabled !== false;
    }

    _resolveRampRate(player, key, fallback) {
        const controllerRates = player?.controlRampRates;
        return toPositiveRate(controllerRates?.[key], fallback);
    }

    resolveControlState(player, input, steeringLocked = false, dt = 0) {
        const out = this._controlState;
        let pitchTarget = 0;
        let yawTarget = 0;
        let rollTarget = 0;
        let boostHeld = false;
        let boostPressed = false;

        const hasDirectInput = !!input && steeringLocked !== true;
        if (hasDirectInput) {
            pitchTarget = resolveInputAxis(input, 'pitchAxis', 'pitchUp', 'pitchDown');
            yawTarget = resolveInputAxis(input, 'yawAxis', 'yawLeft', 'yawRight');
            rollTarget = resolveInputAxis(input, 'rollAxis', 'rollLeft', 'rollRight');
            boostHeld = !!input.boost;
            boostPressed = !!input.boostPressed;

            if (player?.invertPitchBase) {
                pitchTarget *= -1;
            }
            if (player?.invertControls) {
                pitchTarget *= -1;
                yawTarget *= -1;
            }
            if (resolveGameplayConfig(player).GAMEPLAY.PLANAR_MODE) {
                pitchTarget = 0;
            }
        }

        pitchTarget = clampAxis(pitchTarget);
        yawTarget = clampAxis(yawTarget);
        rollTarget = clampAxis(rollTarget);

        if (!this._shouldUseAxisRamps(player)) {
            this._axisState.pitch = pitchTarget;
            this._axisState.yaw = yawTarget;
            this._axisState.roll = rollTarget;
            out.pitchInput = pitchTarget;
            out.yawInput = yawTarget;
            out.rollInput = rollTarget;
            out.boost = boostHeld;
            out.boostPressed = boostPressed;
            return out;
        }

        const frameDt = Number.isFinite(dt) && dt > 0 ? dt : (1 / 60);
        const attackRate = this._resolveRampRate(player, 'attack', this.rampAttackRate);
        const releaseRate = this._resolveRampRate(player, 'release', this.rampReleaseRate);

        this._axisState.pitch = clampAxis(
            stepAxisToward(this._axisState.pitch, pitchTarget, attackRate, releaseRate, frameDt)
        );
        this._axisState.yaw = clampAxis(
            stepAxisToward(this._axisState.yaw, yawTarget, attackRate, releaseRate, frameDt)
        );
        this._axisState.roll = clampAxis(
            stepAxisToward(this._axisState.roll, rollTarget, attackRate, releaseRate, frameDt)
        );

        out.pitchInput = Math.abs(this._axisState.pitch) < AXIS_RELEASE_DEADZONE ? 0 : this._axisState.pitch;
        out.yawInput = Math.abs(this._axisState.yaw) < AXIS_RELEASE_DEADZONE ? 0 : this._axisState.yaw;
        out.rollInput = Math.abs(this._axisState.roll) < AXIS_RELEASE_DEADZONE ? 0 : this._axisState.roll;
        out.boost = boostHeld;
        out.boostPressed = boostPressed;
        return out;
    }
}

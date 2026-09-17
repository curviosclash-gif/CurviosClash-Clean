import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import {
    applySteeringReleaseDeadzone,
    clampSteeringAxis as clampAxis,
    createSteeringRampState,
    DEFAULT_AXIS_ATTACK_RATE,
    DEFAULT_AXIS_RELEASE_RATE,
    readAnalogAxis,
    resolveSteeringAxisTarget as resolveInputAxis,
    resolveSteeringStepSeconds,
    stepSteeringAxisToward as stepAxisToward,
    toPositiveSteeringRate as toPositiveRate,
} from '../../shared/input/SteeringRampOps.js';

// Re-exported so the entity setup and the tests keep one name for the rates while
// the ramp itself lives in src/shared, where the network input source reaches it too.
export { DEFAULT_AXIS_ATTACK_RATE, DEFAULT_AXIS_RELEASE_RATE };

export class PlayerController {
    constructor() {
        this._controlState = {
            pitchInput: 0,
            yawInput: 0,
            rollInput: 0,
            boost: false,
            boostPressed: false,
            slowMo: false,
            slowMoPressed: false,
        };
        this._axisState = createSteeringRampState();
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
        let slowMoHeld = false;
        let slowMoPressed = false;

        let pitchIsAnalog = false;
        let yawIsAnalog = false;
        let rollIsAnalog = false;

        const hasDirectInput = !!input && steeringLocked !== true;
        if (hasDirectInput) {
            const pitchAnalog = readAnalogAxis(input, 'pitchAxis');
            const yawAnalog = readAnalogAxis(input, 'yawAxis');
            const rollAnalog = readAnalogAxis(input, 'rollAxis');
            pitchIsAnalog = Number.isFinite(pitchAnalog);
            yawIsAnalog = Number.isFinite(yawAnalog);
            rollIsAnalog = Number.isFinite(rollAnalog);
            pitchTarget = resolveInputAxis(pitchAnalog, input, 'pitchUp', 'pitchDown');
            yawTarget = resolveInputAxis(yawAnalog, input, 'yawLeft', 'yawRight');
            rollTarget = resolveInputAxis(rollAnalog, input, 'rollLeft', 'rollRight');
            boostHeld = !!input.boost;
            boostPressed = !!input.boostPressed;
            slowMoHeld = !!input.slowMo;
            slowMoPressed = !!input.slowMoPressed;

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
            out.slowMo = slowMoHeld;
            out.slowMoPressed = slowMoPressed;
            return out;
        }

        const frameDt = resolveSteeringStepSeconds(dt);
        // Player.controlRampRates spells the keys attackRate/releaseRate; reading
        // them under that name means a per player override really wins over the
        // controller default instead of always falling through to it.
        const attackRate = this._resolveRampRate(player, 'attackRate', this.rampAttackRate);
        const releaseRate = this._resolveRampRate(player, 'releaseRate', this.rampReleaseRate);

        this._axisState.pitch = pitchIsAnalog ? pitchTarget : clampAxis(
            stepAxisToward(this._axisState.pitch, pitchTarget, attackRate, releaseRate, frameDt)
        );
        this._axisState.yaw = yawIsAnalog ? yawTarget : clampAxis(
            stepAxisToward(this._axisState.yaw, yawTarget, attackRate, releaseRate, frameDt)
        );
        this._axisState.roll = rollIsAnalog ? rollTarget : clampAxis(
            stepAxisToward(this._axisState.roll, rollTarget, attackRate, releaseRate, frameDt)
        );

        out.pitchInput = applySteeringReleaseDeadzone(this._axisState.pitch);
        out.yawInput = applySteeringReleaseDeadzone(this._axisState.yaw);
        out.rollInput = applySteeringReleaseDeadzone(this._axisState.roll);
        out.boost = boostHeld;
        out.boostPressed = boostPressed;
        out.slowMo = slowMoHeld;
        out.slowMoPressed = slowMoPressed;
        return out;
    }
}

import * as THREE from 'three';

// Shake oscillation base frequency (Hz-like) — high value produces rapid jitter
const SHAKE_BASE_FREQUENCY = 44;
// Per-player phase offset to decorrelate shake between split-screen players
const SHAKE_PLAYER_PHASE_OFFSET = 11.7;

// Axis amplitude weights — asymmetric to feel more natural
const SHAKE_X_WEIGHT = 0.58;
const SHAKE_Y_WEIGHT = 0.36;
const SHAKE_Z_WEIGHT = 0.42;

// Phase multipliers per axis — co-prime-ish to avoid repeating patterns
const SHAKE_X_PHASE_MUL = 1.9;
const SHAKE_Y_PHASE_MUL = 2.3;
const SHAKE_Y_PHASE_SHIFT = 1.2;
const SHAKE_Z_PHASE_MUL = 2.7;
const SHAKE_Z_PHASE_SHIFT = 2.4;

const SHAKE_AMPLITUDE_EPSILON = 0.0001;

const HAS_PERFORMANCE = typeof performance !== 'undefined' && typeof performance.now === 'function';

export class CameraShakeSolver {
    constructor(timers, durations, intensities) {
        this.timers = timers;
        this.durations = durations;
        this.intensities = intensities;
    }

    trigger(playerIndex, cameraCount, intensity = 0.2, duration = 0.2) {
        if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= cameraCount) return;
        const safeIntensity = THREE.MathUtils.clamp(Number(intensity) || 0, 0, 1.5);
        const safeDuration = Math.max(0.05, Number(duration) || 0.2);
        this.intensities[playerIndex] = Math.max(
            this.intensities[playerIndex] || 0,
            safeIntensity
        );
        this.durations[playerIndex] = Math.max(
            this.durations[playerIndex] || 0,
            safeDuration
        );
        this.timers[playerIndex] = Math.max(
            this.timers[playerIndex] || 0,
            safeDuration
        );
    }

    resolveOffset(playerIndex, dt, out) {
        out.set(0, 0, 0);
        if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= this.timers.length) {
            return out;
        }

        const timer = this.timers[playerIndex] || 0;
        if (timer <= 0) {
            this.intensities[playerIndex] = 0;
            this.durations[playerIndex] = 0;
            return out;
        }

        const duration = Math.max(0.05, this.durations[playerIndex] || timer);
        const nextTimer = Math.max(0, timer - Math.max(0, dt));
        this.timers[playerIndex] = nextTimer;

        const normalized = THREE.MathUtils.clamp(nextTimer / duration, 0, 1);
        const amplitude = Math.max(0, this.intensities[playerIndex] || 0) * normalized;
        if (amplitude <= SHAKE_AMPLITUDE_EPSILON) {
            this.intensities[playerIndex] = 0;
            return out;
        }

        const now = HAS_PERFORMANCE
            ? performance.now() * 0.001
            : Date.now() * 0.001;
        const phase = now * SHAKE_BASE_FREQUENCY + playerIndex * SHAKE_PLAYER_PHASE_OFFSET;
        out.set(
            Math.sin(phase * SHAKE_X_PHASE_MUL) * amplitude * SHAKE_X_WEIGHT,
            Math.cos(phase * SHAKE_Y_PHASE_MUL + SHAKE_Y_PHASE_SHIFT) * amplitude * SHAKE_Y_WEIGHT,
            Math.sin(phase * SHAKE_Z_PHASE_MUL + SHAKE_Z_PHASE_SHIFT) * amplitude * SHAKE_Z_WEIGHT
        );
        return out;
    }
}


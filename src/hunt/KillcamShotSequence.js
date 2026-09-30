import * as THREE from 'three';

export const KILLCAM_SLOWMO_TIMESCALE = 0.38;

export const SHOT_SEQUENCE = Object.freeze([
    Object.freeze({
        id: 'death_flight_chase',
        durationRatio: 0.42,
        radius: 7.5,
        offsetBack: 5.5,
        offsetLift: 1.4,
        orbitSpeed: 0.10,
        lookLift: 0.6,
        fov: 52,
        timeScale: 1.0,
    }),
    Object.freeze({
        id: 'impact_zoom',
        durationRatio: 0.22,
        radius: 4.0,
        offsetBack: 2.0,
        offsetLift: 0.5,
        orbitSpeed: 0.05,
        lookLift: 0.4,
        fov: 46,
        timeScale: 0.7,
    }),
    Object.freeze({
        id: 'explosion_orbit',
        durationRatio: 0.36,
        radius: 9.0,
        offsetBack: 0,
        offsetLift: 3.2,
        orbitSpeed: 0.34,
        lookLift: 0.9,
        fov: 58,
        timeScale: KILLCAM_SLOWMO_TIMESCALE,
    }),
]);

// Compute a uniform rate multiplier so that the cumulative replay-time advance,
// driven by per-shot `timeScale` values, reaches exactly `sourceDuration`
// at the wall-clock instant the explosion is triggered (triggerRatio * displayDuration).
// Without this calibration the slow-mo shots (timeScale < 1) leave the replay
// replay stuck short of the death frame, so the orbit never shows the actual impact.
export function computeReplayRateCalibration(displayDuration, sourceDuration, triggerRatio) {
    const safeD = Math.max(0.001, Number(displayDuration) || 0);
    const safeSource = Math.max(0.001, Number(sourceDuration) || 0);
    const trigger = THREE.MathUtils.clamp(Number(triggerRatio) || 0, 0.001, 1);
    const triggerWall = trigger * safeD;

    let cumulativeScaled = 0;
    let wallElapsed = 0;
    for (const shot of SHOT_SEQUENCE) {
        const shotWall = Math.max(0, Number(shot.durationRatio) || 0) * safeD;
        const shotTimeScale = Number(shot.timeScale) > 0 ? Number(shot.timeScale) : 1;
        if (wallElapsed + shotWall <= triggerWall + 1e-9) {
            cumulativeScaled += shot.durationRatio * shotTimeScale;
            wallElapsed += shotWall;
        } else {
            const remaining = Math.max(0, triggerWall - wallElapsed);
            const partialFraction = shotWall > 0
                ? THREE.MathUtils.clamp(remaining / shotWall, 0, 1)
                : 0;
            cumulativeScaled += shot.durationRatio * partialFraction * shotTimeScale;
            break;
        }
    }

    const baseConsumed = cumulativeScaled * safeD;
    return baseConsumed > 1e-6 ? safeSource / baseConsumed : 1;
}

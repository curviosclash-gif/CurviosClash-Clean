// Camera shake only ever fired when the local player personally took damage, so
// an enemy detonating two metres away was completely silent to the camera, and a
// mega rocket slamming into a wall did not register at all because no damage
// event existed. A blast is a pressure wave: it should be felt by proximity, not
// by whose health bar moved.

// How far a blast reaches, as a multiple of its own radius. Beyond this the wave
// has nothing left to give and the camera stays still.
const REACH_RADIUS_FACTOR = 5;
// Radius that earns the strongest shake. Larger blasts clamp here instead of
// growing without limit.
const FULL_STRENGTH_RADIUS = 12;
const MIN_INTENSITY = 0.1;
const MAX_INTENSITY = 0.45;
const MIN_DURATION = 0.12;
const MAX_DURATION = 0.34;
// Below this the shake is not worth a camera update - it reads as noise.
const INTENSITY_EPSILON = 0.02;

const SILENT = Object.freeze({ intensity: 0, duration: 0 });

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * Resolves how hard one camera is shaken by a blast, from its distance to it.
 * Falloff is quadratic rather than linear so the shake stays a local event: a
 * blast across the arena must not rattle everyone's screen.
 *
 * @param {number} distance - Distance from the camera to the blast centre.
 * @param {number} radius - The blast radius, already scaled by its profile.
 * @returns {{intensity: number, duration: number}} Zero intensity means no shake.
 */
export function resolveBlastShake(distance, radius) {
    const safeRadius = Number(radius);
    const safeDistance = Number(distance);
    if (!Number.isFinite(safeRadius) || safeRadius <= 0) return SILENT;
    if (!Number.isFinite(safeDistance) || safeDistance < 0) return SILENT;

    const reach = safeRadius * REACH_RADIUS_FACTOR;
    if (safeDistance >= reach) return SILENT;

    const closeness = 1 - (safeDistance / reach);
    const peak = clamp(safeRadius / FULL_STRENGTH_RADIUS, MIN_INTENSITY, MAX_INTENSITY);
    const intensity = peak * closeness * closeness;
    if (intensity < INTENSITY_EPSILON) return SILENT;

    // Duration belongs to the event, not to the viewer: a bigger blast rumbles
    // longer for everyone who feels it at all, near or far.
    const duration = clamp(MIN_DURATION + (safeRadius / 40), MIN_DURATION, MAX_DURATION);
    return { intensity, duration };
}

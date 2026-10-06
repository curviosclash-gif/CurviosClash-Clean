// "Bewegung reduzieren" for the Arcade HUD and result panels: only the system wish
// prefers-reduced-motion counts. The camera option cameraPerspective.reduceMotion is on by default
// and only calms the camera; counting it here would take the XP count-up and the sudden death pulse
// away from nearly every player. CSS covers only CSS animations; counters driven by
// requestAnimationFrame and classes that start a pulse ask this function.

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** @returns {boolean} */
export function isArcadeMotionReduced() {
    try {
        return globalThis.matchMedia?.(REDUCED_MOTION_QUERY)?.matches === true;
    } catch {
        return false;
    }
}

// "Bewegung reduzieren" for the Arcade HUD and result panels: only the system wish
// prefers-reduced-motion counts. The camera option cameraPerspective.reduceMotion is on by default
// and only calms the camera; counting it here would take the XP count-up and the sudden death pulse
// away from nearly every player. CSS covers only CSS animations; counters driven by
// requestAnimationFrame and classes that start a pulse ask this function.

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

// The sudden death HUD asks every frame. A MediaQueryList updates its `matches` live, so it is
// built once per matchMedia function and only read afterwards.
let cachedMatchMedia = null;
let cachedQueryList = null;

/** @returns {boolean} */
export function isArcadeMotionReduced() {
    try {
        const matchMedia = globalThis.matchMedia;
        if (typeof matchMedia !== 'function') return false;
        if (matchMedia !== cachedMatchMedia) {
            cachedQueryList = matchMedia.call(globalThis, REDUCED_MOTION_QUERY);
            cachedMatchMedia = matchMedia;
        }
        return cachedQueryList?.matches === true;
    } catch {
        return false;
    }
}

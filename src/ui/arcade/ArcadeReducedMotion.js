// "Bewegung reduzieren" for the Arcade HUD and result panels. The game's own setting
// (cameraPerspective.reduceMotion, on by default, read like HuntHUD does) and the system wish
// prefers-reduced-motion both count. CSS covers only CSS animations; counters driven by
// requestAnimationFrame and classes that start a pulse ask this function.

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * @param {{ runtimeConfig?: { cameraPerspective?: { reduceMotion?: unknown } } } | null | undefined} runtime
 * @returns {boolean}
 */
export function isArcadeMotionReduced(runtime) {
    if (runtime?.runtimeConfig?.cameraPerspective?.reduceMotion !== false) return true;
    try {
        return globalThis.matchMedia?.(REDUCED_MOTION_QUERY)?.matches === true;
    } catch {
        return false;
    }
}

// How large a parcours ring is drawn, in authored map units. The match and the map editor both
// draw the ring from this one rule, so what an author places is what a pilot flies through.

/** Share of the authored checkpoint radius the visible ring takes up. */
export const CHECKPOINT_RING_RADIUS_FACTOR = 0.75;

/** Smallest ring a gate is drawn with, so a tight checkpoint still reads as a ring. */
export const CHECKPOINT_RING_MIN_RADIUS = 3.2;

/** The finish is drawn a little larger than every gate. */
export const FINISH_RING_MIN_RADIUS = 4.2;

const DEFAULT_CHECKPOINT_RADIUS = 4.2;
const DEFAULT_FINISH_RADIUS = 5.5;

/**
 * @param {unknown} radius Authored checkpoint radius in map units.
 * @param {{ finish?: boolean }} [options]
 * @returns {number} Radius of the visible ring in map units.
 */
export function resolveCheckpointRingVisualRadius(radius, { finish = false } = {}) {
    const value = Number(radius);
    const authored = Number.isFinite(value) && value > 0
        ? value
        : (finish ? DEFAULT_FINISH_RADIUS : DEFAULT_CHECKPOINT_RADIUS);
    return Math.max(finish ? FINISH_RING_MIN_RADIUS : CHECKPOINT_RING_MIN_RADIUS, authored * CHECKPOINT_RING_RADIUS_FACTOR);
}

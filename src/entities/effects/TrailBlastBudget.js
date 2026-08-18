// A mega rocket clears 90 m of trail, which is far more destroyed segments than
// the shared particle buffer can draw at eight particles each. The burst used to
// spawn one group per segment regardless, run past the buffer, and recycle its
// own oldest slots - erasing the segments nearest the impact while it was still
// drawing the far end. Spending a fixed budget across the line keeps the whole
// blast visible and leaves slots for the impact, the kill it causes, and every
// other effect that shares the same buffer.

const DEFAULT_BURST_BUDGET = 240;

/**
 * Picks which destroyed segments get a particle group. Below the budget every
 * point is used, so small blasts look exactly as they always did; above it the
 * selection is spread evenly and keeps both ends of the destroyed stretch, so
 * the blast still shows how much trail it actually took out.
 *
 * Thinning skips whole points rather than shaving particles off each one: eight
 * particles read as a small explosion, one or two read as dust. A coarser chain
 * of real blasts along the line beats a continuous haze along the same line.
 *
 * @param {number} pointCount - Number of destroyed segments in this burst.
 * @param {number} particlesPerPoint - Particles one segment costs.
 * @param {number} [budget] - Total particles this burst may spend.
 * @returns {number[]} Indices into the caller's point list, in order.
 */
export function selectTrailBlastIndices(pointCount, particlesPerPoint, budget) {
    const total = Math.max(0, Math.trunc(Number(pointCount) || 0));
    if (total <= 0) return [];

    const perPoint = Math.max(1, Math.trunc(Number(particlesPerPoint) || 1));
    const requested = Number(budget) > 0 ? Number(budget) : DEFAULT_BURST_BUDGET;
    // A budget below one group would spend nothing at all, so one group is the floor.
    const affordable = Math.max(1, Math.floor(Math.max(perPoint, requested) / perPoint));

    if (total <= affordable) {
        const everyPoint = new Array(total);
        for (let i = 0; i < total; i += 1) everyPoint[i] = i;
        return everyPoint;
    }
    if (affordable === 1) return [0];

    const stride = (total - 1) / (affordable - 1);
    const picked = new Array(affordable);
    for (let i = 0; i < affordable; i += 1) picked[i] = Math.round(i * stride);
    return picked;
}

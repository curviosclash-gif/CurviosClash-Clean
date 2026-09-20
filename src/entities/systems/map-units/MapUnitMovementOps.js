/**
 * Moves a map unit along its authored path (E4: a fixed route first, chasing comes later).
 *
 * A unit sits between two path points `fromIndex` -> `toIndex` and has driven `progress` world
 * units along that segment. A looping path closes from the last point back to the first; any other
 * path turns around at both ends. Pure arithmetic on plain arrays, so the host simulation and the
 * tests run the exact same code.
 */

const MAX_SEGMENT_HOPS_PER_STEP = 256;

/**
 * @param {number[][]} path
 * @param {number} fromIndex
 * @param {number} toIndex
 */
function segmentLength(path, fromIndex, toIndex) {
    const from = path[fromIndex];
    const to = path[toIndex];
    return Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
}

export function nextToIndex(pathLength, fromIndex, toIndex, loop) {
    if (loop) return (toIndex + 1) % pathLength;
    const step = toIndex - fromIndex;
    const next = toIndex + step;
    return next < 0 || next >= pathLength ? toIndex - step : next;
}

/** Puts the unit on the first point, heading for the second. */
export function resetUnitOnPath(unit) {
    unit.fromIndex = 0;
    unit.toIndex = 1;
    unit.progress = 0;
}

/**
 * Drives `distance` world units further. Segments of zero length are skipped; the hop limit keeps a
 * path made only of identical points from spinning forever.
 */
export function advanceUnitOnPath(unit, path, distance, loop) {
    if (!Array.isArray(path) || path.length < 2) return;
    let remaining = Math.max(0, Number(distance) || 0);
    for (let hops = 0; hops < MAX_SEGMENT_HOPS_PER_STEP; hops += 1) {
        const length = segmentLength(path, unit.fromIndex, unit.toIndex);
        const left = length - unit.progress;
        if (remaining < left) {
            unit.progress += remaining;
            return;
        }
        remaining -= Math.max(0, left);
        const reachedIndex = unit.toIndex;
        unit.toIndex = nextToIndex(path.length, unit.fromIndex, unit.toIndex, loop);
        unit.fromIndex = reachedIndex;
        unit.progress = 0;
        if (remaining <= 0) return;
    }
}

/**
 * Writes the ground point under the unit and answers the heading of its segment as a yaw around
 * +Y (0 = driving towards +Z), the same convention the unit model is built in.
 */
export function resolveUnitPathPose(unit, path, outPosition) {
    const from = path[unit.fromIndex];
    const to = path[unit.toIndex];
    const length = segmentLength(path, unit.fromIndex, unit.toIndex);
    const t = length > 0.000001 ? Math.min(1, unit.progress / length) : 0;
    outPosition.set(
        from[0] + (to[0] - from[0]) * t,
        from[1] + (to[1] - from[1]) * t,
        from[2] + (to[2] - from[2]) * t,
    );
    const dx = to[0] - from[0];
    const dz = to[2] - from[2];
    return dx * dx + dz * dz > 0.000001 ? Math.atan2(dx, dz) : null;
}

/**
 * Turns `current` towards `target` by at most `maxStep` radians along the shorter way round.
 * The hull turns visibly at a corner instead of snapping to the next segment.
 */
export function turnYawTowards(current, target, maxStep) {
    if (!Number.isFinite(target)) return current;
    let delta = target - current;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) <= maxStep) return target;
    return current + Math.sign(delta) * maxStep;
}

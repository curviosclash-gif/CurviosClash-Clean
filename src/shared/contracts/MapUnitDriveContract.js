/**
 * How a ground map unit drives (A1-A4). Only the kinds that touch the floor carry this block:
 * a tank and the secret room boss. Flying kinds (swarm, bomber) and the creature keep the plain
 * path arithmetic they were authored for.
 *
 * Every switch is a positive list entry with a working default, so a map that says nothing gets
 * the improved driving and a map that says `drive: { steering: false }` gets exactly the old
 * behaviour back. Spatial values go through the same `spatial` helper the rest of the unit block
 * uses, so a map authored in map units scales them with the map.
 */

/** The kinds that drive on the ground and therefore carry a drive block. */
export const MAP_UNIT_DRIVE_KINDS = Object.freeze(['tank', 'boss']);

export const MAP_UNIT_DRIVE_DEFAULTS = Object.freeze({
    // A1: keep the hull on the floor under the authored waypoint.
    groundClamp: true,
    probeHeight: 4,
    maxDrop: 12,
    climbRate: 24,
    // A2: never drive through solid geometry.
    obstacleStop: true,
    blockedSeconds: 2.5,
    // A3: steer towards the waypoint instead of snapping onto the segment.
    steering: true,
    turnRate: 2.5,
    waypointRadius: 2.5,
    // A4: leave the path for a player in reach, but never further than the leash.
    chase: false,
    chaseRange: 60,
    chaseLeash: 40,
    returnSpeedFactor: 1.25,
});

/**
 * @typedef {object} MapUnitDrive
 * @property {boolean} groundClamp
 * @property {number} probeHeight
 * @property {number} maxDrop
 * @property {number} climbRate
 * @property {boolean} obstacleStop
 * @property {number} blockedSeconds
 * @property {boolean} steering
 * @property {number} turnRate
 * @property {number} waypointRadius
 * @property {boolean} chase
 * @property {number} chaseRange
 * @property {number} chaseLeash
 * @property {number} returnSpeedFactor
 */

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function flag(value, fallback) {
    if (value === true) return true;
    if (value === false) return false;
    return fallback;
}

/**
 * @param {unknown} rawDrive
 * @param {(value: unknown, fallback: number, min: number, max: number) => number} clamp
 * @param {(value: unknown, fallback: number, min: number, max: number) => number} spatial
 * @param {string} kind
 * @returns {Readonly<MapUnitDrive> | null}
 */
export function normalizeMapUnitDrive(rawDrive, clamp, spatial, kind) {
    if (!MAP_UNIT_DRIVE_KINDS.includes(String(kind))) return null;
    const source = rawDrive && typeof rawDrive === 'object' ? /** @type {Record<string, unknown>} */ (rawDrive) : {};
    const defaults = MAP_UNIT_DRIVE_DEFAULTS;
    return Object.freeze({
        groundClamp: flag(source.groundClamp, defaults.groundClamp),
        probeHeight: spatial(source.probeHeight, defaults.probeHeight, 0.5, 60),
        maxDrop: spatial(source.maxDrop, defaults.maxDrop, 0.5, 200),
        climbRate: spatial(source.climbRate, defaults.climbRate, 1, 400),
        obstacleStop: flag(source.obstacleStop, defaults.obstacleStop),
        blockedSeconds: clamp(source.blockedSeconds, defaults.blockedSeconds, 0.2, 60),
        steering: flag(source.steering, defaults.steering),
        turnRate: clamp(source.turnRate, defaults.turnRate, 0.2, 12),
        waypointRadius: spatial(source.waypointRadius, defaults.waypointRadius, 0.25, 40),
        chase: flag(source.chase, defaults.chase),
        chaseRange: spatial(source.chaseRange, defaults.chaseRange, 8, 400),
        chaseLeash: spatial(source.chaseLeash, defaults.chaseLeash, 4, 400),
        returnSpeedFactor: clamp(source.returnSpeedFactor, defaults.returnSpeedFactor, 0.5, 4),
    });
}

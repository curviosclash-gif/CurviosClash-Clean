import { normalizeSecretRooms } from '../../shared/contracts/SecretRoomContract.js';

/**
 * Extra boxes a map declares playable although they lie outside the arena bounds.
 *
 * The arena is one box, and everything outside it is wall, floor or exclusion zone. A secret room
 * is deliberately outside - usually buried under the floor - so the boundary question stops being
 * "inside the arena?" and becomes "inside the arena or inside one of its rooms?". Nothing between
 * the two is opened: the rock between the arena floor and a room ceiling belongs to neither box and
 * stays as solid as it is today, which is what keeps the only way in a teleport.
 *
 * The boxes are read once per arena build and kept as plain world-space bounds in the same shape as
 * `arena.bounds`, so the hot path is an array walk over at most three boxes with no allocation. A
 * map without rooms hands over an empty list, and every caller leaves through the length check
 * before it does any work at all.
 *
 * Rule for map authors, because the contract knows nothing about the arena it is placed in and this
 * module deliberately runs no check of its own: a room ceiling belongs at least two map units below
 * the arena floor, and a room is clearly larger than a ship's hit diameter on every axis. A room
 * that overlaps the arena opens a shaft through the floor, and one that only touches it leaves the
 * normal on the seam undecided. The preset tests of the map packages are where that is checked.
 */

/** Neither in a room nor touching one. */
export const PLAYABLE_VOLUME_OUTSIDE = 0;
/** The centre is in a room, but the sphere reaches through one of its walls. */
export const PLAYABLE_VOLUME_WALL = 1;
/** The whole sphere fits inside one room. */
export const PLAYABLE_VOLUME_INSIDE = 2;

/** @typedef {{ minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number }} ArenaPlayableVolume */

/** @type {readonly ArenaPlayableVolume[]} */
const NO_VOLUMES = Object.freeze([]);

/**
 * Rooms of a map as world-space boxes.
 *
 * Authored room coordinates are map units, exactly like the map size that becomes `arena.bounds`,
 * and the arena multiplies that size by the map scale. The rooms have to travel the same way, or a
 * scaled map would put its walls somewhere its room is not.
 *
 * @param {any} mapDefinition Runtime map definition, or anything at all.
 * @param {number} [scale] The map scale the arena bounds were built with.
 * @returns {readonly ArenaPlayableVolume[]}
 */
export function resolveArenaPlayableVolumes(mapDefinition, scale = 1) {
    const rooms = normalizeSecretRooms(mapDefinition?.secretRooms);
    if (rooms.length === 0) return NO_VOLUMES;
    const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
    return Object.freeze(rooms.map((room) => Object.freeze({
        minX: room.bounds.min[0] * factor,
        minY: room.bounds.min[1] * factor,
        minZ: room.bounds.min[2] * factor,
        maxX: room.bounds.max[0] * factor,
        maxY: room.bounds.max[1] * factor,
        maxZ: room.bounds.max[2] * factor,
    })));
}

/**
 * Where a sphere stands in relation to the playable rooms.
 *
 * With a radius of zero the answer degrades to plain point containment, which is what the exclusion
 * zone asks for: a visitor of a room is never "outside the arena".
 *
 * @param {readonly ArenaPlayableVolume[] | null | undefined} volumes
 * @param {{ x: number, y: number, z: number }} position
 * @param {number} [radius]
 * @param {{ set: (x: number, y: number, z: number) => unknown } | null} [outNormal] Receives the
 * inward normal of the touched wall when the answer is `PLAYABLE_VOLUME_WALL`.
 * @returns {number}
 */
export function probeArenaPlayableVolumes(volumes, position, radius = 0, outNormal = null) {
    if (!Array.isArray(volumes) || volumes.length === 0) return PLAYABLE_VOLUME_OUTSIDE;
    const probeRadius = Number.isFinite(radius) && radius > 0 ? radius : 0;
    let answer = PLAYABLE_VOLUME_OUTSIDE;
    for (let index = 0; index < volumes.length; index += 1) {
        const volume = volumes[index];
        // Signed distances to the six walls: positive inside, negative once the wall is behind the
        // point. The collision phase probes ahead of a ship, so the point regularly sits behind the
        // wall rather than on it - reading only points inside the box would leave those probes with
        // the arena's normal, which under a buried room always points straight up.
        // Written out rather than looped over a table of sides: this runs for every ship and every
        // projectile of every frame, and a table would be a fresh array each time.
        let nearest = position.x - volume.minX;
        let nx = 1;
        let ny = 0;
        let nz = 0;
        const dMaxX = volume.maxX - position.x;
        if (dMaxX < nearest) { nearest = dMaxX; nx = -1; ny = 0; nz = 0; }
        const dMinY = position.y - volume.minY;
        if (dMinY < nearest) { nearest = dMinY; nx = 0; ny = 1; nz = 0; }
        const dMaxY = volume.maxY - position.y;
        if (dMaxY < nearest) { nearest = dMaxY; nx = 0; ny = -1; nz = 0; }
        const dMinZ = position.z - volume.minZ;
        if (dMinZ < nearest) { nearest = dMinZ; nx = 0; ny = 0; nz = 1; }
        const dMaxZ = volume.maxZ - position.z;
        if (dMaxZ < nearest) { nearest = dMaxZ; nx = 0; ny = 0; nz = -1; }

        if (nearest >= probeRadius) return PLAYABLE_VOLUME_INSIDE;
        // Out of reach of this room: rock that belongs to the arena, which answers for it as before.
        // The room therefore owns a band as thick as the probe radius around its walls - the same
        // band the arena's own walls have, and the reason the rock above a room ceiling stays rock.
        if (nearest <= -probeRadius) continue;
        if (answer === PLAYABLE_VOLUME_OUTSIDE) {
            answer = PLAYABLE_VOLUME_WALL;
            outNormal?.set(nx, ny, nz);
        }
    }
    return answer;
}

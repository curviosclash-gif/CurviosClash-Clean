// A secret room is the reward behind the portal, so its item points keep their own promise: each
// point holds one item, and a point that was emptied fills up again after the seconds the map
// author wrote down - no matter how full or empty the arena above happens to be.
//
// The arena limit and the room are therefore counted apart. Room items carry a `roomId`, the arena
// spawn counts only what has none, and the room items reach a replica the ordinary way, inside the
// powerup part of the host snapshot.

import { normalizePickupType } from '../PickupRegistry.js';

const OWNER_PREFIX = 'secret-room:';
// The same tolerance the authored anchor clock uses: a sum of uneven frame times has to hit its
// second exactly, not one float step later.
const DUE_EPSILON = 1e-6;

/**
 * Item points of one room, in world units and ready for the tick. Built once per round, so a whole
 * match of frames allocates nothing.
 *
 * @typedef {object} SecretRoomItemPoints
 * @property {string} roomId
 * @property {number} refillSeconds
 * @property {string[]} ownerIds
 * @property {number[][]} positions
 * @property {string[]} authoredTypes Empty where the map author named no type.
 * @property {boolean[]} filled
 * @property {number[]} dueInSeconds Seconds until an empty point spawns again; 0 means now.
 */

/**
 * @param {{ id?: string, refillSeconds?: number, items?: readonly { pos: readonly number[], type?: string }[] }} room
 * @param {number} mapScale
 * @returns {SecretRoomItemPoints | null} `null` for a room without item points.
 */
export function createSecretRoomItemPoints(room, mapScale) {
    const items = Array.isArray(room?.items) ? room.items : [];
    if (items.length === 0) return null;
    const roomId = String(room?.id || '');
    const points = {
        roomId,
        refillSeconds: Math.max(0, Number(room?.refillSeconds) || 0),
        ownerIds: new Array(items.length),
        positions: new Array(items.length),
        authoredTypes: new Array(items.length),
        filled: new Array(items.length).fill(false),
        // Every point is due at once, so the first tick of a round hands out a full room - even
        // while the portal is still shut, because whoever opens it should find it stocked.
        dueInSeconds: new Array(items.length).fill(0),
    };
    for (let index = 0; index < items.length; index += 1) {
        const pos = items[index].pos;
        points.ownerIds[index] = `${OWNER_PREFIX}${roomId}:${index}`;
        points.positions[index] = [
            Number(pos[0]) * mapScale,
            Number(pos[1]) * mapScale,
            Number(pos[2]) * mapScale,
        ];
        points.authoredTypes[index] = normalizePickupType(items[index].type) || '';
    }
    return points;
}

/**
 * Items the arena limit counts. Room items are excluded: their number is the map author's
 * business, and the arena would otherwise stop spawning because a room is stocked.
 * @param {readonly { roomId?: string }[]} items
 * @returns {number}
 */
export function countArenaPowerups(items) {
    let count = 0;
    for (const item of items) {
        if (!item?.roomId) count += 1;
    }
    return count;
}

/**
 * One tick of the refill for every room of the round.
 * @param {object | null} manager The powerup manager; a replica is skipped, only the host spawns.
 * @param {readonly { itemPoints?: SecretRoomItemPoints | null }[]} rooms
 * @param {number} dt Seconds since the last tick.
 * @returns {void}
 */
export function refillSecretRoomItems(manager, rooms, dt) {
    if (!manager || manager.networkReplica === true) return;
    if (!Array.isArray(rooms) || rooms.length === 0) return;
    let pointCount = 0;
    for (const entry of rooms) {
        const points = entry?.itemPoints;
        if (!points) continue;
        points.filled.fill(false);
        pointCount += points.ownerIds.length;
    }
    if (pointCount === 0) return;

    // ponytail: a point counts as empty as soon as its item is gone from the item list - pickup,
    // round clear and snapshot all go through that list, so no extra event is needed. Growing a
    // first class "item was taken" event only pays once something else has to hear it too.
    markFilledPoints(manager.items, rooms);

    const seconds = Math.max(0, Number(dt) || 0);
    const strategy = typeof manager.getStrategy === 'function' ? manager.getStrategy() : null;
    for (const entry of rooms) {
        const points = entry?.itemPoints;
        if (!points) continue;
        for (let index = 0; index < points.ownerIds.length; index += 1) {
            if (points.filled[index]) {
                points.dueInSeconds[index] = points.refillSeconds;
                continue;
            }
            points.dueInSeconds[index] -= seconds;
            if (points.dueInSeconds[index] > DUE_EPSILON) continue;
            if (spawnRoomItem(manager, points, index, strategy)) {
                points.dueInSeconds[index] = points.refillSeconds;
            }
        }
    }
}

/**
 * @param {readonly { roomId?: string, roomPointIndex?: number }[]} items
 * @param {readonly { itemPoints?: SecretRoomItemPoints | null }[]} rooms
 * @returns {void}
 */
function markFilledPoints(items, rooms) {
    for (const item of items) {
        const roomId = item?.roomId;
        if (!roomId) continue;
        for (const entry of rooms) {
            const points = entry?.itemPoints;
            if (!points || points.roomId !== roomId) continue;
            const index = Number(item.roomPointIndex);
            if (Number.isInteger(index) && index >= 0 && index < points.filled.length) {
                points.filled[index] = true;
            }
            break;
        }
    }
}

/**
 * @param {object} manager
 * @param {SecretRoomItemPoints} points
 * @param {number} index
 * @param {object | null} strategy
 * @returns {boolean} Whether an item now stands on the point.
 */
function spawnRoomItem(manager, points, index, strategy) {
    const type = resolveRoomItemType(manager, points.authoredTypes[index], strategy);
    if (!type) return false;
    const position = points.positions[index];
    // The anchored spawn, the same one the authored map anchors use: it places an item exactly
    // where it is told, so the safety distance that keeps random arena spawns away from portals
    // never argues with a point the map author picked - and the way back stands in the room.
    const item = manager.spawnAtAnchor({
        x: position[0],
        y: position[1],
        z: position[2],
        type,
        ownerId: points.ownerIds[index],
    });
    if (!item) return false;
    item.roomId = points.roomId;
    item.roomPointIndex = index;
    points.filled[index] = true;
    return true;
}

/**
 * The authored type wins where the combat mode allows it; otherwise the point draws like any other
 * spawn, through the mode's own weighted choice on the seeded runtime generator.
 * @param {object} manager
 * @param {string} authoredType
 * @param {object | null} strategy
 * @returns {string}
 */
function resolveRoomItemType(manager, authoredType, strategy) {
    const powerupTypes = manager.entityRuntimeConfig?.POWERUP?.TYPES || {};
    const typeKeys = Array.isArray(manager.typeKeys) ? manager.typeKeys : Object.keys(powerupTypes);
    const spawnableTypes = strategy
        ? strategy.filterSpawnableTypes(typeKeys, powerupTypes)
        : typeKeys;
    if (authoredType && spawnableTypes.includes(authoredType)) return authoredType;
    if (spawnableTypes.length === 0) return '';
    // Without a strategy there is no seeded generator either, and reaching for the global random
    // would make the round unreproducible: the first allowed type is the honest answer.
    if (!strategy) return spawnableTypes[0];
    return String(strategy.resolveSpawnType(spawnableTypes, manager.entityRuntimeConfig, {}) || '');
}

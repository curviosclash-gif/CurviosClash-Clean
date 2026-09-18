import { MAP_SCHEMA_COLLECTION_LIMITS } from './MapSchemaConstants.js';
import { normalizeSecretRooms } from '../../shared/contracts/SecretRoomContract.js';

/**
 * Secret rooms in the map schema.
 *
 * The map schema is a positive list: a block it does not know about is dropped silently while
 * loading. This module is the place where the `secretRooms` block is recognised, so an authored
 * room survives a save/load round trip, and where the authored map units are divided by the map
 * scale on the way into the runtime map definition - exactly like portals, turrets and gates.
 *
 * The block stays optional. A map without secret rooms keeps the document it had before, so every
 * existing map and every snapshot test stays byte for byte the same.
 */

/**
 * @param {readonly number[]} pos
 * @param {number} invScale
 * @returns {number[]}
 */
function scalePos(pos, invScale) {
    return [pos[0] * invScale, pos[1] * invScale, pos[2] * invScale];
}

/**
 * Turns one normalized room back into the plain, mutable JSON shape the map document is made of.
 * @param {any} room
 * @param {number} invScale
 * @returns {Record<string, any>}
 */
function toPlainRoom(room, invScale) {
    /** @type {Record<string, any>} */
    const plain = {
        id: room.id,
        modes: [...room.modes],
        entryPortal: { pos: scalePos(room.entryPortal.pos, invScale), color: room.entryPortal.color },
        roomPortal: { pos: scalePos(room.roomPortal.pos, invScale) },
        bounds: {
            min: scalePos(room.bounds.min, invScale),
            max: scalePos(room.bounds.max, invScale),
        },
        ejectPoint: { pos: scalePos(room.ejectPoint.pos, invScale), yawDeg: room.ejectPoint.yawDeg },
        stayLimitSeconds: room.stayLimitSeconds,
        refillSeconds: room.refillSeconds,
        items: room.items.map((/** @type {any} */ item) => {
            /** @type {Record<string, any>} */
            const entry = { pos: scalePos(item.pos, invScale) };
            if (item.type) entry.type = item.type;
            return entry;
        }),
    };
    if (room.unlock) {
        /** @type {Record<string, any>} */
        const unlock = {
            destructible: room.unlock.destructible,
            when: room.unlock.when,
            delaySeconds: room.unlock.delaySeconds,
        };
        if (room.unlock.segmentId) unlock.segmentId = room.unlock.segmentId;
        plain.unlock = unlock;
    }
    return plain;
}

/**
 * Reads the `secretRooms` block of a raw map for the schema document. Authored coordinates are
 * kept as they are; only the runtime conversion scales them.
 * @param {unknown} rawSecretRooms
 * @param {{ warnings?: string[] | null }} [options]
 * @returns {Record<string, any>[]}
 */
export function sanitizeSecretRoomList(rawSecretRooms, options = {}) {
    const entries = Array.isArray(rawSecretRooms) ? rawSecretRooms : [];
    const limit = MAP_SCHEMA_COLLECTION_LIMITS.secretRooms;
    if (Number.isFinite(limit) && entries.length > limit) {
        throw new Error(`Map collection "secretRooms" exceeds the limit of ${limit}.`);
    }
    const warnings = Array.isArray(options?.warnings) ? options.warnings : undefined;
    const rooms = normalizeSecretRooms(entries, warnings ? { warnings } : {});
    return rooms.map((room) => toPlainRoom(room, 1));
}

/**
 * Hands the block to the runtime map definition, divided by the map scale like every other authored
 * position. The result is still map units, the same ones the arena multiplies by the map scale
 * while it builds - world units only exist inside the arena.
 * @param {unknown} secretRooms
 * @param {number} invScale
 * @returns {Record<string, any>[] | null}
 */
export function toRuntimeSecretRooms(secretRooms, invScale) {
    const rooms = normalizeSecretRooms(secretRooms);
    if (rooms.length === 0) return null;
    return rooms.map((room) => toPlainRoom(room, invScale));
}

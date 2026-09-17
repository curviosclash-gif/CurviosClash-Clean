/**
 * Contract for the hidden rooms a map can hold.
 *
 * A secret room is a sealed volume outside the normal arena - usually below its floor - that a
 * player can only reach through one portal. The map preset says where that entry portal stands,
 * where the room lies, how long a visitor may stay, where the room throws him back out, and which
 * item points grow back inside it. A room may stay hidden until a destructible structure of the
 * same map loses a part, which is what turns a landmark collapse into a reward.
 *
 * Two sides have to read this the same way: the map pipeline, which carries the authored block
 * through the schema into the runtime map definition, and the runtime, which decides every frame
 * whether a portal teleports and whether a player is still inside. Both go through the normalizer
 * here, so an authored room can never mean one thing while loading and another while playing.
 *
 * Coordinates stay exactly as the map author wrote them. Custom maps are authored in map units and
 * the map pipeline divides them by the map scale on its way into the runtime definition
 * (`MapSchemaRuntimeOps`), the same way portals, turrets and gates are scaled; map presets are
 * already authored in world units and pass straight through. Scaling therefore belongs to the
 * runtime conversion and must not happen twice - this contract never touches the numbers.
 *
 * Unlocking needs no network message. The destructible state is already reconciled between host
 * and clients (`MapDestructibleContract`), so every machine adds the same delay to the same
 * recorded break time and opens the portal in the same second.
 *
 * Plausibility is enforced, not merely documented, because a room that contradicts itself is worse
 * than no room at all: a way back outside the room would strand the visitor, an entry portal inside
 * the room would be unreachable, and an eject point inside the room would throw the player straight
 * back into the room he just left. Such a room is dropped whole. A single item point outside the
 * room only loses itself - the room around it still works.
 */

export const SECRET_ROOM_CONTRACT_VERSION = 'secret-room.v1';

/** Modes a secret room can be active in. An empty authored list means all of them. */
export const SECRET_ROOM_MODES = Object.freeze(['HUNT', 'ARCADE']);

/**
 * Ranges are data, not numbers buried in code, so authoring tools and tests read the same bounds.
 * The fallbacks are the agreed balancing values: 20 s of stay, 30 s until an item point refills,
 * and 4 s between a break and the portal appearing, which lets the collapse play first.
 */
export const SECRET_ROOM_LIMITS = Object.freeze({
    maxRooms: 3,
    maxItems: 16,
    idMaxLength: 80,
    minBoundsExtent: 0.001,
    stayLimitSeconds: Object.freeze({ min: 5, max: 120, fallback: 20 }),
    refillSeconds: Object.freeze({ min: 5, max: 300, fallback: 30 }),
    unlockDelaySeconds: Object.freeze({ min: 0, max: 60, fallback: 4 }),
});

/** Colour an entry portal falls back to; matches the first default portal colour of the arena. */
const DEFAULT_ENTRY_PORTAL_COLOR = 0x00ffcc;
const MAX_PORTAL_COLOR = 0xffffff;
const DEGREES_PER_TURN = 360;

/**
 * @typedef {object} SecretRoomBounds
 * @property {readonly number[]} min Lowest corner of the room box, per axis.
 * @property {readonly number[]} max Highest corner of the room box, per axis.
 */

/**
 * @typedef {object} SecretRoomEntryPortal
 * @property {readonly number[]} pos Place in the arena the portal stands at.
 * @property {number} color Portal colour as a packed RGB integer.
 */

/**
 * @typedef {object} SecretRoomAnchor
 * @property {readonly number[]} pos
 */

/**
 * @typedef {object} SecretRoomEjectPoint
 * @property {readonly number[]} pos Safe place in the arena the room throws a visitor back to.
 * @property {number} yawDeg Heading the visitor faces afterwards, in [0, 360).
 */

/**
 * @typedef {object} SecretRoomItem
 * @property {readonly number[]} pos
 * @property {string} [type] Pickup key in upper case; absent means the map decides.
 */

/**
 * How a room reads the destructible state of its map.
 * - `anyBreak`: the first broken part of the named structure opens the portal.
 * - `sealed`: only a structure that has come down whole opens it.
 * - `segment`: one named part has to break; authored as `when: { segmentId }`.
 *
 * @typedef {object} SecretRoomUnlock
 * @property {string} destructible Id of the destructible structure whose state is watched.
 * @property {'anyBreak'|'sealed'|'segment'} when
 * @property {string} segmentId Segment that has to break; empty unless `when` is `segment`.
 * @property {number} delaySeconds Seconds between the break and the portal appearing.
 */

/**
 * @typedef {object} SecretRoom
 * @property {string} id
 * @property {readonly string[]} modes
 * @property {Readonly<SecretRoomEntryPortal>} entryPortal
 * @property {Readonly<SecretRoomAnchor>} roomPortal Way back, standing inside the room.
 * @property {Readonly<SecretRoomBounds>} bounds
 * @property {Readonly<SecretRoomEjectPoint>} ejectPoint
 * @property {number} stayLimitSeconds
 * @property {number} refillSeconds
 * @property {readonly Readonly<SecretRoomItem>[]} items
 * @property {Readonly<SecretRoomUnlock> | null} unlock Null means the portal is open from the start.
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {string[] | null} warnings
 * @param {string} message
 * @returns {void}
 */
function pushWarning(warnings, message) {
    if (warnings) warnings.push(message);
}

/**
 * Empty strings, booleans and null are not coordinates, although Number() would happily turn them
 * into zero - a silent zero would put a room at the arena centre.
 * @param {unknown} value
 * @returns {number}
 */
function readCoordinate(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return NaN;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * @param {unknown} value
 * @returns {number[] | null}
 */
function readVector3(value) {
    if (!Array.isArray(value) || value.length < 3) return null;
    const x = readCoordinate(value[0]);
    const y = readCoordinate(value[1]);
    const z = readCoordinate(value[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return [x, y, z];
}

/**
 * A point may arrive as an authored array or as a runtime vector object.
 * @param {unknown} value
 * @returns {number[] | null}
 */
function readPoint(value) {
    if (Array.isArray(value)) return readVector3(value);
    if (!isRecord(value)) return null;
    const x = readCoordinate(value.x);
    const y = readCoordinate(value.y);
    const z = readCoordinate(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return [x, y, z];
}

/**
 * @param {unknown} value
 * @param {{ min: number, max: number, fallback: number }} range
 * @returns {number}
 */
function clampNumber(value, range) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return range.fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return range.fallback;
    return Math.min(range.max, Math.max(range.min, parsed));
}

/**
 * @param {unknown} value
 * @param {number} maxLength
 * @returns {string}
 */
function readText(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function readColor(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_ENTRY_PORTAL_COLOR;
    return Math.min(MAX_PORTAL_COLOR, Math.max(0, Math.trunc(parsed)));
}

/**
 * Headings are compared, so they have to live in one range.
 * @param {unknown} value
 * @returns {number}
 */
function readYawDeg(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    const wrapped = parsed % DEGREES_PER_TURN;
    if (wrapped < 0) return wrapped + DEGREES_PER_TURN;
    return wrapped || 0;
}

/**
 * Swapped corners are put back in order, because an author typing the far corner first still means
 * the same box. A box without volume on any axis is not a room and is refused.
 * @param {unknown} value
 * @returns {Readonly<SecretRoomBounds> | null}
 */
function readBounds(value) {
    if (!isRecord(value)) return null;
    const first = readVector3(value.min);
    const second = readVector3(value.max);
    if (!first || !second) return null;
    /** @type {number[]} */
    const min = [];
    /** @type {number[]} */
    const max = [];
    for (let axis = 0; axis < 3; axis += 1) {
        const low = Math.min(first[axis], second[axis]);
        const high = Math.max(first[axis], second[axis]);
        if (high - low < SECRET_ROOM_LIMITS.minBoundsExtent) return null;
        min.push(low);
        max.push(high);
    }
    return Object.freeze({ min: Object.freeze(min), max: Object.freeze(max) });
}

/**
 * @param {Readonly<SecretRoomBounds>} bounds
 * @param {readonly number[]} point
 * @returns {boolean}
 */
function boundsContain(bounds, point) {
    for (let axis = 0; axis < 3; axis += 1) {
        if (point[axis] < bounds.min[axis]) return false;
        if (point[axis] > bounds.max[axis]) return false;
    }
    return true;
}

/**
 * An unlock block that names no structure cannot be resolved later. Treating it as "no unlock"
 * would hand the secret to every player from the first second, so the room is refused instead.
 * @param {unknown} value
 * @returns {{ ok: boolean, unlock: Readonly<SecretRoomUnlock> | null }}
 */
function readUnlock(value) {
    if (!isRecord(value)) return { ok: true, unlock: null };
    const destructible = readText(value.destructible, SECRET_ROOM_LIMITS.idMaxLength);
    if (!destructible) return { ok: false, unlock: null };

    /** @type {'anyBreak'|'sealed'|'segment'} */
    let when = 'anyBreak';
    let segmentId = '';
    if (isRecord(value.when)) {
        const named = readText(value.when.segmentId, SECRET_ROOM_LIMITS.idMaxLength);
        if (named) {
            when = 'segment';
            segmentId = named;
        }
    } else if (readText(value.when, SECRET_ROOM_LIMITS.idMaxLength) === 'sealed') {
        when = 'sealed';
    }

    return {
        ok: true,
        unlock: Object.freeze({
            destructible,
            when,
            segmentId,
            delaySeconds: clampNumber(value.delaySeconds, SECRET_ROOM_LIMITS.unlockDelaySeconds),
        }),
    };
}

/**
 * @param {unknown} value
 * @param {Readonly<SecretRoomBounds>} bounds
 * @param {string} roomId
 * @param {string[] | null} warnings
 * @returns {Readonly<SecretRoomItem>[]}
 */
function readItems(value, bounds, roomId, warnings) {
    /** @type {Readonly<SecretRoomItem>[]} */
    const items = [];
    if (!Array.isArray(value)) return items;
    for (const entry of value) {
        if (items.length >= SECRET_ROOM_LIMITS.maxItems) break;
        if (!isRecord(entry)) continue;
        const pos = readVector3(entry.pos);
        if (!pos) continue;
        if (!boundsContain(bounds, pos)) {
            pushWarning(warnings, `Secret room "${roomId}" dropped an item point outside its bounds.`);
            continue;
        }
        /** @type {{ pos: readonly number[], type?: string }} */
        const item = { pos: Object.freeze(pos) };
        const type = readText(entry.type, SECRET_ROOM_LIMITS.idMaxLength).toUpperCase();
        if (type) item.type = type;
        items.push(Object.freeze(item));
    }
    return items;
}

/**
 * Unknown mode names are dropped. A room left without any known mode is treated like a room that
 * named none at all and runs everywhere, which is the same reading the destructible contract uses.
 * @param {unknown} value
 * @returns {string[]}
 */
function readModes(value) {
    /** @type {string[]} */
    const modes = [];
    if (Array.isArray(value)) {
        for (const entry of value) {
            const upper = readText(entry, SECRET_ROOM_LIMITS.idMaxLength).toUpperCase();
            if (SECRET_ROOM_MODES.includes(upper) && !modes.includes(upper)) modes.push(upper);
        }
    }
    return modes.length > 0 ? modes : [...SECRET_ROOM_MODES];
}

/**
 * @param {unknown} entry
 * @param {string[] | null} warnings
 * @returns {Readonly<SecretRoom> | null}
 */
function readRoom(entry, warnings) {
    if (!isRecord(entry)) return null;
    const id = readText(entry.id, SECRET_ROOM_LIMITS.idMaxLength);
    if (!id) {
        pushWarning(warnings, 'A secret room without a usable id was ignored.');
        return null;
    }

    const bounds = readBounds(entry.bounds);
    if (!bounds) {
        pushWarning(warnings, `Secret room "${id}" was ignored because its bounds enclose no volume.`);
        return null;
    }

    const roomPortalSource = isRecord(entry.roomPortal) ? entry.roomPortal : null;
    const roomPortalPos = readVector3(roomPortalSource ? roomPortalSource.pos : null);
    if (!roomPortalPos || !boundsContain(bounds, roomPortalPos)) {
        pushWarning(warnings, `Secret room "${id}" was ignored because its way back is not inside the room.`);
        return null;
    }

    const entryPortalSource = isRecord(entry.entryPortal) ? entry.entryPortal : null;
    const entryPortalPos = readVector3(entryPortalSource ? entryPortalSource.pos : null);
    if (!entryPortalPos || boundsContain(bounds, entryPortalPos)) {
        pushWarning(warnings, `Secret room "${id}" was ignored because its entry portal is not in the arena.`);
        return null;
    }

    const ejectSource = isRecord(entry.ejectPoint) ? entry.ejectPoint : null;
    const ejectPos = readVector3(ejectSource ? ejectSource.pos : null);
    if (!ejectPos || boundsContain(bounds, ejectPos)) {
        pushWarning(warnings, `Secret room "${id}" was ignored because its eject point is not in the arena.`);
        return null;
    }

    const unlockResult = readUnlock(entry.unlock);
    if (!unlockResult.ok) {
        pushWarning(warnings, `Secret room "${id}" was ignored because its unlock names no structure.`);
        return null;
    }

    return Object.freeze({
        id,
        modes: Object.freeze(readModes(entry.modes)),
        entryPortal: Object.freeze({
            pos: Object.freeze(entryPortalPos),
            color: readColor(entryPortalSource ? entryPortalSource.color : null),
        }),
        roomPortal: Object.freeze({ pos: Object.freeze(roomPortalPos) }),
        bounds,
        ejectPoint: Object.freeze({
            pos: Object.freeze(ejectPos),
            yawDeg: readYawDeg(ejectSource ? ejectSource.yawDeg : null),
        }),
        stayLimitSeconds: clampNumber(entry.stayLimitSeconds, SECRET_ROOM_LIMITS.stayLimitSeconds),
        refillSeconds: clampNumber(entry.refillSeconds, SECRET_ROOM_LIMITS.refillSeconds),
        items: Object.freeze(readItems(entry.items, bounds, id, warnings)),
        unlock: unlockResult.unlock,
    });
}

/**
 * Accepts the `secretRooms` block of a map in any state and returns the rooms that can be played.
 * Never throws: a map from an older or hand-edited file has to stay loadable.
 * @param {unknown} list
 * @param {{ warnings?: string[] }} [options]
 * @returns {readonly Readonly<SecretRoom>[]}
 */
export function normalizeSecretRooms(list, options = {}) {
    const warnings = Array.isArray(options?.warnings) ? options.warnings : null;
    /** @type {Readonly<SecretRoom>[]} */
    const rooms = [];
    /** @type {Set<string>} */
    const seenIds = new Set();
    for (const entry of Array.isArray(list) ? list : []) {
        if (rooms.length >= SECRET_ROOM_LIMITS.maxRooms) break;
        const room = readRoom(entry, warnings);
        if (!room) continue;
        if (seenIds.has(room.id)) {
            pushWarning(warnings, `Secret room "${room.id}" was ignored because that id is already taken.`);
            continue;
        }
        seenIds.add(room.id);
        rooms.push(room);
    }
    return Object.freeze(rooms);
}

/**
 * Whether a point lies in the room box, faces included. Works on a normalized room as well as on
 * an authored one, so a preset test needs no runtime.
 * @param {unknown} room
 * @param {unknown} point
 * @returns {boolean}
 */
export function isPointInSecretRoom(room, point) {
    if (!isRecord(room) || !isRecord(room.bounds)) return false;
    const min = readVector3(room.bounds.min);
    const max = readVector3(room.bounds.max);
    if (!min || !max) return false;
    const target = readPoint(point);
    if (!target) return false;
    for (let axis = 0; axis < 3; axis += 1) {
        if (target[axis] < Math.min(min[axis], max[axis])) return false;
        if (target[axis] > Math.max(min[axis], max[axis])) return false;
    }
    return true;
}

/**
 * @param {unknown} event
 * @returns {number | null}
 */
function readEventSeconds(event) {
    if (!isRecord(event)) return null;
    const parsed = Number(event.atSeconds);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Match second from which the entry portal of a room is open.
 *
 * A room without an unlock is open from the start. Otherwise the answer comes purely from the
 * reconciled destructible state, which carries the recorded break events and whether the structure
 * has come down whole - both the live host state and the serialized wire form have that same shape,
 * so host and replica compute the same second without exchanging a single extra message. The id in
 * `unlock.destructible` says which structure a caller has to hand in; this function trusts the
 * state it is given. `Infinity` means the portal is still shut.
 * @param {unknown} room
 * @param {unknown} destructibleState
 * @returns {number}
 */
export function resolveSecretRoomUnlockSeconds(room, destructibleState) {
    if (!isRecord(room)) return Infinity;
    const unlock = isRecord(room.unlock) ? room.unlock : null;
    if (!unlock) return 0;

    const when = typeof unlock.when === 'string' ? unlock.when : 'anyBreak';
    const segmentId = readText(unlock.segmentId, SECRET_ROOM_LIMITS.idMaxLength);
    const delaySeconds = clampNumber(unlock.delaySeconds, SECRET_ROOM_LIMITS.unlockDelaySeconds);

    const state = isRecord(destructibleState) ? destructibleState : null;
    const events = state && Array.isArray(state.events) ? state.events : null;
    if (!events || events.length === 0) return Infinity;

    if (when === 'sealed') {
        if (state?.sealed !== true) return Infinity;
        let latest = -Infinity;
        for (const event of events) {
            const atSeconds = readEventSeconds(event);
            if (atSeconds !== null && atSeconds > latest) latest = atSeconds;
        }
        return latest === -Infinity ? Infinity : latest + delaySeconds;
    }

    let earliest = Infinity;
    for (const event of events) {
        if (when === 'segment') {
            if (!segmentId) return Infinity;
            const eventSegmentId = isRecord(event) ? readText(event.segmentId, SECRET_ROOM_LIMITS.idMaxLength) : '';
            if (eventSegmentId !== segmentId) continue;
        }
        const atSeconds = readEventSeconds(event);
        if (atSeconds !== null && atSeconds < earliest) earliest = atSeconds;
    }
    return earliest === Infinity ? Infinity : earliest + delaySeconds;
}

/**
 * Whether a room exists in the given game mode. A room that names no mode runs in every mode.
 * @param {unknown} room
 * @param {unknown} modeType
 * @returns {boolean}
 */
export function isSecretRoomActiveInMode(room, modeType) {
    if (!isRecord(room)) return false;
    const modes = Array.isArray(room.modes) ? room.modes : [];
    if (modes.length === 0) return true;
    const wanted = readText(modeType, SECRET_ROOM_LIMITS.idMaxLength).toUpperCase();
    if (!wanted) return false;
    return modes.some((mode) => readText(mode, SECRET_ROOM_LIMITS.idMaxLength).toUpperCase() === wanted);
}

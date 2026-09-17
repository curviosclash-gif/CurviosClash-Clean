import * as THREE from 'three';
import { normalizeSecretRooms } from '../../../shared/contracts/SecretRoomContract.js';

/**
 * Portal pairs of the hidden rooms a map carries.
 *
 * A secret room is reached through one pair only: side A stands in the arena, side B inside the
 * room. Both endpoints are used exactly as the map author wrote them - unlike an authored portal
 * pair, they never go through `resolvePortalPosition`, because the rescue there pulls an endpoint
 * that sits in solid ground back into the arena, and the way back of a room below the floor is
 * meant to sit exactly there.
 *
 * A pair is born shut. Who opens it, and when, is the business of `SecretRoomSystem`; this module
 * only owns the two things a portal needs for that: the flag the runtime reads and the meshes.
 */

/**
 * @param {readonly number[]} pos Authored point in map units.
 * @param {number} scale
 * @returns {THREE.Vector3}
 */
function toWorldPosition(pos, scale) {
    return new THREE.Vector3(Number(pos[0]) * scale, Number(pos[1]) * scale, Number(pos[2]) * scale);
}

/**
 * Adds one shut pair per authored room to the arena the builder is filling.
 * @param {{ arena: { portals: object[] }, _addPortalInstance: Function }} builder
 * @param {unknown} map
 * @param {number} scale
 * @returns {number} Pairs that were added.
 */
export function buildSecretRoomPortals(builder, map, scale) {
    const rooms = normalizeSecretRooms(/** @type {{ secretRooms?: unknown }} */ (map || {})?.secretRooms);
    if (rooms.length === 0) return 0;
    const portals = builder.arena.portals;
    let added = 0;
    for (const room of rooms) {
        const posA = toWorldPosition(room.entryPortal.pos, scale);
        const posB = toWorldPosition(room.roomPortal.pos, scale);
        if (!builder._addPortalInstance(posA, posB, room.entryPortal.color)) continue;
        const portal = portals[portals.length - 1];
        portal.secret = true;
        portal.roomId = room.id;
        setSecretRoomPortalOpen(portal, false);
        added += 1;
    }
    return added;
}

/**
 * Opens or shuts one secret pair. A shut pair is hidden as well as inert, so a room stays a
 * secret until it is earned.
 * @param {{ active?: boolean, meshA?: { visible: boolean }, meshB?: { visible: boolean } } | null} portal
 * @param {boolean} open
 * @returns {void}
 */
export function setSecretRoomPortalOpen(portal, open) {
    if (!portal) return;
    portal.active = open === true;
    if (portal.meshA) portal.meshA.visible = portal.active;
    if (portal.meshB) portal.meshB.visible = portal.active;
}

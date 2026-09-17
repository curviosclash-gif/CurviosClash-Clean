import {
    isSecretRoomActiveInMode,
    normalizeSecretRooms,
    resolveSecretRoomUnlockSeconds,
} from '../../shared/contracts/SecretRoomContract.js';
import { setSecretRoomPortalOpen } from '../arena/portal/SecretRoomPortalOps.js';

/**
 * Runtime owner of the hidden rooms of a map.
 *
 * The arena builds one shut portal pair per authored room. This system decides which of those
 * pairs belong to the round at all, and from which match second each of them is open.
 *
 * The second is derived, never announced: it comes from the destructible state, which host and
 * replica already reconcile, plus the delay the map author wrote down. Both machines therefore
 * open the same portal in the same second without a message of their own. The clock compared
 * against is the one the break events are stamped with - the map clock of the arena - and not
 * the simulation clock, because a replica takes that map clock straight from the host snapshot.
 *
 * Once open, a pair stays open until the round ends. A round restart shuts every pair again.
 */
export class SecretRoomSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        /** @type {{ room: object, portal: object, unlockSeconds: number, open: boolean }[]} */
        this._rooms = [];
        this._closedCount = 0;
        this._stateSignature = '';
    }

    /**
     * Picks the pairs of this round and shuts them. A room that does not exist in the mode being
     * played keeps its pair shut and hidden, so nobody can stumble into it.
     * @returns {number} Rooms taking part in this round.
     */
    startRound() {
        const arena = this.entityManager?.arena;
        this._rooms.length = 0;
        this._closedCount = 0;
        this._stateSignature = '';
        const portals = Array.isArray(arena?.portals) ? arena.portals : null;
        if (!portals) return 0;

        const authored = normalizeSecretRooms(arena?.currentMapDefinition?.secretRooms);
        const strategy = this.entityManager?.gameModeStrategy || null;
        // The combat mode decides, not the menu mode: an arcade run with hunt items is played as
        // a fight, and that is the mode a room states it belongs to.
        const modeType = strategy?.getPickupModeType?.() || strategy?.modeType || '';
        for (const portal of portals) {
            if (portal?.secret !== true) continue;
            setSecretRoomPortalOpen(portal, false);
            const room = authored.find((entry) => entry.id === portal.roomId) || null;
            // Not part of this mode: the pair stays shut and hidden for the round. It is not
            // removed, because a built arena can be played again in another mode without a rebuild.
            if (!room || !isSecretRoomActiveInMode(room, modeType)) continue;
            this._rooms.push({ room, portal, unlockSeconds: Infinity, open: false });
        }
        this._closedCount = this._rooms.length;
        // A room that needs no break is open in the first second, without waiting for a tick.
        this.update();
        return this._rooms.length;
    }

    /** The rooms of this round, for the stay clock and the item refill that build on them. */
    getRooms() {
        return this._rooms;
    }

    update() {
        if (this._closedCount === 0) return;
        const state = this._resolveDestructibleState();
        // Recomputing the unlock second costs a pass over the break events, so it happens when
        // that list actually changed - on the host after a break, on a replica after a snapshot.
        const eventCount = Array.isArray(state?.events) ? state.events.length : 0;
        const signature = state ? `${eventCount}|${state.sealed === true}` : 'none';
        if (signature !== this._stateSignature) {
            this._stateSignature = signature;
            for (const entry of this._rooms) {
                if (entry.open) continue;
                entry.unlockSeconds = resolveRoomUnlockSeconds(entry.room, state);
            }
        }

        const elapsedSeconds = Number(this.entityManager?.arena?.glbAnimationElapsedSeconds) || 0;
        for (const entry of this._rooms) {
            if (entry.open || elapsedSeconds < entry.unlockSeconds) continue;
            entry.open = true;
            this._closedCount -= 1;
            setSecretRoomPortalOpen(entry.portal, true);
        }
    }

    /** Destructible state of this round, or null when this map is not destructible in this mode. */
    _resolveDestructibleState() {
        const system = this.entityManager?._mapDestructibleSystem || null;
        if (!system || system.isActive?.() !== true) return null;
        return system.getState?.() || null;
    }
}

/**
 * Match second a room's portal opens from, `Infinity` while it is still shut.
 *
 * A room whose condition can never come true would keep its portal shut for the whole match and
 * silently take a piece of the map out of play, so both such cases open the portal from the start
 * instead: a map that is not destructible in this mode at all, and an unlock naming a part that
 * this map does not have.
 * @param {object} room
 * @param {{ segments?: { id: string }[] } | null} state
 * @returns {number}
 */
function resolveRoomUnlockSeconds(room, state) {
    const unlock = /** @type {{ when?: string, segmentId?: string } | null} */ (room?.unlock || null);
    if (!unlock) return 0;
    if (!state) return 0;
    if (unlock.when === 'segment'
        && !state.segments?.some((segment) => segment?.id === unlock.segmentId)) {
        return 0;
    }
    return resolveSecretRoomUnlockSeconds(room, state);
}

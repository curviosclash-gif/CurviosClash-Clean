import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import {
    isPointInSecretRoom,
    isSecretRoomActiveInMode,
    isSecretRoomReleaseSource,
    normalizeSecretRooms,
    resolveSecretRoomUnlockSeconds,
} from '../../shared/contracts/SecretRoomContract.js';
import { setSecretRoomPortalOpen } from '../arena/portal/SecretRoomPortalOps.js';
import {
    createSecretRoomItemPoints,
    refillSecretRoomItems,
} from '../powerup/SecretRoomRefillOps.js';

const DEGREES_TO_RADIANS = Math.PI / 180;

/**
 * Runtime owner of the hidden rooms of a map.
 *
 * The arena builds one shut portal pair per authored room. This system decides which of those
 * pairs belong to the round at all, and from which match second each of them is open.
 *
 * The second is derived, never announced: it comes from reconciled destructible state or seed
 * release progress, plus the delay the map author wrote down. Both machines therefore open the
 * same portal in the same second without a message of their own. The clock compared against is the
 * map clock stamped onto the event, not the simulation clock, because a replica takes that map
 * clock straight from the host snapshot.
 *
 * Once open, a pair stays open until the round ends. A round restart shuts every pair again.
 *
 * The stay clock works the other way round: it needs the simulation's own `dt`, because it is the
 * player who is being measured, not the map. Every visitor of an open room carries his own clock
 * (E41), and when it runs out the host puts him back on the safe place the map author picked
 * (E43). A replica runs the very same clock on its reconciled positions, but only to show the
 * countdown - moving players is the host's business alone.
 */
export class SecretRoomSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        /** @type {SecretRoomEntry[]} */
        this._rooms = [];
        this._closedCount = 0;
        this._openedCount = 0;
        this.networkReplica = false;
        // Fixed per player index, so a whole match of ticks allocates nothing: the room a player
        // stands in, and the HUD object the projection copies from.
        /** @type {number[]} */
        this._stayRoomIndex = [];
        /** @type {{ inside: boolean, remainingSeconds: number, roomId: string }[]} */
        this._hudStates = [];
        // Reused view of a plant whose room needs only a share of its parts (see _resolveShareState).
        this._shareState = { total: 0, released: 0, remaining: 0, allReleased: false, completedAtSeconds: 0 };
        this._seedObjective = {
            source: '',
            total: 0,
            released: 0,
            allReleased: false,
            completedAtSeconds: 0,
            portalOpen: false,
            portalPosition: { x: 0, y: 0, z: 0 },
        };
    }

    /** Only the host moves players, so only the host ejects. A replica just counts for the HUD. */
    setNetworkReplica(enabled) {
        this.networkReplica = enabled === true;
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
        this._openedCount = 0;
        this._resetStayClocks();
        const portals = Array.isArray(arena?.portals) ? arena.portals : null;
        if (!portals) return 0;

        const authored = normalizeSecretRooms(arena?.currentMapDefinition?.secretRooms);
        const config = resolveGameplayConfig(this.entityManager);
        const mapScale = Math.max(0.001, Number(config.ARENA?.MAP_SCALE) || 1);
        const strategy = this.entityManager?.gameModeStrategy || null;
        // The combat mode decides, not the menu mode: an arcade run with hunt items is played as
        // a fight, and that is the mode a room states it belongs to.
        const modeType = strategy?.getPickupModeType?.() || strategy?.modeType || '';
        for (const portal of portals) {
            if (portal?.secret !== true) continue;
            portal.cooldowns?.clear?.();
            portal.visualPulseRemaining = 0;
            portal.visualPulseDestination = null;
            setSecretRoomPortalOpen(portal, false);
            const room = authored.find((entry) => entry.id === portal.roomId) || null;
            // Not part of this mode: the pair stays shut and hidden for the round. It is not
            // removed, because a built arena can be played again in another mode without a rebuild.
            if (!room || !isSecretRoomActiveInMode(room, modeType)) continue;
            this._rooms.push(createRoomEntry(room, portal, mapScale));
        }
        this._closedCount = this._rooms.length;
        // A room that needs no break is open in the first second, without waiting for a tick.
        this.update();
        // Everything open by now was open from the start, and that is no news worth announcing.
        this._openedCount = 0;
        return this._rooms.length;
    }

    /** The rooms of this round, for the stay clock and the item refill that build on them. */
    getRooms() {
        return this._rooms;
    }

    /**
     * Rooms that had to be unlocked and have opened since the round began. The HUD derives its
     * announcement from this number alone, which host and replica compute alike.
     * @returns {number}
     */
    getOpenedRoomCount() {
        return this._openedCount;
    }

    /** Whether one named room has opened in the current round. */
    isRoomOpen(roomId) {
        const id = String(roomId || '');
        if (!id) return false;
        for (const entry of this._rooms) {
            if (entry.room.id === id) return entry.open === true;
        }
        return false;
    }

    /**
     * The shoot-the-plant goal of this round for the HUD, or null when no room of this round opens
     * on seed or kernel release. A room that does not exist in the mode being played is not part of
     * the round, so its plant never announces a portal. The object is reused.
     */
    getSeedObjective() {
        for (const entry of this._rooms) {
            const source = entry.room.unlock?.source;
            if (!isSecretRoomReleaseSource(source)) continue;
            const state = this._resolveUnlockState(entry.room);
            const objective = this._seedObjective;
            objective.source = source;
            objective.total = Math.max(0, Math.trunc(Number(state?.total) || 0));
            objective.released = Math.max(0, Math.trunc(Number(state?.released) || 0));
            objective.allReleased = state?.allReleased === true;
            objective.completedAtSeconds = Math.max(0, Number(state?.completedAtSeconds) || 0);
            objective.portalOpen = entry.open === true;
            objective.portalPosition.x = entry.entryPosition[0];
            objective.portalPosition.y = entry.entryPosition[1];
            objective.portalPosition.z = entry.entryPosition[2];
            return objective;
        }
        return null;
    }

    /**
     * Stay state of one player for the HUD. The object is reused, so a caller copies what it needs.
     * @param {number} playerIndex
     * @returns {{ inside: boolean, remainingSeconds: number, roomId: string } | null}
     */
    getHudStateForPlayer(playerIndex) {
        const index = Number(playerIndex);
        if (!Number.isInteger(index) || index < 0) return null;
        return this._hudStates[index] || null;
    }

    /**
     * @param {number} [dt] Seconds since the last tick; the stay clocks run on it.
     */
    update(dt = 0) {
        this._updateUnlocks();
        this._updateStayClocks(Math.max(0, Number(dt) || 0));
        // The item points refill even while a portal is still shut, so the first visitor finds a
        // stocked room. The powerup manager owns the items; this tick only hands it the clock.
        refillSecretRoomItems(this.entityManager?.powerupManager || null, this._rooms, dt);
    }

    _updateUnlocks() {
        if (this._closedCount === 0) return;
        for (const entry of this._rooms) {
            if (entry.open) continue;
            const state = this._resolveUnlockState(entry.room);
            if (!captureUnlockState(entry, state)) continue;
            entry.unlockSeconds = resolveRoomUnlockSeconds(
                entry.room, state, this.entityManager?.gameModeStrategy?.modeType === 'ARCADE'
                    ? this.entityManager?.runtimeConfig?.arcade?.scenarioId : '',
            );
        }

        // Seed release timestamps are stored to milliseconds; compare in the same precision.
        const elapsedSeconds = Math.round((Number(this.entityManager?.arena?.glbAnimationElapsedSeconds) || 0) * 1000) / 1000;
        for (const entry of this._rooms) {
            if (entry.open || elapsedSeconds < entry.unlockSeconds) continue;
            entry.open = true;
            this._closedCount -= 1;
            this._openedCount += 1;
            setSecretRoomPortalOpen(entry.portal, true);
        }
    }

    /** Puts every clock back to "outside" without dropping the arrays a match has grown. */
    _resetStayClocks() {
        for (let index = 0; index < this._hudStates.length; index += 1) {
            this._stayRoomIndex[index] = -1;
            clearHudState(this._hudStates[index]);
        }
    }

    _updateStayClocks(dt) {
        const players = this.entityManager?.players;
        if (this._rooms.length === 0 || !Array.isArray(players)) return;
        for (let slot = 0; slot < players.length; slot += 1) {
            const player = players[slot];
            const index = Number.isInteger(player?.index) ? player.index : slot;
            if (index < 0) continue;
            const hud = this._ensureHudState(index);
            // A dead visitor holds no room: his clock ends here and starts over when he returns.
            const roomIndex = player?.alive === false ? -1 : this._findOpenRoomIndex(player);
            if (roomIndex < 0) {
                this._stayRoomIndex[index] = -1;
                clearHudState(hud);
                continue;
            }

            const entry = this._rooms[roomIndex];
            if (this._stayRoomIndex[index] !== roomIndex) {
                this._stayRoomIndex[index] = roomIndex;
                hud.remainingSeconds = entry.stayLimitSeconds;
            }
            // E62 leaves its hook here: a living boss will set clockPaused, nothing else changes.
            if (entry.clockPaused !== true) {
                hud.remainingSeconds = Math.max(0, hud.remainingSeconds - dt);
            }
            hud.inside = true;
            hud.roomId = entry.room.id;
            if (hud.remainingSeconds > 0 || this.networkReplica) continue;

            this._ejectPlayer(player, entry);
            this._stayRoomIndex[index] = -1;
            clearHudState(hud);
        }
    }

    /**
     * @param {{ position?: unknown }} player
     * @returns {number} Index into `_rooms`, or -1 when the player is in no open room.
     */
    _findOpenRoomIndex(player) {
        for (let index = 0; index < this._rooms.length; index += 1) {
            const entry = this._rooms[index];
            if (!entry.open) continue;
            if (isPointInSecretRoom(entry.scaledRoom, player?.position)) return index;
        }
        return -1;
    }

    /**
     * @param {number} index
     * @returns {{ inside: boolean, remainingSeconds: number, roomId: string }}
     */
    _ensureHudState(index) {
        let hud = this._hudStates[index];
        if (!hud) {
            hud = { inside: false, remainingSeconds: 0, roomId: '' };
            this._hudStates[index] = hud;
            this._stayRoomIndex[index] = -1;
        }
        return hud;
    }

    /**
     * Throws a visitor back to the safe place the map author picked (E43). Speed and boost stay as
     * they are - this is a relocation, not a respawn, so nothing about the run is reset.
     * @param {object} player
     * @param {SecretRoomEntry} entry
     */
    _ejectPlayer(player, entry) {
        const config = resolveGameplayConfig(this.entityManager);
        const [x, y, z] = entry.ejectPosition;
        player.position?.set?.(x, y, z);
        if (config.GAMEPLAY?.PLANAR_MODE === true) player.currentPlanarY = y;
        // Yaw about the up axis, the same heading convention a spawn direction produces.
        const halfYaw = entry.ejectYawRad * 0.5;
        player.quaternion?.set?.(0, Math.sin(halfYaw), 0, Math.cos(halfYaw));
        player.trail?.forceGap?.(0.5);
        player.refreshObbCollisionQuery?.();
        // The same short shield a respawn hands out: the visitor did not choose this moment and
        // lands among players who did.
        const protection = Math.max(0, Number(config.PLAYER?.SPAWN_PROTECTION) || 0);
        if (protection > 0) {
            player.spawnProtectionTimer = Math.max(Number(player.spawnProtectionTimer) || 0, protection);
        }
        // The entry portal can stand close to the eject point, and it works in both directions:
        // without this cooldown the next frame could pull him straight back into the room.
        const cooldown = Math.max(0, Number(config.PORTAL?.COOLDOWN) || 0);
        if (cooldown > 0) entry.portal?.cooldowns?.set?.(player.index, cooldown);
    }

    /** Destructible state of this round, or null when this map is not destructible in this mode. */
    _resolveDestructibleState() {
        const system = this.entityManager?._mapDestructibleSystem || null;
        if (!system || system.isActive?.() !== true) return null;
        return system.getState?.() || null;
    }

    _resolveUnlockState(room) {
        const source = room?.unlock?.source;
        const arena = this.entityManager?.arena;
        if (source === 'dandelionSeeds') {
            return this._resolveShareState(room, arena?.getDandelionSeedProgress?.() || null, arena, source);
        }
        if (source === 'sunflowerKernels') {
            return this._resolveShareState(room, arena?.getSunflowerKernelProgress?.() || null, arena, source);
        }
        return this._resolveDestructibleState();
    }

    /**
     * A room that needs only a share of the plant sees the plant as if the share were all of it:
     * the goal is the share, the count stops there, and "complete" is the second the last part of
     * the share fell. Both machines read that second from the same ordered release list.
     */
    _resolveShareState(room, progress, arena, source) {
        const required = Number(room?.unlock?.requiredReleases);
        if (!progress || !Number.isInteger(required) || required <= 0) return progress;
        const goal = Math.min(required, Math.max(0, Math.trunc(Number(progress.total) || 0)));
        const share = this._shareState;
        share.total = goal;
        share.released = Math.min(goal, Math.max(0, Math.trunc(Number(progress.released) || 0)));
        share.remaining = goal - share.released;
        share.allReleased = goal > 0 && share.released >= goal;
        let reachedAt = Infinity;
        if (share.allReleased) {
            reachedAt = source === 'dandelionSeeds'
                ? arena?.getDandelionSeedReleaseSecondsAt?.(goal) ?? Infinity
                : arena?.getSunflowerKernelReleaseSecondsAt?.(goal) ?? Infinity;
        }
        share.completedAtSeconds = Number.isFinite(reachedAt) ? reachedAt : 0;
        if (share.allReleased && !Number.isFinite(reachedAt)) share.allReleased = false;
        return share;
    }
}

/**
 * One room of this round, with everything the tick needs already in world units.
 *
 * @typedef {object} SecretRoomEntry
 * @property {object} room The authored room, in map units.
 * @property {object} portal The portal pair built for it.
 * @property {number} unlockSeconds
 * @property {{ known: boolean, present: boolean, a: number, b: number, c: number }} seenState
 *   The unlock state last resolved, as plain numbers so a closed room compares without allocating.
 * @property {boolean} open
 * @property {boolean} clockPaused While true the stay clocks of this room stand still (E62).
 * @property {{ bounds: { min: number[], max: number[] } }} scaledRoom Box in world units.
 * @property {object | null} itemPoints Refill bookkeeping of the item points, in world units.
 * @property {number[]} ejectPosition Safe place in world units.
 * @property {number[]} entryPosition Entry portal in world units, for the HUD pointer.
 * @property {number} ejectYawRad
 * @property {number} stayLimitSeconds
 */

/**
 * The contract keeps map units; the arena builds in world units. Scaling once per round here keeps
 * the per frame point test to a plain comparison and lets it reuse `isPointInSecretRoom`.
 * @param {object} room
 * @param {object} portal
 * @param {number} mapScale
 * @returns {SecretRoomEntry}
 */
function createRoomEntry(room, portal, mapScale) {
    const scalePoint = (point) => [point[0] * mapScale, point[1] * mapScale, point[2] * mapScale];
    return {
        room,
        portal,
        unlockSeconds: Infinity,
        seenState: { known: false, present: false, a: 0, b: 0, c: 0 },
        open: false,
        clockPaused: false,
        scaledRoom: { bounds: { min: scalePoint(room.bounds.min), max: scalePoint(room.bounds.max) } },
        itemPoints: createSecretRoomItemPoints(room, mapScale),
        ejectPosition: scalePoint(room.ejectPoint.pos),
        entryPosition: scalePoint(room.entryPortal.pos),
        ejectYawRad: Number(room.ejectPoint.yawDeg) * DEGREES_TO_RADIANS,
        stayLimitSeconds: Number(room.stayLimitSeconds) || 0,
    };
}

/**
 * @param {{ inside: boolean, remainingSeconds: number, roomId: string }} hud
 * @returns {void}
 */
function clearHudState(hud) {
    if (!hud) return;
    hud.inside = false;
    hud.remainingSeconds = 0;
    hud.roomId = '';
}

/**
 * Match second a room's portal opens from, `Infinity` while it is still shut.
 *
 * A room whose condition can never come true would keep its portal shut for the whole match and
 * silently take a piece of the map out of play, so both such cases open the portal from the start
 * instead: a map that is not destructible in this mode at all, a map whose shootable plant is
 * missing (its model did not load), and an unlock naming a part that this map does not have.
 * @param {object} room
 * @param {{ segments?: { id: string }[] } | null} state
 * @returns {number}
 */
function resolveRoomUnlockSeconds(room, state, scenarioId = '') {
    if (scenarioId === 'vault_breaker' && room?.id === 'vault') {
        const legBreak = state?.events?.find?.((event) => event?.kind === 'leg_lower');
        return legBreak ? Math.max(0, Number(legBreak.atSeconds) || 0)
            + (Number(room?.unlock?.delaySeconds) || 0) : Infinity;
    }
    const unlock = /** @type {{ source?: string, when?: string, segmentId?: string } | null} */ (room?.unlock || null);
    if (!unlock) return 0;
    if (!state) return 0;
    if (unlock.when === 'segment'
        && !state.segments?.some((segment) => segment?.id === unlock.segmentId)) {
        return 0;
    }
    return resolveSecretRoomUnlockSeconds(room, state);
}

/**
 * Stores the numbers the unlock second depends on and reports whether they changed. A closed room
 * asks every tick, so this compares plain fields instead of building a signature string.
 * @param {SecretRoomEntry} entry
 * @param {any} state
 * @returns {boolean}
 */
function captureUnlockState(entry, state) {
    const release = isSecretRoomReleaseSource(entry.room?.unlock?.source);
    const present = !!state;
    const a = release ? Number(state?.total) || 0 : (Array.isArray(state?.events) ? state.events.length : 0);
    const b = release ? Number(state?.released) || 0 : (state?.sealed === true ? 1 : 0);
    const c = release ? Number(state?.completedAtSeconds) || 0 : 0;
    const seen = entry.seenState;
    if (seen.known && seen.present === present && seen.a === a && seen.b === b && seen.c === c) return false;
    seen.known = true;
    seen.present = present;
    seen.a = a;
    seen.b = b;
    seen.c = c;
    return true;
}

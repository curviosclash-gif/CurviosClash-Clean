// A guard a map author gave a `respawnSeconds` to is not gone for good: its wreck leaves the arena
// like every other destroyed emplacement, and after those seconds the same emplacement is built
// again from the same map entry - full health, same place, same orders.
//
// Rebuilding from the authored definition is what keeps this small: there is no second list of
// fields to reset, because the round start already builds a turret out of exactly that definition.
// The host alone counts down; a replica sees the returning guard in the next host snapshot.

// The same tolerance the secret room refill uses: a sum of uneven frame times has to hit its second
// exactly, not one float step later.
const DUE_EPSILON = 1e-6;

/**
 * One destroyed emplacement waiting to be built again.
 *
 * @typedef {object} PendingTurretRespawn
 * @property {object} definition The authored map entry the turret was built from.
 * @property {number} authoredScale The map scale that was applied when it was built.
 * @property {number} remaining Seconds left until it returns.
 */

/**
 * Remembers a destroyed turret when its map entry asked for a return. Reached on the host only,
 * because a replica never resolves damage itself.
 *
 * @param {{ _pendingRespawns?: PendingTurretRespawn[] }} system
 * @param {object} turret The turret that just died.
 * @returns {boolean} Whether a return was scheduled.
 */
export function queueStaticTurretRespawn(system, turret) {
    const pending = system?._pendingRespawns;
    if (!Array.isArray(pending) || !turret?.definition) return false;
    const seconds = Number(turret.respawnSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return false;
    pending.push({
        definition: turret.definition,
        authoredScale: Number(turret.authoredScale) || 1,
        remaining: seconds,
    });
    return true;
}

/**
 * One tick of every pending return. A frame allocates nothing while the list is empty, which is the
 * normal case for a whole match.
 *
 * @param {{ _pendingRespawns?: PendingTurretRespawn[], networkReplica?: boolean, turrets?: object[], _createTurret?: Function }} system
 * @param {number} dt Seconds since the last tick.
 * @returns {void}
 */
export function updateStaticTurretRespawns(system, dt) {
    const pending = system?._pendingRespawns;
    if (!Array.isArray(pending) || pending.length === 0) return;
    if (system.networkReplica === true) return;
    const seconds = Math.max(0, Number(dt) || 0);
    // Walking backwards so a due entry can leave the list without skipping its neighbour.
    for (let index = pending.length - 1; index >= 0; index -= 1) {
        const entry = pending[index];
        entry.remaining -= seconds;
        if (entry.remaining > DUE_EPSILON) continue;
        pending.splice(index, 1);
        system.turrets.push(system._createTurret(entry.definition, entry.authoredScale));
    }
}

/**
 * Drops every pending return, so a new round never inherits a countdown from the last one.
 *
 * @param {{ _pendingRespawns?: PendingTurretRespawn[] }} system
 * @returns {void}
 */
export function clearStaticTurretRespawns(system) {
    if (Array.isArray(system?._pendingRespawns)) system._pendingRespawns.length = 0;
}

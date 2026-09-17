import { isTrailTargetDescriptor, resolveHuntTargetOwnerPlayer } from '../../../hunt/HuntTargetingOps.js';
import { isRocketTierType } from '../../../hunt/RocketPickupSystem.js';
import { resolveEntityRuntimeConfig } from '../../../shared/contracts/EntityRuntimeConfig.js';

const DEFAULT_WARNING_RANGE = 140;
const CLOSING_SPEED_EPSILON = 0.0001;

export const ROCKET_THREAT_SOURCES = Object.freeze({
    PLAYER: 'player',
    TURRET: 'turret',
    ZONE: 'zone',
});

/**
 * The player a projectile is currently steering at, or -1.
 * Trail targets, missing targets and dead targets never count as a lock, and a
 * target that is not a player of this match (a turret, a map structure) neither.
 * This is deliberately separate from `targetPlayerIndex`, which decides who an
 * environment rocket is allowed to hit at all.
 */
export function resolveLockedPlayerIndex(target, players = []) {
    if (!target || isTrailTargetDescriptor(target)) return -1;
    const player = resolveHuntTargetOwnerPlayer(target, players);
    if (!player || !player.alive) return -1;
    const index = Number(player.index);
    if (!Number.isInteger(index) || index < 0) return -1;
    return players[index] === player ? index : -1;
}

function createThreatEntry() {
    return {
        active: false,
        count: 0,
        nearestDistance: 0,
        // 0 means "not closing in" - the rocket is locked on but currently flying away.
        timeToImpactSeconds: 0,
        direction: { x: 0, y: 0, z: 0 },
        nearestProjectileId: '',
        nearestSource: '',
        // The nearest rocket a defence rocket may actually be sent after: exclusion zone
        // rockets cannot be shot down (A9), so they never appear here even when they are
        // the closest threat.
        nearestInterceptableId: '',
        nearestInterceptableDistance: 0,
    };
}

function resetThreatEntry(entry) {
    entry.active = false;
    entry.count = 0;
    entry.nearestDistance = 0;
    entry.timeToImpactSeconds = 0;
    entry.direction.x = 0;
    entry.direction.y = 0;
    entry.direction.z = 0;
    entry.nearestProjectileId = '';
    entry.nearestSource = '';
    entry.nearestInterceptableId = '';
    entry.nearestInterceptableDistance = 0;
}

const KNOWN_THREAT_SOURCES = new Set(Object.values(ROCKET_THREAT_SOURCES));

/**
 * Where a rocket comes from.
 *
 * A network replica cannot derive this: it resolves `owner` among the players only, so a
 * turret rocket arrives without its turret. The snapshot therefore carries the already
 * resolved source in `threatSource`, and a valid value there always wins over the
 * derivation. Host projectiles leave the field empty and fall through.
 */
export function resolveRocketThreatSource(projectile) {
    if (!projectile) return ROCKET_THREAT_SOURCES.PLAYER;
    const declared = projectile.threatSource;
    if (typeof declared === 'string' && KNOWN_THREAT_SOURCES.has(declared)) return declared;
    if (projectile.zoneProjectile === true) return ROCKET_THREAT_SOURCES.ZONE;
    if (projectile.owner?.staticTurret === true || projectile.environmentProjectile === true) {
        return ROCKET_THREAT_SOURCES.TURRET;
    }
    return ROCKET_THREAT_SOURCES.PLAYER;
}

/**
 * Keeps track of which player is chased by which homing rockets.
 *
 * It reads `projectile.lockedPlayerIndex` only - never `projectile.target` - so a
 * network replica, which never resolves targets itself, gets the same answer as the
 * host as soon as the lock travels in the snapshot.
 *
 * The tracker runs every frame: entries are reused per player index, and no vector
 * or array is allocated during an update.
 */
export class RocketThreatTracker {
    constructor(system = null) {
        this.system = system || null;
        this._threats = [];
        this._emptyThreat = createThreatEntry();
    }

    _ensureEntry(playerIndex) {
        while (this._threats.length <= playerIndex) {
            this._threats.push(createThreatEntry());
        }
        return this._threats[playerIndex];
    }

    _resolveWarningRange() {
        const config = resolveEntityRuntimeConfig(this.system);
        const range = Number(config?.HUNT?.ROCKET?.WARNING_RANGE) || DEFAULT_WARNING_RANGE;
        return Math.max(0, range);
    }

    update(projectiles, players) {
        // Every player keeps its own entry from the first update on, so a HUD may hold
        // the object it was handed instead of asking again each frame.
        const playerCount = Array.isArray(players) ? players.length : 0;
        if (playerCount > 0) this._ensureEntry(playerCount - 1);
        for (let i = 0; i < this._threats.length; i += 1) {
            resetThreatEntry(this._threats[i]);
        }
        if (!Array.isArray(projectiles) || playerCount === 0) return;

        const warningRange = this._resolveWarningRange();
        for (let i = 0; i < projectiles.length; i += 1) {
            const projectile = projectiles[i];
            if (!projectile || !isRocketTierType(projectile.type)) continue;
            // E37: a defence rocket chases a rocket, never a player - it is no threat.
            if (projectile.isInterceptor === true) continue;

            const playerIndex = Number(projectile.lockedPlayerIndex);
            if (!Number.isInteger(playerIndex) || playerIndex < 0) continue;

            const target = players[playerIndex];
            if (!target?.alive || !target.position) continue;

            const owner = projectile.owner;
            if (owner === target || (owner && Number(owner.index) === playerIndex)) continue;

            const dx = projectile.position.x - target.position.x;
            const dy = projectile.position.y - target.position.y;
            const dz = projectile.position.z - target.position.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (!(distance <= warningRange)) continue;

            const entry = this._threats[playerIndex];
            entry.count += 1;
            const traversalId = String(projectile.traversalId || '');
            const source = resolveRocketThreatSource(projectile);
            // Tracked before the "nearest" shortcut below, so a closer zone rocket never
            // hides the player rocket a defence rocket could still reach.
            if (source !== ROCKET_THREAT_SOURCES.ZONE && traversalId
                && (!entry.nearestInterceptableId || distance < entry.nearestInterceptableDistance)) {
                entry.nearestInterceptableId = traversalId;
                entry.nearestInterceptableDistance = distance;
            }
            if (entry.active && distance >= entry.nearestDistance) continue;

            entry.active = true;
            entry.nearestDistance = distance;
            entry.nearestProjectileId = traversalId;
            entry.nearestSource = source;
            const scale = distance > 0 ? 1 / distance : 0;
            entry.direction.x = dx * scale;
            entry.direction.y = dy * scale;
            entry.direction.z = dz * scale;
            // Closing speed is the part of the rocket's velocity that points at the player,
            // so a rocket that is still turning does not fake an instant impact.
            const velocity = projectile.velocity;
            const closingSpeed = velocity
                ? -(velocity.x * entry.direction.x + velocity.y * entry.direction.y + velocity.z * entry.direction.z)
                : 0;
            entry.timeToImpactSeconds = closingSpeed > CLOSING_SPEED_EPSILON ? distance / closingSpeed : 0;
        }
    }

    getThreat(playerIndex) {
        const index = Number(playerIndex);
        if (!Number.isInteger(index) || index < 0 || index >= this._threats.length) {
            return this._emptyThreat;
        }
        return this._threats[index];
    }

    clear() {
        for (let i = 0; i < this._threats.length; i += 1) {
            resetThreatEntry(this._threats[i]);
        }
    }
}

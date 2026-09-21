import { resolveMapDestructibleBreakScene } from '../../shared/contracts/MapDestructibleContract.js';
import { resolveMapDestructibleFireballSphere } from '../../shared/contracts/MapDestructibleHazardContract.js';
import { applyExplosionKnockback } from './ExplosionKnockbackOps.js';

/**
 * Runtime owner of the damage a map structure's collapse deals to nearby players, in the two forms
 * MapDestructibleContract lets a break scene carry.
 *
 * `breakScenes[].blast` is the old one and the common one: one radial hit, once, after its authored
 * delay on the map clock - the tower reaching the ground.
 *
 * `breakScenes[].fireball` is the reactor breach. It is not a moment but a body: the table the
 * scene carries is the very table Blender keyed the drawn fireball off, so the sphere measured here
 * grows, rises and shrinks exactly as the fireball on screen does, and ends with it. Everything
 * else the clip draws for the next forty-five seconds - stem, cap, rolled rim, ground dust - is
 * smoke, and smoke never hurt anyone. A ship may be burned at most once per breach, whether it was
 * sitting on the reactor when it went or flew into the fireball three seconds later, so the finale
 * costs one hit rather than one hit per frame.
 *
 * Only the host ever schedules either: MapDestructibleSystem raises a break event only while it is
 * not a network replica, so both lists stay empty on every other peer. A replica still sees the
 * outcome, exactly as it does for any other damage source, through the victim's synced hp and alive
 * state - never through a message of its own.
 */
export class MapDestructibleBlastSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this._pending = [];
        this._fireballs = [];
    }

    startRound() {
        this._reset();
    }

    clear() {
        this._reset();
    }

    _reset() {
        // The hit lists go with their fireballs: a ship burned last round starts the next one able
        // to be burned again.
        this._pending.length = 0;
        this._fireballs.length = 0;
    }

    /**
     * Queues whatever danger a break event's scene authored, if any. Called from
     * EntityManager.onMapDestructibleBreak right after MapDestructibleSystem falls a segment.
     */
    schedulePendingBlast(event, options = {}) {
        const destructibles = this.entityManager?._mapDestructibleSystem;
        // Replicas receive the break event so they can animate it and play its feedback, but
        // host snapshots remain the only authority for damage and knockback.
        if (destructibles?.networkReplica === true) return;
        const scene = resolveMapDestructibleBreakScene(destructibles?.getDefinition?.(), event);
        if (!scene?.blast && !scene?.fireball) return;

        const anchorScale = Number(destructibles?.anchorScale) || 1;
        const atSeconds = Number(event?.atSeconds) || 0;
        const sourcePlayer = options?.sourcePlayer || null;

        if (scene.blast) {
            const segment = destructibles?.getDefinition?.()?.segments
                ?.find((entry) => entry.id === event?.segmentId);
            const anchor = segment?.anchor || [0, 0, 0];
            this._pending.push({
                atSeconds: atSeconds + scene.blast.delaySeconds,
                position: {
                    x: anchor[0] * anchorScale,
                    y: anchor[1] * anchorScale,
                    z: anchor[2] * anchorScale,
                },
                radius: scene.blast.radius,
                damage: scene.blast.damage,
                sourcePlayer,
            });
        }
        if (scene.fireball) {
            this._fireballs.push({
                startSeconds: atSeconds,
                fireball: scene.fireball,
                worldScale: anchorScale,
                sourcePlayer,
                // Who this breach has already burned. Keyed by player index where there is one, so
                // a ship stays ineligible across its own respawn; the player object itself is the
                // fallback for a stand-in without an index.
                burned: new Set(),
            });
        }
    }

    /** Applies every blast whose delay has elapsed, and steps every fireball that is still alive. */
    update() {
        if (this._pending.length === 0 && this._fireballs.length === 0) return;
        const elapsedSeconds = this.entityManager?._mapDestructibleSystem?.getElapsedSeconds?.() ?? 0;
        if (this._pending.length > 0) this._updatePending(elapsedSeconds);
        if (this._fireballs.length > 0) this._updateFireballs(elapsedSeconds);
    }

    _updatePending(elapsedSeconds) {
        let writeIndex = 0;
        for (let readIndex = 0; readIndex < this._pending.length; readIndex += 1) {
            const entry = this._pending[readIndex];
            if (elapsedSeconds >= entry.atSeconds) {
                this._applyBlast(entry);
                continue;
            }
            this._pending[writeIndex] = entry;
            writeIndex += 1;
        }
        this._pending.length = writeIndex;
    }

    /**
     * A fireball is sampled, not swept: it burns whoever is inside it at this update. A ship that
     * crosses it entirely between two updates is not hit, and neither is anyone at all if a stall
     * skips the whole window - which is the safe direction, because the alternative is to charge
     * damage for a position nobody was ever measured at.
     */
    _updateFireballs(elapsedSeconds) {
        let writeIndex = 0;
        for (let readIndex = 0; readIndex < this._fireballs.length; readIndex += 1) {
            const entry = this._fireballs[readIndex];
            const seconds = elapsedSeconds - entry.startSeconds;
            // At its last row the fireball is gone. Dropping it here is what makes the rest of the
            // clip harmless without the burn loop ever having to know about smoke.
            if (seconds >= entry.fireball.durationSeconds) continue;
            this._burn(entry, seconds);
            this._fireballs[writeIndex] = entry;
            writeIndex += 1;
        }
        this._fireballs.length = writeIndex;
    }

    _burn(entry, seconds) {
        const sphere = resolveMapDestructibleFireballSphere(entry.fireball, seconds, entry.worldScale);
        // Before the first row, and at the two rows that carry a zero radius, there is no body at
        // all - not a point-sized one.
        if (!(sphere.radius > 0)) return;

        const owner = this.entityManager;
        for (const target of owner?.players || []) {
            if (!target.alive) continue;
            // A protected ship is passed over without being marked: it has not been burned, so when
            // its protection runs out while it is still inside, the fireball still gets it once.
            if (Number(target.spawnProtectionTimer) > 0) continue;
            const id = Number.isFinite(target?.index) ? target.index : target;
            if (entry.burned.has(id)) continue;

            const dx = target.position.x - sphere.x;
            const dy = target.position.y - sphere.y;
            const dz = target.position.z - sphere.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (distance > sphere.radius) continue;
            // Exactly on the edge there is no damage left to deal, the same as for a blast, and a
            // contact that deals nothing must not use up the one hit this breach owes the ship.
            const falloff = 1 - distance / sphere.radius;
            if (falloff <= 0) continue;

            entry.burned.add(id);
            const damage = Math.max(1, Math.floor(entry.fireball.damage * falloff));
            owner._applyModeDamage(target, damage, 'BLAST', {
                sourcePlayer: entry.sourcePlayer,
                impactPoint: sphere,
            });
            applyExplosionKnockback(target, sphere, falloff, owner);
        }
    }

    /**
     * A structural collapse is an environmental hazard, not a weapon: unlike a rocket, it does
     * not spare the player who caused it, so standing too close after firing the killing shot
     * still costs the same falloff damage as anyone else in range.
     */
    _applyBlast(entry) {
        const owner = this.entityManager;
        for (const target of owner?.players || []) {
            if (!target.alive) continue;
            if (Number(target.spawnProtectionTimer) > 0) continue;
            const dx = target.position.x - entry.position.x;
            const dy = target.position.y - entry.position.y;
            const dz = target.position.z - entry.position.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (distance > entry.radius) continue;

            const falloff = 1 - distance / entry.radius;
            if (falloff <= 0) continue;
            const damage = Math.max(1, Math.floor(entry.damage * falloff));
            owner._applyModeDamage(target, damage, 'BLAST', {
                sourcePlayer: entry.sourcePlayer,
                impactPoint: entry.position,
            });
            applyExplosionKnockback(target, entry.position, falloff, owner);
        }
    }
}

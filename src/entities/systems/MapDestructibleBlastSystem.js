import { resolveMapDestructibleBreakScene } from '../../shared/contracts/MapDestructibleContract.js';
import { resolveMapDestructibleFireballSphere } from '../../shared/contracts/MapDestructibleHazardContract.js';
import { applyExplosionKnockback } from './ExplosionKnockbackOps.js';

function capturePlayerPositions(players, positions = new Map()) {
    for (const previous of positions.values()) previous.active = false;
    for (const target of players || []) {
        if (!target?.position) continue;
        const id = Number.isFinite(target.index) ? target.index : target;
        let snapshot = positions.get(id);
        if (!snapshot) {
            snapshot = {};
            positions.set(id, snapshot);
        }
        snapshot.target = target;
        snapshot.active = target.alive && !(Number(target.spawnProtectionTimer) > 0);
        snapshot.x = target.position.x;
        snapshot.y = target.position.y;
        snapshot.z = target.position.z;
    }
    return positions;
}

/** Largest penetration of a linearly moving player through the authored, piecewise-linear sphere. */
function sweptFireballFalloff(entry, previous, current, fromSeconds, toSeconds, observedSeconds) {
    const samples = entry.fireball.samples;
    const scale = entry.worldScale * entry.fireball.unitScale;
    const origin = entry.fireball.origin;
    const total = observedSeconds - fromSeconds;
    let best = 0;
    let bestSeconds = fromSeconds;
    for (let i = 1; i < samples.length; i += 1) {
        const left = samples[i - 1];
        const right = samples[i];
        const start = Math.max(fromSeconds, left.atSeconds);
        const end = Math.min(toSeconds, right.atSeconds);
        if (end < start) continue;
        const duration = right.atSeconds - left.atSeconds;
        const stateAt = (seconds) => {
            const sampleAlpha = (seconds - left.atSeconds) / duration;
            const travelAlpha = total > 0 ? (seconds - fromSeconds) / total : 1;
            return {
                x: previous.x + (current.x - previous.x) * travelAlpha - origin[0] * entry.worldScale,
                y: previous.y + (current.y - previous.y) * travelAlpha
                    - (origin[1] * entry.worldScale + (left.heightMetres + (right.heightMetres - left.heightMetres) * sampleAlpha) * scale),
                z: previous.z + (current.z - previous.z) * travelAlpha - origin[2] * entry.worldScale,
                radius: (left.radiusMetres + (right.radiusMetres - left.radiusMetres) * sampleAlpha) * scale,
            };
        };
        const a = stateAt(start);
        const b = stateAt(end);
        const falloffAt = (fraction) => {
            const x = a.x + (b.x - a.x) * fraction;
            const y = a.y + (b.y - a.y) * fraction;
            const z = a.z + (b.z - a.z) * fraction;
            const radius = a.radius + (b.radius - a.radius) * fraction;
            const falloff = radius > 0 ? Math.max(0, 1 - Math.hypot(x, y, z) / radius) : 0;
            if (falloff > best) {
                best = falloff;
                bestSeconds = start + (end - start) * fraction;
            }
        };
        falloffAt(0);
        falloffAt(1);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const dr = b.radius - a.radius;
        const A = dx * dx + dy * dy + dz * dz;
        const B = a.x * dx + a.y * dy + a.z * dz;
        const C = a.x * a.x + a.y * a.y + a.z * a.z;
        const denominator = A * a.radius - B * dr;
        if (Math.abs(denominator) > 1e-9) {
            const fraction = (C * dr - B * a.radius) / denominator;
            if (fraction > 0 && fraction < 1) falloffAt(fraction);
        }
    }
    return best > 0 ? { falloff: best, seconds: bestSeconds } : null;
}

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
                previousSeconds: 0,
                previousPositions: capturePlayerPositions(this.entityManager?.players),
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

    /** Check the observed player movement against each linear segment of the visible fireball. */
    _updateFireballs(elapsedSeconds) {
        let writeIndex = 0;
        for (let readIndex = 0; readIndex < this._fireballs.length; readIndex += 1) {
            const entry = this._fireballs[readIndex];
            const seconds = elapsedSeconds - entry.startSeconds;
            // At its last row the fireball is gone. Dropping it here is what makes the rest of the
            // clip harmless without the burn loop ever having to know about smoke.
            const endSeconds = Math.min(seconds, entry.fireball.durationSeconds);
            if (endSeconds >= 0 && seconds >= entry.previousSeconds) this._burn(entry, endSeconds, seconds);
            entry.previousSeconds = seconds;
            capturePlayerPositions(this.entityManager?.players, entry.previousPositions);
            if (seconds >= entry.fireball.durationSeconds) continue;
            this._fireballs[writeIndex] = entry;
            writeIndex += 1;
        }
        this._fireballs.length = writeIndex;
    }

    _burn(entry, seconds, observedSeconds) {
        const owner = this.entityManager;
        for (const target of owner?.players || []) {
            if (!target.alive) continue;
            // A protected ship is passed over without being marked: it has not been burned, so when
            // its protection runs out while it is still inside, the fireball still gets it once.
            if (Number(target.spawnProtectionTimer) > 0) continue;
            const id = Number.isFinite(target?.index) ? target.index : target;
            if (entry.burned.has(id)) continue;

            const previous = entry.previousPositions.get(id);
            const canSweep = previous?.target === target && previous.active;
            const fromSeconds = canSweep ? entry.previousSeconds : seconds;
            const start = canSweep ? previous : target.position;
            const hit = sweptFireballFalloff(entry, start, target.position, fromSeconds, seconds, observedSeconds);
            if (!hit) continue;

            entry.burned.add(id);
            const sphere = resolveMapDestructibleFireballSphere(entry.fireball, hit.seconds, entry.worldScale);
            const damage = Math.max(1, Math.floor(entry.fireball.damage * hit.falloff));
            owner._applyModeDamage(target, damage, 'BLAST', {
                sourcePlayer: entry.sourcePlayer,
                impactPoint: sphere,
            });
            applyExplosionKnockback(target, sphere, hit.falloff, owner);
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

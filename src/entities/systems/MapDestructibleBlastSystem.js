import { resolveMapDestructibleBreakScene } from '../../shared/contracts/MapDestructibleContract.js';
import { applyExplosionKnockback } from './ExplosionKnockbackOps.js';

/**
 * Runtime owner of the radial damage a map structure's collapse deals to nearby players -
 * MapDestructibleContract's `breakScenes[].blast`, applied after its authored delay on the
 * map clock (mushroom cloud, falling tower legs, ...).
 *
 * Only the host ever schedules a blast: MapDestructibleSystem raises a break event only while
 * it is not a network replica, so this system's pending list stays empty on every other peer.
 * A replica still sees the outcome, exactly as it does for any other damage source, through the
 * victim's synced hp and alive state - never through a message of its own.
 */
export class MapDestructibleBlastSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this._pending = [];
    }

    startRound() {
        this._pending.length = 0;
    }

    clear() {
        this._pending.length = 0;
    }

    /**
     * Queues the blast a break event's scene authored, if any. Called from
     * EntityManager.onMapDestructibleBreak right after MapDestructibleSystem falls a segment.
     */
    schedulePendingBlast(event, options = {}) {
        const destructibles = this.entityManager?._mapDestructibleSystem;
        const scene = resolveMapDestructibleBreakScene(destructibles?.getDefinition?.(), event);
        const blast = scene?.blast;
        if (!blast) return;

        const segment = destructibles?.getDefinition?.()?.segments
            ?.find((entry) => entry.id === event?.segmentId);
        const anchorScale = Number(destructibles?.anchorScale) || 1;
        const anchor = segment?.anchor || [0, 0, 0];
        this._pending.push({
            atSeconds: (Number(event?.atSeconds) || 0) + blast.delaySeconds,
            position: {
                x: anchor[0] * anchorScale,
                y: anchor[1] * anchorScale,
                z: anchor[2] * anchorScale,
            },
            radius: blast.radius,
            damage: blast.damage,
            sourcePlayer: options?.sourcePlayer || null,
        });
    }

    /** Applies every blast whose delay has elapsed on the map clock, and forgets it. */
    update() {
        if (this._pending.length === 0) return;
        const elapsedSeconds = this.entityManager?._mapDestructibleSystem?.getElapsedSeconds?.() ?? 0;
        const due = [];
        this._pending = this._pending.filter((entry) => {
            if (elapsedSeconds < entry.atSeconds) return true;
            due.push(entry);
            return false;
        });
        for (const entry of due) this._applyBlast(entry);
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
            const dx = target.position.x - entry.position.x;
            const dy = target.position.y - entry.position.y;
            const dz = target.position.z - entry.position.z;
            const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (distance > entry.radius) continue;

            const falloff = 1 - distance / entry.radius;
            const damage = Math.max(1, Math.floor(entry.damage * falloff));
            owner._applyModeDamage(target, damage, 'BLAST', {
                sourcePlayer: entry.sourcePlayer,
                impactPoint: entry.position,
            });
            applyExplosionKnockback(target, entry.position, falloff, owner);
        }
    }
}

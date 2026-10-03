import { resolveAuthoredAnchorScale } from '../../shared/contracts/GameplayConfigContract.js';

/**
 * Owns the small set of authored pickups whose lifetime is tied to a map event.
 * The Powerup manager owns their meshes and network snapshots; this system only creates each
 * configured pickup once and removes it when its named destructible breaks.
 */
export class MapOwnedPickupSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this.networkReplica = false;
        this.pickups = [];
    }

    startRound() {
        this.clear();
        const owner = this.entityManager;
        const map = owner?.arena?.currentMapDefinition;
        const authored = Array.isArray(map?.mapOwnedPickups) ? map.mapOwnedPickups : [];
        if (authored.length === 0) return 0;
        const scale = resolveAuthoredAnchorScale(map, owner);
        this.pickups = authored.map((entry, index) => {
            const id = String(entry?.id || `map_pickup_${index}`).trim();
            const ownerId = `map-owned:${id}`;
            const anchor = {
                x: (Number(entry?.x) || 0) * scale,
                y: (Number(entry?.y) || 0) * scale,
                z: (Number(entry?.z) || 0) * scale,
                type: entry?.pickupType || entry?.type,
                model: entry?.model,
                ownerId,
            };
            return {
                ownerId,
                despawnOnBreakSegment: String(entry?.despawnOnBreakSegment || '').trim(),
                disabled: false,
                spawned: false,
                anchor,
            };
        }).filter((entry) => entry.anchor.type);

        if (!this.networkReplica) this._spawnAvailable();
        return this.pickups.length;
    }

    setNetworkReplica(enabled) {
        this.networkReplica = enabled === true;
    }

    update() {
        if (this.networkReplica || this.pickups.length === 0) return;
        const events = this.entityManager?._mapDestructibleSystem?.getState?.()?.events;
        if (!Array.isArray(events) || events.length === 0) return;
        for (const pickup of this.pickups) {
            if (pickup.disabled || !pickup.despawnOnBreakSegment) continue;
            if (!events.some((event) => event?.segmentId === pickup.despawnOnBreakSegment)) continue;
            pickup.disabled = true;
            this.entityManager?.powerupManager?.removeByOwnerId?.(pickup.ownerId);
        }
    }

    _spawnAvailable() {
        const manager = this.entityManager?.powerupManager;
        if (!manager?.spawnAtAnchor) return;
        for (const pickup of this.pickups) {
            if (pickup.disabled || pickup.spawned) continue;
            const item = manager.spawnAtAnchor(pickup.anchor);
            if (!item) continue;
            pickup.spawned = true;
        }
    }

    clear() {
        if (!this.networkReplica) {
            for (const pickup of this.pickups) {
                this.entityManager?.powerupManager?.removeByOwnerId?.(pickup.ownerId);
            }
        }
        this.pickups = [];
    }
}

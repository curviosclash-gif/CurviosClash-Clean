import {
    isMapHazardActive,
    normalizeMapHazards,
    resolveMapHazardCycleIndex,
} from '../../shared/contracts/MapHazardContract.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';

const NEVER_HIT_CYCLE = -2147483648;

function segmentPointDistanceSquared(start, end, point) {
    const abX = (Number(end?.x) || 0) - (Number(start?.x) || 0);
    const abY = (Number(end?.y) || 0) - (Number(start?.y) || 0);
    const abZ = (Number(end?.z) || 0) - (Number(start?.z) || 0);
    const apX = point[0] - (Number(start?.x) || 0);
    const apY = point[1] - (Number(start?.y) || 0);
    const apZ = point[2] - (Number(start?.z) || 0);
    const lengthSquared = abX * abX + abY * abY + abZ * abZ;
    const ratio = lengthSquared > 0.000001
        ? Math.max(0, Math.min(1, (apX * abX + apY * abY + apZ * abZ) / lengthSquared))
        : 0;
    const dx = apX - abX * ratio;
    const dy = apY - abY * ratio;
    const dz = apZ - abZ * ratio;
    return dx * dx + dy * dy + dz * dz;
}

export class MapHazardSystem {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
        this.hazards = [];
        this.playerHitCycles = new Map();
        this.networkReplica = false;
        this.scale = 1;
    }

    startRound() {
        this.playerHitCycles.clear();
        const map = this.entityManager?.arena?.currentMapDefinition;
        const authoredHazards = normalizeMapHazards(map?.mapHazards);
        this.scale = map?.scaleAuthoredAnchors === true
            ? Math.max(0.001, Number(resolveGameplayConfig(this.entityManager).ARENA?.MAP_SCALE) || 1)
            : 1;
        this.hazards = authoredHazards.map((hazard) => ({
            hazard,
            position: Object.freeze([
                hazard.position[0] * this.scale,
                hazard.position[1] * this.scale,
                hazard.position[2] * this.scale,
            ]),
            radius: hazard.radius * this.scale,
        }));
        return this.hazards.length;
    }

    setNetworkReplica(enabled) {
        this.networkReplica = enabled === true;
    }

    updatePlayer(player, previousPosition, elapsedSeconds) {
        const fireTime = this.entityManager?.arena?.mapFireHazardTime;
        if (typeof fireTime === 'number') {
            if (fireTime < 0) return false;
            elapsedSeconds = fireTime;
        }
        if (
            this.networkReplica
            || !player?.alive
            || !previousPosition
            || !player.position
            || Number(player.spawnProtectionTimer) > 0
            || this.hazards.length === 0
        ) return false;
        let hitCycles = this.playerHitCycles.get(player.index);
        if (!hitCycles) {
            hitCycles = new Int32Array(this.hazards.length);
            hitCycles.fill(NEVER_HIT_CYCLE);
            this.playerHitCycles.set(player.index, hitCycles);
        }
        for (let index = 0; index < this.hazards.length; index += 1) {
            const runtimeHazard = this.hazards[index];
            const hazard = runtimeHazard.hazard;
            if (!isMapHazardActive(hazard, elapsedSeconds)) continue;
            const cycleIndex = resolveMapHazardCycleIndex(hazard, elapsedSeconds);
            if (hitCycles[index] === cycleIndex) continue;
            const radius = runtimeHazard.radius + Math.max(0, Number(player.hitboxRadius) || 0);
            if (segmentPointDistanceSquared(previousPosition, player.position, runtimeHazard.position) > radius * radius) continue;
            hitCycles[index] = cycleIndex;
            this._applyHit(player, hazard, elapsedSeconds);
            return true;
        }
        return false;
    }

    _applyHit(player, hazard, elapsedSeconds) {
        const owner = this.entityManager;
        const mode = String(owner?.gameModeStrategy?.modeType || '').toUpperCase();
        if (mode === 'CLASSIC' && player.hasShield === true) {
            player.hasShield = false;
            player.shieldHP = 0;
            owner.audio?.play?.('SHIELD_HIT', { intensity: 1, depleted: true });
            owner.particles?.spawnHit?.(player.position, player.color);
            return;
        }
        owner?._applyModeDamage?.(player, hazard.damage, 'FIRE_HAZARD', {
            impactPoint: player.position,
            nowSeconds: elapsedSeconds,
        });
    }

    clear() {
        this.hazards = [];
        this.playerHitCycles.clear();
        this.scale = 1;
    }
}

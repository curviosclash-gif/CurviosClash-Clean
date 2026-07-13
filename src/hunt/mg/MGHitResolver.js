import * as THREE from 'three';
import {
    createHuntTargetingScratch,
    createHuntTargetingTelemetry,
    isPlayerTargetDescriptor,
    isTrailTargetDescriptor,
    resolveHuntLineTarget,
    resolveHuntTargetOwnerPlayer,
    resolveTrailTargetEntry,
} from '../HuntTargetingOps.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import { clamp } from '../../utils/MathOps.js';

function resolveDamageSplit(damageResult = {}) {
    const applied = Math.max(0, Number(damageResult?.applied) || 0);
    const absorbedByShield = Math.max(0, Number(damageResult?.absorbedByShield) || 0);
    const hpApplied = Math.max(0, Number(damageResult?.hpApplied) || (applied - absorbedByShield));
    return { hpApplied, absorbedByShield };
}

function formatDamageFeedSuffix(damageResult = {}, fallbackHp = 0) {
    const split = resolveDamageSplit(damageResult);
    const hpApplied = split.hpApplied > 0 ? split.hpApplied : Math.max(0, Number(fallbackHp) || 0);
    const shieldApplied = split.absorbedByShield;
    if (hpApplied > 0 && shieldApplied > 0) {
        return `-${Math.round(hpApplied)} HP / -${Math.round(shieldApplied)} Schild`;
    }
    if (hpApplied > 0) {
        return `-${Math.round(hpApplied)} HP`;
    }
    if (shieldApplied > 0) {
        return `-${Math.round(shieldApplied)} Schild`;
    }
    return 'TREFFER';
}

export class MGHitResolver {
    constructor(runtimeContext) {
        this.runtime = runtimeContext || null;
        this._tmpAim = new THREE.Vector3();
        this._tmpHit = new THREE.Vector3();
        this._tmpMuzzle = new THREE.Vector3();
        this._targetingScratch = createHuntTargetingScratch();
        this._targetingTelemetry = createHuntTargetingTelemetry();
    }

    resolveHit(player, mg, outMuzzle = null, outAim = null) {
        const maxRange = Math.max(10, Number(mg.RANGE || 95));
        this.resolveAimDirection(player, this._tmpAim);
        const muzzleOffset = Math.max(0, Number(resolveGameplayConfig(player).HUNT?.TARGETING?.MUZZLE_OFFSET || 2.1));
        this._tmpMuzzle.copy(player.position).addScaledVector(this._tmpAim, muzzleOffset);
        if (outMuzzle) outMuzzle.copy(this._tmpMuzzle);
        if (outAim) outAim.copy(this._tmpAim);

        const target = resolveHuntLineTarget({
            sourcePlayer: player,
            players: this.runtime?.players || [],
            trailSpatialIndex: this.runtime?.getTrailSpatialIndex?.() || this.runtime?.trails?.spatialIndex || null,
            origin: this._tmpMuzzle,
            direction: this._tmpAim,
            playerRange: maxRange,
            trailRange: maxRange,
            trailSampleStep: Number(mg.TRAIL_SAMPLE_STEP),
            trailHitRadius: Number(mg.TRAIL_HIT_RADIUS),
            trailSelfSkipRecent: Number(mg.TRAIL_SELF_SKIP_RECENT),
            allowSelfTrailFallback: true,
            runtimeProfiler: this.runtime?.services?.runtimeProfiler || this.runtime?.runtimeProfiler || null,
            targetingTelemetry: this._targetingTelemetry,
            scratch: this._targetingScratch,
        });

        if (isPlayerTargetDescriptor(target)) {
            return {
                target,
                distance: target.distance,
                trail: null,
                point: target.point || null,
            };
        }

        if (isTrailTargetDescriptor(target)) {
            return {
                target: null,
                distance: target.distance,
                trail: target,
                point: target.point || null,
            };
        }

        return { target: null, distance: Infinity, trail: null, point: null };
    }

    resolveAimDirection(player, out) {
        return player.getAimDirection(out).normalize();
    }

    applyTrailHit(attacker, trailHit, mg) {
        const trailSpatialIndex = this.runtime?.getTrailSpatialIndex?.() || this.runtime?.trails?.spatialIndex;
        if (!trailSpatialIndex?.damageTrailSegment || !trailHit) return;

        const entry = resolveTrailTargetEntry(trailSpatialIndex, trailHit, {
            scratch: this._targetingScratch,
            configSource: this.runtime,
        });
        if (!entry) return;
        const fallbackDamage = Math.max(1, Number(entry.maxHp) || Number(entry.hp) || 1);
        const configuredDamage = Number(mg.TRAIL_DAMAGE);
        const damage = Number.isFinite(configuredDamage) && configuredDamage > 0 ? configuredDamage : fallbackDamage;
        const damageResult = trailSpatialIndex.damageTrailSegment(entry, damage);
        if (!damageResult?.hit) return;
        const destroyOnHit = mg?.DESTROY_TRAIL_ON_HIT !== false;
        let destroyed = !!damageResult.destroyed;
        if (destroyOnHit && !destroyed && typeof trailSpatialIndex.destroySegment === 'function') {
            destroyed = !!trailSpatialIndex.destroySegment(entry);
        }

        // Sync destroyed flag explicitly for test assertions.
        if (destroyed && entry) {
            entry.destroyed = true;
        }

        if (this.runtime?.services?.particles && trailHit.point) {
            this._tmpHit.set(trailHit.point.x, trailHit.point.y, trailHit.point.z);
            const color = destroyed ? 0x66ddff : 0x3388ff;
            this.runtime.services.particles.spawnTrailImpact(this._tmpHit, color, { destroyed });
        }
        if (this.runtime?.services?.audio && !attacker?.isBot) {
            this.runtime.services.audio.play('MG_HIT', { intensity: destroyed ? 1 : 0.75 });
        }
    }

    applyHit(attacker, targetDescriptor, distance, mg, impactPoint = null) {
        const target = resolveHuntTargetOwnerPlayer(targetDescriptor, this.runtime?.players || []);
        if (!target?.alive || target === attacker) return;

        const maxRange = Math.max(10, Number(mg.RANGE || 95));
        const minFalloff = clamp(Number(mg.MIN_FALLOFF || 0.5), 0.2, 1);
        const baseDamage = Math.max(1, Number(mg.DAMAGE || 9));
        const distRatio = clamp(distance / maxRange, 0, 1);
        const damage = baseDamage * (1 - (1 - minFalloff) * distRatio);

        const damageResult = target.takeDamage(damage);
        this.runtime?.events?.emitHuntDamageEvent({
            target,
            sourcePlayer: attacker,
            cause: 'MG_BULLET',
            damageResult,
            impactPoint: impactPoint || target.position,
        });
        if (damageResult.isDead) {
            this.runtime?.lifecycle?.killPlayer?.(target, 'PROJECTILE', { killer: attacker });
            this._pushKillFeed(attacker, target, 'ELIMINATED');
            return;
        }

        this._pushKillFeed(attacker, target, formatDamageFeedSuffix(damageResult, damage));
    }

    _pushKillFeed(attacker, target, suffix) {
        const attackerLabel = attacker.isBot ? `Bot ${attacker.index + 1}` : `P${attacker.index + 1}`;
        const targetLabel = target.isBot ? `Bot ${target.index + 1}` : `P${target.index + 1}`;
        this.runtime?.events?.emitHuntFeed(`${attackerLabel} -> ${targetLabel}: ${suffix}`);
    }
}

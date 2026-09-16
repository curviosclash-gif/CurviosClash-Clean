import { isDestructibleTurret } from '../../shared/contracts/TurretCombatContract.js';
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
import { clamp } from '../../shared/utils/MathOps.js';
import { applyFightHumanAimAssist } from '../FightAimAssist.js';

export class MGHitResolver {
    constructor(runtimeContext) {
        this.runtime = runtimeContext || null;
        this._tmpAim = new THREE.Vector3();
        this._tmpHit = new THREE.Vector3();
        this._tmpMuzzle = new THREE.Vector3();
        this._tmpTargetAim = new THREE.Vector3();
        this._tmpTurretOffset = new THREE.Vector3();
        this._targetingScratch = createHuntTargetingScratch();
        this._targetingTelemetry = createHuntTargetingTelemetry();
    }

    resolveHit(player, mg, outMuzzle = null, outAim = null, aimDirection = null) {
        const maxRange = Math.max(10, Number(mg.RANGE || 95));
        if (aimDirection?.lengthSq?.() > 0.000001) this._tmpAim.copy(aimDirection).normalize();
        else this.resolveAimDirection(player, this._tmpAim, mg);
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
            preferPlayerTargets: true,
            runtimeProfiler: this.runtime?.services?.runtimeProfiler || this.runtime?.runtimeProfiler || null,
            targetingTelemetry: this._targetingTelemetry,
            scratch: this._targetingScratch,
        });

        const targetDistance = Number(target?.distance);
        const turretHit = this._resolveTurretHit(
            player,
            this._tmpMuzzle,
            this._tmpAim,
            maxRange,
            Number.isFinite(targetDistance) ? targetDistance : maxRange
        );
        // Map geometry between muzzle and target stops the bullet. The ray is capped at the
        // nearest target, so a wall behind it never steals the shot.
        const turretDistance = Number(turretHit?.distance);
        const blockingDistance = Number.isFinite(turretDistance)
            ? turretDistance
            : (Number.isFinite(targetDistance) ? targetDistance : maxRange);
        const arenaHit = this._resolveArenaHit(
            this._tmpMuzzle,
            this._tmpAim,
            Math.min(maxRange, blockingDistance),
        );
        if (arenaHit) return arenaHit;

        if (turretHit) return turretHit;

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

        return { target: null, distance: Infinity, trail: null, turret: null, point: null };
    }

    /**
     * Nearest map geometry along the shot, or null when the arena cannot answer rays (older
     * fakes, replays without a built arena) or nothing stands in the way.
     */
    _resolveArenaHit(origin, direction, maxDistance) {
        const arena = this.runtime?.arena;
        if (typeof arena?.raycast !== 'function' || !(maxDistance > 0)) return null;
        const result = arena.raycast(origin, direction, maxDistance);
        if (!result?.hit) return null;
        // The arena answers with one reused result, so the point is copied out right away.
        return {
            target: null,
            trail: null,
            turret: null,
            arena: { sourceName: String(result.sourceName || ''), distance: result.distance },
            distance: result.distance,
            point: { x: result.point.x, y: result.point.y, z: result.point.z },
        };
    }

    _resolveTurretHit(attacker, origin, direction, maxRange, nearestDistance) {
        const turrets = this.runtime?.combat?.getMgTurretTargets?.() || [];
        let nearest = null;
        let distance = Math.min(maxRange, nearestDistance);
        for (const turret of turrets) {
            if (
                !isDestructibleTurret(turret)
                || turret.hp <= 0
                || turret.ownerPlayer === attacker
                || turret.ownerIndex === attacker?.index
                || !turret.position
            ) continue;
            this._tmpTurretOffset.subVectors(turret.position, origin);
            const forward = this._tmpTurretOffset.dot(direction);
            if (forward < 0 || forward > distance) continue;
            const radius = Math.max(0.5, Number(turret.hitboxRadius) || 2.2);
            const perpendicularSq = this._tmpTurretOffset.lengthSq() - forward * forward;
            if (perpendicularSq > radius * radius) continue;
            const entryDistance = Math.max(0, forward - Math.sqrt(Math.max(0, radius * radius - perpendicularSq)));
            if (entryDistance >= distance) continue;
            nearest = turret;
            distance = entryDistance;
        }
        if (!nearest) return null;
        this._tmpHit.copy(origin).addScaledVector(direction, distance);
        return {
            target: null,
            trail: null,
            turret: nearest,
            distance,
            point: { x: this._tmpHit.x, y: this._tmpHit.y, z: this._tmpHit.z },
        };
    }

    resolveAimDirection(player, out, mg = null) {
        player.getAimDirection(out).normalize();
        if (!player?.position) return out;
        if (!player.isBot) {
            applyFightHumanAimAssist(player, this.runtime?.players || [], out, mg, this._tmpHit);
            return out;
        }
        const maxRangeSq = Math.max(10, Number(mg?.RANGE || 95)) ** 2;
        const aimDotMin = clamp(Number(mg?.AIM_DOT_MIN) || 0.965, -1, 1);
        let bestDot = aimDotMin;
        let bestDistanceSq = Infinity;
        let found = false;
        for (const target of this.runtime?.players || []) {
            if (!target?.alive || target === player || !target.position) continue;
            this._tmpHit.subVectors(target.position, player.position);
            const distanceSq = this._tmpHit.lengthSq();
            if (distanceSq <= 0.000001 || distanceSq > maxRangeSq) continue;
            this._tmpHit.multiplyScalar(1 / Math.sqrt(distanceSq));
            const aimDot = out.dot(this._tmpHit);
            if (aimDot < aimDotMin) continue;
            if (aimDot > bestDot || (aimDot === bestDot && distanceSq < bestDistanceSq)) {
                bestDot = aimDot;
                bestDistanceSq = distanceSq;
                this._tmpTargetAim.copy(this._tmpHit);
                found = true;
            }
        }
        for (const turret of this.runtime?.combat?.getMgTurretTargets?.() || []) {
            if (!isDestructibleTurret(turret) || turret.hp <= 0 || turret.ownerIndex === player.index || !turret.position) continue;
            this._tmpHit.subVectors(turret.position, player.position);
            const distanceSq = this._tmpHit.lengthSq();
            if (distanceSq <= 0.000001 || distanceSq > maxRangeSq) continue;
            this._tmpHit.multiplyScalar(1 / Math.sqrt(distanceSq));
            const aimDot = out.dot(this._tmpHit);
            if (aimDot < aimDotMin) continue;
            if (aimDot > bestDot || (aimDot === bestDot && distanceSq < bestDistanceSq)) {
                bestDot = aimDot;
                bestDistanceSq = distanceSq;
                this._tmpTargetAim.copy(this._tmpHit);
                found = true;
            }
        }
        if (found) out.copy(this._tmpTargetAim);
        return out;
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
        const endlessMultiplier = attacker?.isBot
            ? (Number.isFinite(Number(attacker.arenaWavesDamageMultiplier))
                ? Math.max(0, Math.min(3, Number(attacker.arenaWavesDamageMultiplier)))
                : Math.max(0, Math.min(1.5, Number(attacker.endlessDamageMultiplier) || 1)))
            : 1;
        const damage = baseDamage * (1 - (1 - minFalloff) * distRatio) * endlessMultiplier;

        const damageResult = target.takeDamage(damage);
        this.runtime?.events?.emitHuntDamageEvent({
            target,
            sourcePlayer: attacker,
            cause: 'MG_BULLET',
            damageResult,
            impactPoint: impactPoint || target.position,
        });
        if (damageResult.isDead) {
            this.runtime?.lifecycle?.killPlayer?.(target, 'PROJECTILE', {
                killer: attacker,
                impactPoint: impactPoint || target.position,
                projectileType: 'MG_BULLET',
            });
        }
    }

    applyTurretHit(attacker, turret, distance, mg) {
        if (!isDestructibleTurret(turret) || turret.hp <= 0) return;
        const maxRange = Math.max(10, Number(mg.RANGE || 95));
        const minFalloff = clamp(Number(mg.MIN_FALLOFF || 0.5), 0.2, 1);
        const baseDamage = Math.max(1, Number(mg.DAMAGE || 9));
        const damage = baseDamage * (1 - (1 - minFalloff) * clamp(distance / maxRange, 0, 1));
        this.runtime?.combat?.damageMgTurret?.(turret, damage, {
            sourcePlayer: attacker,
            cause: 'MG_BULLET',
        });
    }
}

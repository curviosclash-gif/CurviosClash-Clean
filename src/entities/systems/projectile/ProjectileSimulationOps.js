import * as THREE from 'three';
import {
    createHuntTargetingScratch,
    createHuntTargetingTelemetry,
    createPlayerTargetDescriptor,
    resolveHuntLineTarget,
    resolveHuntTargetPosition,
} from '../../../hunt/HuntTargetingOps.js';
import { resolveEntityRuntimeConfig } from '../../../shared/contracts/EntityRuntimeConfig.js';

function resolveRocketRuntime(config) {
    const rocket = config?.HUNT?.ROCKET || {};
    return {
        homingMinRange: Math.max(0.000001, Number(rocket.HOMING_MIN_RANGE) || 10),
        homingMinLockOnAngle: Math.max(0.000001, Number(rocket.HOMING_MIN_LOCK_ON_ANGLE) || 5),
        homingMinTurnRate: Math.max(0.000001, Number(rocket.HOMING_MIN_TURN_RATE) || 0.1),
        homingMinReacquireInterval: Math.max(0.000001, Number(rocket.HOMING_MIN_REACQUIRE_INTERVAL) || 0.04),
        homingReacquireInterval: Math.max(0.000001, Number(rocket.HOMING_REACQUIRE_INTERVAL) || 0.12),
        homingSpeedEpsilon: Math.max(0.0000001, Number(rocket.HOMING_SPEED_EPSILON) || 0.0001),
        portalExitForwardOffset: Math.max(0, Number(rocket.PORTAL_EXIT_FORWARD_OFFSET) || 1.5),
        foamBounceMaxCount: Math.max(0, Math.floor(Number(rocket.FOAM_BOUNCE_MAX_COUNT) || 3)),
        foamBounceNormalBias: Math.max(0, Number(rocket.FOAM_BOUNCE_NORMAL_BIAS) || 0.08),
        foamBounceSpeedMultiplier: Math.max(0, Number(rocket.FOAM_BOUNCE_SPEED_MULTIPLIER) || 1.02),
        foamBouncePositionMinOffset: Math.max(0, Number(rocket.FOAM_BOUNCE_POSITION_MIN_OFFSET) || 0.2),
        foamBouncePositionRadiusScale: Math.max(0, Number(rocket.FOAM_BOUNCE_POSITION_RADIUS_SCALE) || 1.25),
        foamBounceCooldown: Math.max(0, Number(rocket.FOAM_BOUNCE_COOLDOWN) || 0.045),
        foamBounceTtlPenalty: Math.max(0, Number(rocket.FOAM_BOUNCE_TTL_PENALTY) || 0.02),
        flameFlickerBase: Number(rocket.FLAME_FLICKER_BASE) || 0.7,
        flameFlickerAmplitude: Number(rocket.FLAME_FLICKER_AMPLITUDE) || 0.3,
        flameFlickerSpeed: Number(rocket.FLAME_FLICKER_SPEED) || 30,
        flameFlickerIndexPhase: Number(rocket.FLAME_FLICKER_INDEX_PHASE) || 7,
    };
}

export class ProjectileSimulationOps {
    constructor(system) {
        this.system = system || null;
        this._tmpVec = new THREE.Vector3();
        this._tmpVec2 = new THREE.Vector3();
        this._tmpDir = new THREE.Vector3();
        this._tmpTargetPosition = new THREE.Vector3();
        this._targetingScratch = createHuntTargetingScratch();
        this._targetingTelemetry = createHuntTargetingTelemetry();
        this._stepResult = {
            projectileExpired: false,
            projectileHitArena: false,
            bouncedOnFoam: false,
            arenaCollision: null,
        };
    }

    acquireHomingTarget(projectile, players, trailSpatialIndex = null) {
        const config = resolveEntityRuntimeConfig(this.system);
        const rocketRuntime = resolveRocketRuntime(config);
        if (!projectile || !Array.isArray(players) || players.length === 0) return null;

        const owner = projectile.owner;
        const maxRange = Math.max(
            rocketRuntime.homingMinRange,
            Number(projectile.homingRange || config?.HOMING?.MAX_LOCK_RANGE || 100)
        );
        const maxRangeSq = maxRange * maxRange;
        const lockOnAngle = Math.max(
            rocketRuntime.homingMinLockOnAngle,
            Number(projectile.homingLockOnAngle || config?.HOMING?.LOCK_ON_ANGLE || 15)
        );
        const minDot = Math.cos(THREE.MathUtils.degToRad(lockOnAngle));

        this._tmpVec2.copy(projectile.velocity);
        const speed = this._tmpVec2.length();
        if (speed <= rocketRuntime.homingSpeedEpsilon) return null;
        this._tmpVec2.divideScalar(speed);

        if (projectile.huntRocket) {
            const trailHitRadius = Math.max(
                Number(projectile.radius) || 0,
                Number(config?.HUNT?.MG?.TRAIL_HIT_RADIUS || 0.78)
            );
            const mgTrailRange = Math.max(rocketRuntime.homingMinRange, Number(config?.HUNT?.MG?.RANGE || 95));
            const sharedTarget = resolveHuntLineTarget({
                sourcePlayer: owner,
                players,
                trailSpatialIndex,
                origin: projectile.position,
                direction: this._tmpVec2,
                playerRange: maxRange,
                trailRange: mgTrailRange,
                trailSampleStep: Number(config?.HUNT?.MG?.TRAIL_SAMPLE_STEP),
                trailHitRadius,
                trailSelfSkipRecent: Number(config?.HUNT?.MG?.TRAIL_SELF_SKIP_RECENT),
                allowSelfTrailFallback: true,
                runtimeProfiler: this.system?.runtimeProfiler || null,
                targetingTelemetry: this._targetingTelemetry,
                scratch: this._targetingScratch,
            });
            if (sharedTarget) {
                return sharedTarget;
            }
        }

        let bestTarget = null;
        let bestDistSq = Infinity;
        let bestFallbackTarget = null;
        let bestFallbackDistSq = Infinity;
        for (const target of players) {
            if (!target || !target.alive || target === owner) continue;

            this._tmpVec.subVectors(target.position, projectile.position);
            const distSq = this._tmpVec.lengthSq();
            if (distSq <= 1 || distSq > maxRangeSq) continue;
            if (distSq < bestFallbackDistSq) {
                bestFallbackDistSq = distSq;
                bestFallbackTarget = target;
            }

            const distance = Math.sqrt(distSq);
            this._tmpDir.copy(this._tmpVec).multiplyScalar(1 / distance);
            if (this._tmpVec2.dot(this._tmpDir) < minDot) continue;

            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                bestTarget = target;
            }
        }
        if (bestTarget) {
            return projectile.huntRocket
                ? createPlayerTargetDescriptor(bestTarget, Math.sqrt(bestDistSq))
                : bestTarget;
        }
        if (projectile.huntRocket && bestFallbackTarget) {
            return createPlayerTargetDescriptor(bestFallbackTarget, Math.sqrt(bestFallbackDistSq));
        }
        return null;
    }

    bounceProjectileOnFoam(projectile, collisionInfo) {
        const config = resolveEntityRuntimeConfig(this.system);
        const rocketRuntime = resolveRocketRuntime(config);
        if (!projectile || !collisionInfo?.normal) return false;

        if ((projectile.foamBounces || 0) >= rocketRuntime.foamBounceMaxCount) return false;
        if ((projectile.foamBounceCooldown || 0) > 0) return false;

        this._tmpVec.copy(projectile.velocity);
        const speed = this._tmpVec.length();
        if (speed <= rocketRuntime.homingSpeedEpsilon) return false;

        this._tmpVec2.copy(collisionInfo.normal).normalize();
        if (this._tmpVec.dot(this._tmpVec2) >= 0) {
            this._tmpVec2.multiplyScalar(-1);
        }

        this._tmpVec.normalize().reflect(this._tmpVec2);
        this._tmpVec.addScaledVector(this._tmpVec2, rocketRuntime.foamBounceNormalBias).normalize();
        projectile.velocity.copy(this._tmpVec.multiplyScalar(speed * rocketRuntime.foamBounceSpeedMultiplier));

        projectile.position.addScaledVector(
            this._tmpVec2,
            Math.max(rocketRuntime.foamBouncePositionMinOffset, projectile.radius * rocketRuntime.foamBouncePositionRadiusScale)
        );
        projectile.mesh.position.copy(projectile.position);
        this._tmpVec.addVectors(projectile.position, projectile.velocity);
        projectile.mesh.lookAt(this._tmpVec);

        projectile.foamBounces = (projectile.foamBounces || 0) + 1;
        projectile.foamBounceCooldown = rocketRuntime.foamBounceCooldown;
        projectile.ttl = Math.max(0, projectile.ttl - rocketRuntime.foamBounceTtlPenalty);

        this.system?.onProjectileHit?.(projectile.position, 0x34d399, projectile.owner, projectile);
        return true;
    }

    stepProjectile(projectile, index, dt, arena, players, trailSpatialIndex, time) {
        const config = resolveEntityRuntimeConfig(this.system);
        const rocketRuntime = resolveRocketRuntime(config);
        projectile.foamBounceCooldown = Math.max(0, (projectile.foamBounceCooldown || 0) - dt);
        projectile.previousPosition?.copy?.(projectile.position);

        const vx = projectile.velocity.x * dt;
        const vy = projectile.velocity.y * dt;
        const vz = projectile.velocity.z * dt;
        projectile.position.x += vx;
        projectile.position.y += vy;
        projectile.position.z += vz;
        projectile.traveled += Math.sqrt(vx * vx + vy * vy + vz * vz);
        projectile.ttl -= dt;

        projectile.mesh.position.copy(projectile.position);
        this._tmpVec.addVectors(projectile.position, projectile.velocity);
        projectile.mesh.lookAt(this._tmpVec);

        const portalResult = arena?.checkPortal
            ? arena.checkPortal(
                projectile.position,
                projectile.radius,
                projectile.traversalId || `projectile:${index}`,
                projectile.previousPosition
            )
            : null;
        if (portalResult?.target) {
            projectile.position.copy(portalResult.target);
            if (portalResult.rotation) projectile.velocity.applyQuaternion(portalResult.rotation);
            if (portalResult.exitForward) this._tmpVec.copy(portalResult.exitForward);
            else this._tmpVec.copy(projectile.velocity).normalize();
            this._tmpVec.multiplyScalar(rocketRuntime.portalExitForwardOffset);
            projectile.position.add(this._tmpVec);
            projectile.previousPosition?.copy?.(projectile.position);
            projectile.mesh.position.copy(projectile.position);
            this.system?._rocketTrailSystem?.resetProjectileSample?.(projectile);
            projectile.target = null;
            projectile.homingReacquireTimer = Math.max(
                rocketRuntime.homingMinReacquireInterval,
                Number(projectile.homingReacquireInterval || rocketRuntime.homingReacquireInterval)
            );
        }

        if (projectile.huntRocket) {
            projectile.homingReacquireTimer = Math.max(0, (projectile.homingReacquireTimer || 0) - dt);
            const currentTarget = resolveHuntTargetPosition(
                projectile.target,
                players,
                trailSpatialIndex,
                this._tmpTargetPosition,
                { scratch: this._targetingScratch }
            );
            if (!currentTarget || projectile.homingReacquireTimer <= 0) {
                projectile.target = this.acquireHomingTarget(projectile, players, trailSpatialIndex);
                projectile.homingReacquireTimer = Math.max(
                    rocketRuntime.homingMinReacquireInterval,
                    Number(projectile.homingReacquireInterval || rocketRuntime.homingReacquireInterval)
                );
            }
        }

        const targetPosition = resolveHuntTargetPosition(
            projectile.target,
            players,
            trailSpatialIndex,
            this._tmpTargetPosition,
            { scratch: this._targetingScratch }
        );
        if (targetPosition) {
            this._tmpVec.subVectors(targetPosition, projectile.position);
            if (this._tmpVec.lengthSq() > 0.000001) {
                this._tmpVec.normalize();
                this._tmpVec2.copy(projectile.velocity);
                const speed = this._tmpVec2.length();
                const turnRate = Math.max(
                    rocketRuntime.homingMinTurnRate,
                    Number(projectile.homingTurnRate || config?.HOMING?.TURN_RATE)
                );
                this._tmpVec2.normalize().lerp(this._tmpVec, Math.min(turnRate * dt, 1.0)).normalize();
                projectile.velocity.copy(this._tmpVec2.multiplyScalar(speed));
                this._tmpVec.addVectors(projectile.position, projectile.velocity);
                projectile.mesh.lookAt(this._tmpVec);
            }
        }

        if (projectile.flame) {
            const flicker = rocketRuntime.flameFlickerBase
                + Math.sin(time * rocketRuntime.flameFlickerSpeed + index * rocketRuntime.flameFlickerIndexPhase)
                * rocketRuntime.flameFlickerAmplitude;
            projectile.flame.scale.set(1, 1, flicker);
        }

        let arenaCollision = null;
        if (typeof arena?.getCollisionInfo === 'function') {
            arenaCollision = arena.getCollisionInfo(projectile.position, projectile.radius);
        } else if (typeof arena?.checkCollision === 'function' && arena.checkCollision(projectile.position, projectile.radius)) {
            arenaCollision = { hit: true, kind: 'wall', normal: null };
        }

        const projectileExpired = projectile.ttl <= 0 || projectile.traveled >= (config?.PROJECTILE?.MAX_DISTANCE || Infinity);
        const projectileHitArena = !!arenaCollision?.hit;
        const arenaKind = String(arenaCollision?.kind || 'wall').toLowerCase();
        const bouncedOnFoam = projectileHitArena && arenaKind === 'foam'
            ? this.bounceProjectileOnFoam(projectile, arenaCollision)
            : false;

        const out = this._stepResult;
        out.projectileExpired = projectileExpired;
        out.projectileHitArena = projectileHitArena;
        out.bouncedOnFoam = bouncedOnFoam;
        out.arenaCollision = arenaCollision;
        return out;
    }
}

import { isDestructibleTurret, isTurretTargetPlayerEligible } from '../../../shared/contracts/TurretCombatContract.js';
import * as THREE from 'three';
import { resolveWaterAdjustedDelta } from '../WaterGameplayOps.js';
import {
    createHuntTargetingScratch,
    createHuntTargetingTelemetry,
    createPlayerTargetDescriptor,
    isPlayerTargetDescriptor,
    isTrailTargetDescriptor,
    resolveHuntLineTarget,
    resolveHuntTargetOwnerPlayer,
    resolveHuntTargetPosition,
} from '../../../hunt/HuntTargetingOps.js';
import { resolveEntityRuntimeConfig } from '../../../shared/contracts/EntityRuntimeConfig.js';
import { ITEM_PROJECTILE_TARGETING_PROFILE, resolveItemProjectileTarget } from './ItemProjectileTargetingOps.js';
import { resolveLockedPlayerIndex } from './RocketThreatTracker.js';
import { stepGuidedRocket } from './GuidedRocketControlOps.js';
import { canDamage, TEAM_WEAPON_KINDS } from '../../../shared/contracts/TeamCombatContract.js';
import {
    clearInterceptState,
    findProjectileByTraversalId,
    resolveInterceptAimPosition,
} from './RocketInterceptOps.js';

function clamp01(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    if (numeric <= 0) return 0;
    if (numeric >= 1) return 1;
    return numeric;
}

function canAcquireTargetable(projectile, target) {
    const owner = projectile?.owner;
    return projectile?.turretTargeting == null
        && projectile?.environmentProjectile !== true
        && isDestructibleTurret(target)
        && target.hp > 0
        && target.alive !== false
        && target.ownerPlayer !== owner
        && target.ownerIndex !== owner?.index
        && (!projectile?.sourceTurretId || target.id !== projectile.sourceTurretId)
        && canDamage(owner, target, TEAM_WEAPON_KINDS.ROCKET)
        && !!target.position;
}

const canAcquirePlayer = (target, owner) => canDamage(owner, target, TEAM_WEAPON_KINDS.ROCKET);

function resolveRocketRuntime(config) {
    const rocket = config?.HUNT?.ROCKET || {};
    const homing = config?.HOMING || {};
    return {
        homingMinRange: Math.max(0.000001, Number(rocket.HOMING_MIN_RANGE) || 10),
        homingMinLockOnAngle: Math.max(0.000001, Number(rocket.HOMING_MIN_LOCK_ON_ANGLE) || 5),
        homingMinTurnRate: Math.max(0.000001, Number(rocket.HOMING_MIN_TURN_RATE) || 0.1),
        homingMinReacquireInterval: Math.max(0.000001, Number(rocket.HOMING_MIN_REACQUIRE_INTERVAL) || 0.04),
        homingReacquireInterval: Math.max(0.000001, Number(rocket.HOMING_REACQUIRE_INTERVAL) || 0.08),
        homingSpeedEpsilon: Math.max(0.0000001, Number(rocket.HOMING_SPEED_EPSILON) || 0.0001),
        homingLeadTimeMax: Math.max(
            0,
            Number(rocket.HOMING_LEAD_TIME_MAX ?? homing.LEAD_TIME_MAX) || 0.35
        ),
        homingFallbackAngleScale: Math.max(1, Number(rocket.HOMING_FALLBACK_ANGLE_SCALE) || 1.75),
        homingFallbackAngleMax: Math.max(5, Number(rocket.HOMING_FALLBACK_ANGLE_MAX) || 90),
        homingTrailPriorityRatio: Math.min(
            1,
            Math.max(0.1, Number(rocket.HOMING_TRAIL_PRIORITY_RATIO) || 0.85)
        ),
        homingTurnDotBlend: clamp01(
            Number(rocket.HOMING_TURN_DOT_BLEND ?? homing.TURN_DOT_BLEND) || 0.35
        ),
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
        this._tmpCollisionProbe = new THREE.Vector3();
        this._tmpCollisionEnd = new THREE.Vector3();
        this._targetingScratch = createHuntTargetingScratch();
        this._targetingTelemetry = createHuntTargetingTelemetry();
        this._stepResult = {
            projectileExpired: false,
            projectileHitArena: false,
            bouncedOnFoam: false,
            arenaCollision: null,
        };
        this._fallbackArenaCollision = { hit: true, kind: 'wall', normal: null };
    }

    _resolveArenaCollision(projectile, arena) {
        const hasCollisionInfo = typeof arena?.getCollisionInfo === 'function';
        const hasCollisionCheck = typeof arena?.checkCollision === 'function';
        const hasSeedRaycast = typeof arena?.raycastDandelionSeed === 'function';
        if (!hasCollisionInfo && !hasCollisionCheck && !hasSeedRaycast) return null;

        const previousPosition = projectile.previousPosition || projectile.position;
        this._tmpCollisionEnd.copy(projectile.position);
        const distance = previousPosition?.distanceTo?.(this._tmpCollisionEnd) || 0;
        let seedHit = null;
        if (hasSeedRaycast && distance > 0.000001) {
            this._tmpDir.subVectors(this._tmpCollisionEnd, previousPosition).divideScalar(distance);
            seedHit = arena.raycastDandelionSeed(
                previousPosition, this._tmpDir, distance, Number(projectile.radius) || 0,
            );
            if (seedHit && typeof arena.raycast === 'function') {
                const blocker = arena.raycast(previousPosition, this._tmpDir, seedHit.distance);
                if (blocker?.hit && blocker.distance < seedHit.distance - 0.001) seedHit = null;
            }
        }
        const stepDistance = Math.max(0.1, (Number(projectile.radius) || 0.5) * 0.75);
        const steps = Math.min(64, Math.max(1, Math.ceil(distance / stepDistance)));
        for (let step = 1; step <= steps; step++) {
            this._tmpCollisionProbe.lerpVectors(previousPosition, this._tmpCollisionEnd, step / steps);
            if (seedHit && seedHit.distance <= distance * step / steps) {
                projectile.position.set(seedHit.point.x, seedHit.point.y, seedHit.point.z);
                projectile.mesh?.position.copy(projectile.position);
                return { hit: true, kind: 'hard', sourceName: seedHit.sourceName };
            }
            const collision = hasCollisionInfo
                ? arena.getCollisionInfo(this._tmpCollisionProbe, projectile.radius)
                : (hasCollisionCheck && arena.checkCollision(this._tmpCollisionProbe, projectile.radius)
                    ? this._fallbackArenaCollision
                    : null);
            if (!collision?.hit) continue;
            projectile.position.copy(this._tmpCollisionProbe);
            projectile.mesh?.position.copy(projectile.position);
            return collision;
        }
        return null;
    }

    _isAllowedTurretTarget(projectile, target, players) {
        const rules = projectile.turretTargeting;
        if (!rules) return true;
        if (isTrailTargetDescriptor(target) && !rules.targetTrails) return false;
        const player = resolveHuntTargetOwnerPlayer(target, players);
        return isTurretTargetPlayerEligible(player, projectile.owner, rules.targetPlayers);
    }

    acquireHomingTarget(projectile, players, trailSpatialIndex = null) {
        const config = resolveEntityRuntimeConfig(this.system);
        const rocketRuntime = resolveRocketRuntime(config);
        if (!projectile) return null;
        const playerTargets = Array.isArray(players) ? players : [];

        if (projectile.itemHomingProfile) {
            if (playerTargets.length === 0) return null;
            this._tmpVec2.copy(projectile.velocity);
            if (this._tmpVec2.lengthSq() <= rocketRuntime.homingSpeedEpsilon ** 2) return null;
            this._tmpVec2.normalize();
            return resolveItemProjectileTarget({
                owner: projectile.owner,
                players: playerTargets,
                origin: projectile.position,
                direction: this._tmpVec2,
                scratch: this._tmpVec,
                currentTarget: projectile.target,
            });
        }
        const targetables = this.system?.getTurrets?.() || [];
        if (playerTargets.length === 0 && targetables.length === 0) return null;

        const owner = projectile.owner;
        const homingEnabled = projectile.homingEnabled || projectile.huntRocket;
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
        const fallbackAngle = Math.min(
            rocketRuntime.homingFallbackAngleMax,
            lockOnAngle * rocketRuntime.homingFallbackAngleScale
        );
        const fallbackMinDot = Math.cos(THREE.MathUtils.degToRad(fallbackAngle));

        this._tmpVec2.copy(projectile.velocity);
        const speed = this._tmpVec2.length();
        if (speed <= rocketRuntime.homingSpeedEpsilon) return null;
        this._tmpVec2.divideScalar(speed);

        let lineTarget = null;
        if (homingEnabled) {
            const trailHitRadius = Math.max(
                Number(projectile.radius) || 0,
                Number(config?.HUNT?.MG?.TRAIL_HIT_RADIUS || 0.78)
            );
            const mgTrailRange = Math.max(rocketRuntime.homingMinRange, Number(config?.HUNT?.MG?.RANGE || 95));
            lineTarget = resolveHuntLineTarget({
                sourcePlayer: owner,
                players: playerTargets,
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
                canTargetPlayer: canAcquirePlayer,
                excludeTeammates: false,
            });
            if (resolveHuntTargetOwnerPlayer(lineTarget, playerTargets)?.decoyActive
                || !this._isAllowedTurretTarget(projectile, lineTarget, playerTargets)) {
                lineTarget = null;
            }
        }

        let bestConeTarget = null;
        let bestConeTargetIsPlayer = false;
        let bestConeDistSq = Infinity;
        let bestFallbackTarget = null;
        let bestFallbackTargetIsPlayer = false;
        let bestFallbackDistSq = Infinity;
        for (const target of playerTargets) {
            if (!target || !target.alive || target === owner || target.decoyActive
                || !canDamage(owner, target, TEAM_WEAPON_KINDS.ROCKET)
                || !this._isAllowedTurretTarget(projectile, target, playerTargets)) continue;

            this._tmpVec.subVectors(target.position, projectile.position);
            const distSq = this._tmpVec.lengthSq();
            if (distSq <= 1 || distSq > maxRangeSq) continue;

            const distance = Math.sqrt(distSq);
            this._tmpDir.copy(this._tmpVec).multiplyScalar(1 / distance);
            const facingDot = this._tmpVec2.dot(this._tmpDir);

            if (facingDot >= minDot && distSq < bestConeDistSq) {
                bestConeDistSq = distSq;
                bestConeTarget = target;
                bestConeTargetIsPlayer = true;
            } else if (
                homingEnabled
                && facingDot >= fallbackMinDot
                && distSq < bestFallbackDistSq
            ) {
                bestFallbackDistSq = distSq;
                bestFallbackTarget = target;
                bestFallbackTargetIsPlayer = true;
            }
        }
        for (const target of targetables) {
            if (!canAcquireTargetable(projectile, target)) continue;

            this._tmpVec.subVectors(target.position, projectile.position);
            const distSq = this._tmpVec.lengthSq();
            if (distSq <= 1 || distSq > maxRangeSq) continue;

            const distance = Math.sqrt(distSq);
            this._tmpDir.copy(this._tmpVec).multiplyScalar(1 / distance);
            const facingDot = this._tmpVec2.dot(this._tmpDir);

            if (facingDot >= minDot && distSq < bestConeDistSq) {
                bestConeDistSq = distSq;
                bestConeTarget = target;
                bestConeTargetIsPlayer = false;
            } else if (
                homingEnabled
                && facingDot >= fallbackMinDot
                && distSq < bestFallbackDistSq
            ) {
                bestFallbackDistSq = distSq;
                bestFallbackTarget = target;
                bestFallbackTargetIsPlayer = false;
            }
        }

        if (lineTarget) {
            if (isPlayerTargetDescriptor(lineTarget)) {
                if (!bestConeTargetIsPlayer && bestConeTarget) {
                    const lineDistance = Number(lineTarget.distance);
                    if (!Number.isFinite(lineDistance) || bestConeDistSq < lineDistance * lineDistance) {
                        return bestConeTarget;
                    }
                }
                return lineTarget;
            }
            if (isTrailTargetDescriptor(lineTarget)) {
                if (bestConeTarget) {
                    const playerDist = Math.sqrt(bestConeDistSq);
                    const trailDist = Number.isFinite(lineTarget.distance)
                        ? lineTarget.distance
                        : Infinity;
                    if (!(trailDist < playerDist * rocketRuntime.homingTrailPriorityRatio)) {
                        return bestConeTargetIsPlayer
                            ? createPlayerTargetDescriptor(bestConeTarget, playerDist)
                            : bestConeTarget;
                    }
                }
                return lineTarget;
            }
            return lineTarget;
        }

        if (bestConeTarget) {
            return homingEnabled && bestConeTargetIsPlayer
                ? createPlayerTargetDescriptor(bestConeTarget, Math.sqrt(bestConeDistSq))
                : bestConeTarget;
        }
        if (homingEnabled && bestFallbackTarget) {
            return bestFallbackTargetIsPlayer
                ? createPlayerTargetDescriptor(bestFallbackTarget, Math.sqrt(bestFallbackDistSq))
                : bestFallbackTarget;
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
        if (projectile.guidedActive) stepGuidedRocket(projectile, dt, config?.HUNT?.ROCKET, this._tmpDir);
        const homingEnabled = !projectile.guidedActive && (projectile.homingEnabled || projectile.huntRocket);
        projectile.foamBounceCooldown = Math.max(0, (projectile.foamBounceCooldown || 0) - dt);
        projectile.previousPosition?.copy?.(projectile.position);

        const movementDt = resolveWaterAdjustedDelta(
            this.system?.getWaterZoneSystem?.(),
            projectile.position,
            dt
        );
        const vx = projectile.velocity.x * movementDt;
        const vy = projectile.velocity.y * movementDt;
        const vz = projectile.velocity.z * movementDt;
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
            if (!projectile.targetReacquireDisabled) projectile.target = null;
            projectile.homingReacquireTimer = Math.max(
                rocketRuntime.homingMinReacquireInterval,
                Number(projectile.homingReacquireInterval || rocketRuntime.homingReacquireInterval)
            );
        }

        // A defence rocket chases a rocket, not a player. Its target is looked up by id
        // every tick: pooled states are recycled, so a stale id simply finds nothing and
        // the rocket falls back to normal hunting (A3).
        let interceptTarget = null;
        if (projectile.isInterceptor) {
            interceptTarget = findProjectileByTraversalId(this.system?.projectiles, projectile.interceptTargetId);
            if (!interceptTarget) clearInterceptState(projectile);
            else projectile.target = null;
        }

        if (homingEnabled && !interceptTarget) {
            projectile.homingReacquireTimer = Math.max(0, (projectile.homingReacquireTimer || 0) - dt);
            let currentTarget = resolveHuntTargetPosition(
                projectile.target,
                players,
                trailSpatialIndex,
                this._tmpTargetPosition,
                { scratch: this._targetingScratch }
            );
            if (resolveHuntTargetOwnerPlayer(projectile.target, players)?.decoyActive
                || !this._isAllowedTurretTarget(projectile, projectile.target, players)) {
                projectile.target = null;
                currentTarget = null;
                projectile.homingReacquireTimer = 0;
            }
            if (!projectile.targetReacquireDisabled && ((!currentTarget && (!projectile.turretTargeting || projectile.target || projectile.homingReacquireTimer <= 0))
                || (!projectile.turretTargeting && projectile.homingReacquireTimer <= 0))) {
                projectile.target = this.acquireHomingTarget(projectile, players, trailSpatialIndex);
                projectile.homingReacquireTimer = Math.max(
                    rocketRuntime.homingMinReacquireInterval,
                    Number(projectile.homingReacquireInterval || rocketRuntime.homingReacquireInterval)
                );
            }
        }

        const targetPosition = interceptTarget
            ? resolveInterceptAimPosition(
                projectile,
                interceptTarget,
                this._tmpTargetPosition,
                rocketRuntime.homingLeadTimeMax,
                rocketRuntime.homingSpeedEpsilon
            )
            : resolveHuntTargetPosition(
                projectile.target,
                players,
                trailSpatialIndex,
                this._tmpTargetPosition,
                { scratch: this._targetingScratch }
            );
        // E37: an interceptor locks on nobody, so it never raises a rocket warning.
        projectile.lockedPlayerIndex = interceptTarget ? -1 : resolveLockedPlayerIndex(projectile.target, players);
        if (targetPosition) {
            const targetPlayer = interceptTarget ? null : resolveHuntTargetOwnerPlayer(projectile.target, players);
            const leadOnPlayer = !!targetPlayer?.velocity && (
                isPlayerTargetDescriptor(projectile.target)
                || projectile.target === targetPlayer
            );
            const homingLeadTimeMax = projectile.itemHomingProfile
                ? ITEM_PROJECTILE_TARGETING_PROFILE.leadTimeMax
                : rocketRuntime.homingLeadTimeMax;
            if (leadOnPlayer && homingLeadTimeMax > 0) {
                this._tmpVec2.copy(projectile.velocity);
                const rocketSpeed = this._tmpVec2.length();
                if (rocketSpeed > rocketRuntime.homingSpeedEpsilon) {
                    const distance = this._tmpVec.subVectors(targetPosition, projectile.position).length();
                    const leadTime = Math.min(
                        homingLeadTimeMax,
                        distance / rocketSpeed
                    );
                    targetPosition.addScaledVector(targetPlayer.velocity, leadTime);
                }
            }

            this._tmpVec.subVectors(targetPosition, projectile.position);
            if (this._tmpVec.lengthSq() > 0.000001) {
                this._tmpVec.normalize();
                this._tmpVec2.copy(projectile.velocity);
                const speed = this._tmpVec2.length();
                if (speed > rocketRuntime.homingSpeedEpsilon) {
                    this._tmpVec2.divideScalar(speed);
                    const turnRate = Math.max(
                        rocketRuntime.homingMinTurnRate,
                        Number(projectile.homingTurnRate || config?.HOMING?.TURN_RATE)
                    );
                    const align = THREE.MathUtils.clamp(this._tmpVec2.dot(this._tmpVec), -1, 1);
                    const align01 = align * 0.5 + 0.5;
                    const effectiveTurnRate = turnRate * (
                        1 - rocketRuntime.homingTurnDotBlend
                        + rocketRuntime.homingTurnDotBlend * align01
                    );
                    this._tmpVec2.lerp(this._tmpVec, Math.min(effectiveTurnRate * dt, 1.0)).normalize();
                    projectile.velocity.copy(this._tmpVec2.multiplyScalar(speed));
                    this._tmpVec.addVectors(projectile.position, projectile.velocity);
                    projectile.mesh.lookAt(this._tmpVec);
                }
            }
        }

        if (projectile.flame) {
            const flicker = rocketRuntime.flameFlickerBase
                + Math.sin(time * rocketRuntime.flameFlickerSpeed + index * rocketRuntime.flameFlickerIndexPhase)
                * rocketRuntime.flameFlickerAmplitude;
            projectile.flame.scale.set(1, 1, flicker);
        }

        const arenaCollision = this._resolveArenaCollision(projectile, arena);

        const projectileExpired = projectile.ttl <= 0
            || projectile.traveled >= (projectile.maxDistance ?? config?.PROJECTILE?.MAX_DISTANCE ?? Infinity);
        const projectileHitArena = !!arenaCollision?.hit;
        const arenaKind = String(arenaCollision?.kind || 'wall').toLowerCase();
        const bouncedOnFoam = projectile.type !== 'HYDRA_FIREBALL' && projectileHitArena && arenaKind === 'foam'
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

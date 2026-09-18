import { isDestructibleTurret, isTurretTargetPlayerEligible } from '../../../shared/contracts/TurretCombatContract.js';
import { HUNT_CONFIG } from '../../../hunt/HuntConfig.js';
import { isHuntHealthActive } from '../../../hunt/HealthSystem.js';
import { isRocketTierType, resolveRocketTierDamage } from '../../../hunt/RocketPickupSystem.js';
import { applyTrailDamageFromProjectile } from '../../../hunt/DestructibleTrail.js';
import { applyExplosionKnockback } from '../ExplosionKnockbackOps.js';
import { resolveInterceptHit } from './RocketInterceptOps.js';

// Der Spawnschutz aus dem RespawnSystem (INVULNERABILITY_SECONDS) macht einen frisch
// eingesetzten Spieler unangreifbar - Spur, Wand, Crash, Hazard und Turret halten sich
// daran, also duerfen Raketen, ihre Druckwelle und Minen ihn auch nicht treffen.
function isSpawnProtected(player) {
    return (Number(player?.spawnProtectionTimer) || 0) > 0;
}

function damagesOnContact(projectile) {
    return isRocketTierType(projectile?.type) || projectile?.type === 'MINE';
}

function resolveEndlessProjectileDamage(owner, damage) {
    const multiplier = owner?.isBot
        ? (Number.isFinite(Number(owner.arenaWavesDamageMultiplier))
            ? Math.max(0, Math.min(3, Number(owner.arenaWavesDamageMultiplier)))
            : Math.max(0, Math.min(1.5, Number(owner.endlessDamageMultiplier) || 1)))
        : 1;
    return damage * multiplier;
}
import { resolveEntityRuntimeConfig } from '../../../shared/contracts/EntityRuntimeConfig.js';
import { getPickupDefinition } from '../../PickupRegistry.js';

export class ProjectileHitResolver {
    constructor(system) {
        this.system = system || null;
        this._tmpVec = this.system?._tmpVec || null;
    }

    detonateProjectile(projectile, position = projectile?.position, color = 0xffff00) {
        if (!isRocketTierType(projectile?.type) || projectile.detonated) return false;
        projectile.detonated = true;
        this.system?.onProjectileHit?.(position, color, projectile.owner, projectile);
        return true;
    }

    _resolveTrailHit(projectile, trailSpatialIndex) {
        const directHit = applyTrailDamageFromProjectile(trailSpatialIndex, projectile);
        const previousPosition = projectile.previousPosition;
        if (directHit || !previousPosition || typeof previousPosition.distanceTo !== 'function' || !this._tmpVec) {
            return directHit;
        }

        const distance = previousPosition.distanceTo(projectile.position);
        const stepDistance = Math.max(0.5, (Number(projectile.radius) || 0.5) * 1.5);
        const steps = Math.min(8, Math.max(2, Math.ceil(distance / stepDistance)));
        const currentX = projectile.position.x;
        const currentY = projectile.position.y;
        const currentZ = projectile.position.z;

        for (let i = 1; i < steps; i++) {
            this._tmpVec.lerpVectors(previousPosition, projectile.position, i / steps);
            projectile.position.copy(this._tmpVec);
            const sweptHit = applyTrailDamageFromProjectile(trailSpatialIndex, projectile);
            projectile.position.set(currentX, currentY, currentZ);
            if (sweptHit) return sweptHit;
        }

        return null;
    }

    _isProjectileTouchingTarget(projectile, target, point) {
        if (target.isSphereInOBB && target.isSphereInOBB(point, projectile.radius)) {
            return true;
        }
        if (target.isPointInOBB && target.isPointInOBB(point)) {
            return true;
        }
        const hitRadius = (Number(target.hitboxRadius) || 0) + (Number(projectile.radius) || 0);
        return target.position.distanceToSquared(point) <= hitRadius * hitRadius;
    }

    _isProjectileSweepTouchingTarget(projectile, target) {
        const previousPosition = projectile.previousPosition;
        if (!previousPosition || typeof previousPosition.distanceTo !== 'function' || !this._tmpVec) {
            return this._isProjectileTouchingTarget(projectile, target, projectile.position);
        }

        const distance = previousPosition.distanceTo(projectile.position);
        const hitRadius = Math.max(0.5, (Number(target.hitboxRadius) || 0) + (Number(projectile.radius) || 0));
        const steps = Math.min(8, Math.max(1, Math.ceil(distance / hitRadius)));
        for (let i = 1; i <= steps; i++) {
            this._tmpVec.lerpVectors(previousPosition, projectile.position, i / steps);
            if (this._isProjectileTouchingTarget(projectile, target, this._tmpVec)) {
                projectile.position.copy(this._tmpVec);
                projectile.mesh?.position.copy(projectile.position);
                return true;
            }
        }
        return false;
    }

    _applyRocketExplosion(projectile, players, directHitTarget) {
        if (projectile?.environmentProjectile) return;
        const rocketConfig = resolveEntityRuntimeConfig(this.system)?.HUNT?.ROCKET || HUNT_CONFIG.ROCKET;
        const explosionRadius = Math.max(1, Number(rocketConfig?.EXPLOSION_RADIUS || 25));
        const explosionDamageFalloff = Math.max(0, Math.min(1, Number(rocketConfig?.EXPLOSION_DAMAGE_FALLOFF || 0.5)));
        const baseDamage = resolveRocketTierDamage(projectile.type, this.system);
        const damageAtCenter = baseDamage * (1 + explosionDamageFalloff);

        for (const target of players || []) {
            if (!target.alive || target === projectile.owner || target === directHitTarget) continue;
            if (isSpawnProtected(target)) continue;
            if (projectile.owner?.staticTurret === true && projectile.owner.targetPlayers !== 'all' && target.isBot === true) continue;
            if (projectile.turretTargeting && !isTurretTargetPlayerEligible(target, projectile.owner, projectile.turretTargeting.targetPlayers)) continue;

            const distanceToTarget = target.position.distanceTo(projectile.position);
            if (distanceToTarget > explosionRadius) continue;

            const damageFalloff = 1 - (distanceToTarget / explosionRadius) * explosionDamageFalloff;
            const explosionDamage = Math.max(1, Math.floor(resolveEndlessProjectileDamage(
                projectile.owner,
                damageAtCenter * damageFalloff
            )));
            const damageResult = target.takeDamage(explosionDamage);
            applyExplosionKnockback(target, projectile.position, damageFalloff, this.system);
            this.system?.onProjectileDamage?.(target, projectile.owner, projectile.type, damageResult, projectile);
        }
    }

    _resolveTurretHit(projectile, players) {
        if (projectile?.ignoresTurrets) return false;
        const turrets = this.system?.getTurrets?.() || [];
        for (const turret of turrets) {
            if (
                !isDestructibleTurret(turret)
                || turret.hp <= 0
                || turret.ownerPlayer === projectile.owner
                || (turret.deployed && turret.ownerIndex === projectile.owner?.index)
                || (projectile.sourceTurretId && turret.id === projectile.sourceTurretId)
                || !turret.position
            ) continue;
            if (!this._isProjectileSweepTouchingTarget(projectile, turret)) continue;
            this.detonateProjectile(projectile);
            const damage = isRocketTierType(projectile.type)
                ? resolveRocketTierDamage(projectile.type, this.system)
                : 1;
            turret.takeDamage?.(damage, {
                sourcePlayer: projectile.owner || null,
                cause: projectile.type || 'PROJECTILE',
            });
            if (isRocketTierType(projectile.type)) {
                this._applyRocketExplosion(projectile, players, null);
            }
            return true;
        }
        return false;
    }

    /**
     * Books a rocket impact on destructible map geometry. The arena collision result is one
     * reused object, so the mesh name is read before anything else queries the arena again.
     * A foam bounce is not an impact and non-rocket projectiles never damage the map.
     *
     * Environment projectiles - the fire of a static turret - are excluded, exactly as they are
     * from the rocket explosion. The map must only fall to what a player shot at it.
     */
    _applyDestructibleMapHit(projectile, simulationResult) {
        const sourceName = simulationResult?.arenaCollision?.sourceName || '';
        if (!sourceName || projectile?.environmentProjectile === true) return null;
        if (!isRocketTierType(projectile?.type)) return null;
        const destructibles = this.system?.getMapDestructibleSystem?.();
        if (typeof destructibles?.applyMeshHit !== 'function') return null;
        // atan2 only reads the direction, so the unnormalized velocity is enough.
        return destructibles.applyMeshHit(
            sourceName,
            resolveRocketTierDamage(projectile.type, this.system),
            {
                // Where the rocket stopped tells the four identically named legs apart.
                hitPoint: projectile.position || null,
                hitDirection: projectile.velocity || null,
                sourcePlayer: projectile.owner || null,
                cause: projectile.type || 'ROCKET',
            },
        );
    }

    resolveProjectileOutcome(projectile, players, trailSpatialIndex, simulationResult) {
        if (!projectile || !simulationResult) return false;

        const projectileExpired = !!simulationResult.projectileExpired;
        const projectileHitArena = !!simulationResult.projectileHitArena;
        const bouncedOnFoam = !!simulationResult.bouncedOnFoam;

        if (projectileExpired || (projectileHitArena && !bouncedOnFoam)) {
            if (projectileHitArena && !bouncedOnFoam) {
                this._applyDestructibleMapHit(projectile, simulationResult);
            }
            if (!this.detonateProjectile(projectile)) {
                this.system?.onProjectileHit?.(projectile.position, 0xffff00, projectile.owner, projectile);
            }
            return true;
        }

        if (bouncedOnFoam) {
            return false;
        }

        const trailHit = projectile.ignoresTrails ? null : this._resolveTrailHit(projectile, trailSpatialIndex);
        if (trailHit) {
            if (this._tmpVec) {
                if (trailHit.closestPoint) {
                    this._tmpVec.set(
                        trailHit.closestPoint.closestX,
                        trailHit.closestPoint.closestY,
                        trailHit.closestPoint.closestZ
                    );
                } else {
                    this._tmpVec.copy(projectile.position);
                }
                this.system?.onTrailSegmentHit?.(this._tmpVec, projectile.owner, projectile, trailHit);
            } else {
                this.system?.onTrailSegmentHit?.(projectile.position, projectile.owner, projectile, trailHit);
            }
            this.detonateProjectile(projectile, this._tmpVec || projectile.position);

            // Trail-overflow damage is disabled for rockets to keep trail impacts
            // isolated from direct HP damage in hunt lock-on scenarios.
            const allowOverflowDamage = !isRocketTierType(projectile.type);
            if (allowOverflowDamage && trailHit.overflowDamage > 0 && trailHit.entry) {
                const trailOwnerIndex = trailHit.entry.playerIndex;
                const trailOwner = (players || []).find(
                    p => p && p.alive && Number(p.index) === trailOwnerIndex
                );
                if (trailOwner && trailOwner !== projectile.owner) {
                    const damageResult = trailOwner.takeDamage(trailHit.overflowDamage);
                    this.system?.onProjectileDamage?.(
                        trailOwner, projectile.owner, projectile.type, damageResult, projectile
                    );
                }
            }

            return true;
        }

        // A4 puts trails ahead of the intercept: a defence rocket that runs into a trail
        // dies there. Ahead of turrets and players, because an intercept damages nothing.
        if (resolveInterceptHit(this.system, projectile, this)) {
            return true;
        }

        if (this._resolveTurretHit(projectile, players)) {
            return true;
        }

        let hit = false;
        for (const target of players || []) {
            if (!target.alive || target === projectile.owner) continue;
            if (damagesOnContact(projectile) && isSpawnProtected(target)) continue;
            if (projectile.environmentProjectile && Number(target.index) !== projectile.targetPlayerIndex) continue;
            if (projectile.owner?.staticTurret === true && projectile.owner.targetPlayers !== 'all' && target.isBot === true) continue;
            if (projectile.turretTargeting && !isTurretTargetPlayerEligible(target, projectile.owner, projectile.turretTargeting.targetPlayers)) continue;

            hit = this._isProjectileSweepTouchingTarget(projectile, target);

            if (!hit) continue;
            this.detonateProjectile(projectile);

            if (projectile.environmentProjectile) {
                this.system?.applyEnvironmentDamage?.(target, projectile);
                break;
            }

            const huntRocketHit = isRocketTierType(projectile.type)
                && (isHuntHealthActive(resolveEntityRuntimeConfig(this.system)) || projectile.type === 'ROCKET_GUIDED');
            if (huntRocketHit) {
                const damage = resolveEndlessProjectileDamage(
                    projectile.owner,
                    resolveRocketTierDamage(projectile.type, this.system)
                );
                const damageResult = target.takeDamage(damage);
                this.system?.onProjectilePowerup?.(target, projectile);
                this.system?.onProjectileDamage?.(target, projectile.owner, projectile.type, damageResult, projectile);
                this._applyRocketExplosion(projectile, players, target);
            } else if (target.hasShield) {
                target.hasShield = false;
            } else if (projectile.type === 'SWAP' && projectile.owner?.position) {
                this._tmpVec.copy(target.position);
                target.position.copy(projectile.owner.position);
                projectile.owner.position.copy(this._tmpVec);
                target.trail?.forceGap?.(0.3);
                projectile.owner.trail?.forceGap?.(0.3);
                target.refreshObbCollisionQuery?.();
                projectile.owner.refreshObbCollisionQuery?.();
                this.system?.onProjectilePowerup?.(target, projectile);
            } else if (projectile.type === 'MINE') {
                const damage = resolveEndlessProjectileDamage(
                    projectile.owner,
                    Math.max(1, Number(getPickupDefinition('MINE')?.damage) || 25)
                );
                const damageResult = target.takeDamage(damage);
                this.system?.onProjectileDamage?.(target, projectile.owner, projectile.type, damageResult, projectile);
            } else {
                target.applyPowerup(projectile.type, {
                    sourcePlayerIndex: Number.isInteger(projectile.owner?.index)
                        ? projectile.owner.index
                        : null,
                });
                this.system?.onProjectilePowerup?.(target, projectile);
            }
            break;
        }

        return hit;
    }
}

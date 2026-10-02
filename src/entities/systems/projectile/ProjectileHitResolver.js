import { isDestructibleTurret, isTurretTargetPlayerEligible } from '../../../shared/contracts/TurretCombatContract.js';
import { HUNT_CONFIG } from '../../../hunt/HuntConfig.js';
import { isHuntHealthActive } from '../../../hunt/HealthSystem.js';
import { isRocketTierType, resolveRocketTierDamage } from '../../../hunt/RocketPickupSystem.js';
import { applyTrailDamageFromProjectile } from '../../../hunt/DestructibleTrail.js';
import { applyExplosionKnockback } from '../ExplosionKnockbackOps.js';
import { resolveInterceptHit } from './RocketInterceptOps.js';
import { segmentHitsArcadePartBoxes, sphereHitsArcadePartBoxes } from '../../player/ArcadePartHitboxOps.js';
import { canDamage, TEAM_WEAPON_KINDS } from '../../../shared/contracts/TeamCombatContract.js';

// Der Spawnschutz aus dem RespawnSystem (INVULNERABILITY_SECONDS) macht einen frisch
// eingesetzten Spieler unangreifbar - Spur, Wand, Crash, Hazard und Turret halten sich
// daran, also duerfen Raketen, ihre Druckwelle und Minen ihn auch nicht treffen.
function isSpawnProtected(player) {
    return (Number(player?.spawnProtectionTimer) || 0) > 0;
}

function damagesOnContact(projectile) {
    return isRocketTierType(projectile?.type) || projectile?.type === 'MINE';
}

function resolveProjectileWeaponKind(projectile) {
    return isRocketTierType(projectile?.type) || projectile?.type === 'MINE'
        ? TEAM_WEAPON_KINDS.ROCKET
        : TEAM_WEAPON_KINDS.ITEM_PROJECTILE;
}

function resolveEndlessProjectileDamage(owner, damage) {
    const multiplier = owner?.isBot
        ? (Number.isFinite(Number(owner.arenaWavesDamageMultiplier))
            ? Math.max(0, Math.min(3, Number(owner.arenaWavesDamageMultiplier)))
            : Math.max(0, Math.min(1.5, Number(owner.endlessDamageMultiplier) || 1)))
        : 1;
    return damage * multiplier;
}

// Paket 2a: the Arcade nose size raises the rocket damage of its owner (direct hit, blast,
// turret, map). The field is only set in normal Arcade runs and is 1 for bots there.
function resolveRocketDamage(projectile, system) {
    const factor = Number(projectile?.owner?.arcadeDamageMultiplier);
    return resolveRocketTierDamage(projectile.type, system) * (Number.isFinite(factor) && factor > 0 ? factor : 1);
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
        this.system?.onProjectileHit?.(
            position,
            Number.isFinite(Number(projectile.cosmeticColor)) ? Number(projectile.cosmeticColor) : color,
            projectile.owner,
            projectile
        );
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
        // Arcade part hitbox: the boxes decide alone, no sphere fallback around the ship.
        if (target.arcadeHitbox) return sphereHitsArcadePartBoxes(target, point, Number(projectile.radius) || 0);
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
        if (target.arcadeHitbox) {
            // Exact segment test: thin wings cannot slip between two sweep samples.
            const t = segmentHitsArcadePartBoxes(target, previousPosition, projectile.position, Number(projectile.radius) || 0);
            if (t < 0) return false;
            projectile.position.lerpVectors(previousPosition, projectile.position, t);
            projectile.mesh?.position.copy(projectile.position);
            return true;
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

    _resolveBomberBombPlayerContact(projectile, player) {
        if (player.arcadeHitbox) {
            return segmentHitsArcadePartBoxes(
                player, projectile.previousPosition, projectile.position, projectile.radius,
            );
        }
        const start = projectile.previousPosition;
        const segment = this.system?._tmpVec;
        const targetOffset = this.system?._tmpVec2;
        if (!start || !segment) return this._isProjectileTouchingTarget(projectile, player, projectile.position) ? 1 : -1;
        segment.subVectors(projectile.position, start);
        const lengthSq = segment.lengthSq();
        targetOffset.subVectors(start, player.position);
        const radius = (Number(player.hitboxRadius) || 0) + projectile.radius;
        const c = targetOffset.lengthSq() - radius * radius;
        if (c <= 0) return 0;
        if (lengthSq <= 0.000001) return -1;
        const b = targetOffset.dot(segment);
        const discriminant = b * b - lengthSq * c;
        if (discriminant < 0) return -1;
        const t = (-b - Math.sqrt(discriminant)) / lengthSq;
        return t >= 0 && t <= 1 ? t : -1;
    }

    _detonateBomberBomb(projectile, players) {
        if (projectile.detonated) return true;
        projectile.detonated = true;
        const owner = projectile.owner;
        const radius = Math.max(0.1, Number(projectile.blastRadius) || 15);
        const radiusSq = radius * radius;
        const arena = this.system?.getArena?.();
        for (const target of players || []) {
            if (!target?.alive || !target.position || target === owner
                || isSpawnProtected(target)
                || !canDamage(owner, target, TEAM_WEAPON_KINDS.ITEM_PROJECTILE)) continue;
            const dx = target.position.x - projectile.position.x;
            const dy = target.position.y - projectile.position.y;
            const dz = target.position.z - projectile.position.z;
            const distanceSq = dx * dx + dy * dy + dz * dz;
            if (distanceSq > radiusSq) continue;
            const distance = Math.sqrt(distanceSq);
            if (distance > 0.001 && typeof arena?.raycast === 'function') {
                this._tmpVec.set(dx / distance, dy / distance, dz / distance);
                const blocker = arena.raycast(projectile.position, this._tmpVec, distance);
                if (blocker?.hit && Number(blocker.distance) < distance - 0.0001) continue;
            }
            const damage = Math.max(1, Number(projectile.blastDamage) || 50);
            const damageResult = target.takeDamage?.(damage);
            this.system?.onProjectileDamage?.(target, owner, projectile.type, damageResult, projectile);
        }
        this.system?.onProjectileHit?.(projectile.position, 0xffb347, owner, projectile);
        return true;
    }

    _applyRocketExplosion(projectile, players, directHitTarget) {
        if (projectile?.environmentProjectile) return;
        const rocketConfig = resolveEntityRuntimeConfig(this.system)?.HUNT?.ROCKET || HUNT_CONFIG.ROCKET;
        const explosionRadius = Math.max(1, Number(rocketConfig?.EXPLOSION_RADIUS || 25));
        const explosionDamageFalloff = Math.max(0, Math.min(1, Number(rocketConfig?.EXPLOSION_DAMAGE_FALLOFF || 0.5)));
        const baseDamage = resolveRocketDamage(projectile, this.system);
        const damageAtCenter = baseDamage * (1 + explosionDamageFalloff);

        for (const target of players || []) {
            if (!target.alive || target === projectile.owner || target === directHitTarget) continue;
            if (!canDamage(projectile.owner, target, TEAM_WEAPON_KINDS.ROCKET)) continue;
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
                || !canDamage(projectile.owner, turret, resolveProjectileWeaponKind(projectile))
                || (turret.deployed && turret.ownerIndex === projectile.owner?.index)
                || (projectile.sourceTurretId && turret.id === projectile.sourceTurretId)
                || !turret.position
            ) continue;
            if (!this._isProjectileSweepTouchingTarget(projectile, turret)) continue;
            this.detonateProjectile(projectile);
            const damage = isRocketTierType(projectile.type)
                ? resolveRocketDamage(projectile, this.system)
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
        const arena = this.system?.getArena?.();
        if (arena?.releaseDandelionSeed?.(sourceName, projectile.velocity)) return { applied: true, seed: sourceName };
        if (!isRocketTierType(projectile?.type)) return null;
        const destructibles = this.system?.getMapDestructibleSystem?.();
        if (typeof destructibles?.applyMeshHit !== 'function') return null;
        // atan2 only reads the direction, so the unnormalized velocity is enough.
        return destructibles.applyMeshHit(
            sourceName,
            resolveRocketDamage(projectile, this.system),
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

        if (projectile.type === 'BOMBER_BOMB') {
            let contactFraction = Infinity;
            for (const target of players || []) {
                if (!target?.alive || target === projectile.owner || isSpawnProtected(target)
                    || !canDamage(projectile.owner, target, TEAM_WEAPON_KINDS.ITEM_PROJECTILE)) continue;
                const candidateFraction = this._resolveBomberBombPlayerContact(projectile, target);
                if (candidateFraction < 0 || candidateFraction >= contactFraction) continue;
                contactFraction = candidateFraction;
            }
            if (contactFraction < Infinity) {
                projectile.position.lerpVectors(projectile.previousPosition, projectile.position, contactFraction);
                projectile.mesh?.position.copy(projectile.position);
                return this._detonateBomberBomb(projectile, players);
            }
            if (simulationResult.projectileHitArena) {
                return this._detonateBomberBomb(projectile, players);
            }
            if (simulationResult.projectileExpired) return true;
            return false;
        }

        if (projectile.type === 'HYDRA_FIREBALL') {
            if (simulationResult.projectileExpired || simulationResult.projectileHitArena) {
                this.system?.onProjectileHit?.(projectile.position, 0xff6b21, projectile.owner, projectile);
                return true;
            }
            for (const player of players || []) {
                if (!player?.alive || isSpawnProtected(player)) continue;
                if (!this._isProjectileSweepTouchingTarget(projectile, player)) continue;
                const result = player.takeDamage?.(24);
                this.system?.onProjectileDamage?.(player, projectile.owner, projectile.type, result, projectile);
                this.system?.onProjectileHit?.(projectile.position, 0xff6b21, projectile.owner, projectile);
                return true;
            }
            return false;
        }

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
            if (!canDamage(projectile.owner, target, resolveProjectileWeaponKind(projectile))) continue;
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
                    resolveRocketDamage(projectile, this.system)
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

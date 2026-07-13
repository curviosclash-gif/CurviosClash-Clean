import * as THREE from 'three';
import { ProjectileSystem } from '../systems/ProjectileSystem.js';
import { TrailSpatialIndex } from '../systems/TrailSpatialIndex.js';
import { SpawnPlacementSystem } from '../systems/SpawnPlacementSystem.js';
import { CollisionResponseSystem } from '../systems/CollisionResponseSystem.js';
import { EntityRuntimeContext } from './EntityRuntimeContext.js';
import { EntityEventBus } from './EntityEventBus.js';
import { HuntScoring } from '../../hunt/HuntScoring.js';
import { isRocketTierType } from '../../hunt/RocketPickupSystem.js';

function formatFeedDamageSuffix(damageResult = {}) {
    const applied = Math.max(0, Number(damageResult?.applied) || 0);
    const absorbedByShield = Math.max(0, Number(damageResult?.absorbedByShield) || 0);
    const hpApplied = Math.max(0, Number(damageResult?.hpApplied) || (applied - absorbedByShield));
    if (hpApplied > 0 && absorbedByShield > 0) {
        return `-${Math.round(hpApplied)} HP / -${Math.round(absorbedByShield)} Schild`;
    }
    if (hpApplied > 0) {
        return `-${Math.round(hpApplied)} HP`;
    }
    if (absorbedByShield > 0) {
        return `-${Math.round(absorbedByShield)} Schild`;
    }
    return 'TREFFER';
}

export function createEntityRuntimeSupport(owner) {
    let eventBus = null;
    const projectileSystem = new ProjectileSystem({
        renderer: owner.renderer,
        entityRuntimeConfig: owner.entityRuntimeConfig,
        getArena: () => owner.arena,
        getPlayers: () => owner.players,
        getStrategy: () => owner.gameModeStrategy || null,
        peekInventoryItem: (player, preferredIndex, action) => owner._peekInventoryItem(player, preferredIndex, action),
        takeInventoryItem: (player, preferredIndex, action) => owner._takeInventoryItem(player, preferredIndex, action),
        resolveLockOn: (player) => owner._checkLockOn(player),
        getTrailSpatialIndex: () => owner._trailSpatialIndex,
        onShoot: (player, type) => {
            if (!owner.audio || player?.isBot) return;
            owner.audio.play(isRocketTierType(type) ? 'ROCKET_SHOOT' : 'SHOOT');
        },
        onProjectileHit: (position, color, projectileOwner, projectile) => {
            if (isRocketTierType(projectile?.type)) {
                if (owner.particles) owner.particles.spawnRocketImpact(position, projectile?.type, color);
                if (owner.audio && !projectileOwner?.isBot) owner.audio.play('ROCKET_IMPACT');
                return;
            }
            if (owner.particles) owner.particles.spawnHit(position, color);
            if (owner.audio && !projectileOwner?.isBot) owner.audio.play('HIT');
        },
        onTrailSegmentHit: (position, projectileOwner, projectile, trailHit) => {
            const isDestroyed = !!trailHit?.destroyed;
            const color = isDestroyed ? 0x66ddff : 0x3388ff;
            if (owner.particles) {
                if (isRocketTierType(projectile?.type)) {
                    owner.particles.spawnRocketImpact(position, projectile?.type);
                    // Spawn explosion particles along all destroyed trail segments
                    if (trailHit?.explosionPoints?.length > 0) {
                        owner.particles.spawnTrailExplosion(trailHit.explosionPoints);
                    }
                } else {
                    owner.particles.spawnTrailImpact(position, color, { destroyed: isDestroyed });
                }
            }
            if (owner.audio && !projectileOwner?.isBot) {
                owner.audio.play(isRocketTierType(projectile?.type) ? 'ROCKET_IMPACT' : 'HIT');
            }
        },
        onProjectilePowerup: (target, projectile) => {
            if (isRocketTierType(projectile?.type)) {
                if (owner.particles) owner.particles.spawnRocketImpact(target.position, projectile?.type);
                if (owner.audio && !projectile?.owner?.isBot) owner.audio.play('ROCKET_IMPACT');
                return;
            }
            if (owner.particles) owner.particles.spawnExplosion(target.position, 0xff0000);
            if (owner.audio) owner.audio.play('POWERUP');
        },
        onProjectileDamage: (target, projectileOwner, type, damageResult, projectile) => {
            owner._emitHuntDamageEvent({
                target,
                sourcePlayer: projectileOwner || null,
                cause: type || 'PROJECTILE',
                damageResult,
                projectileType: type || null,
                impactPoint: projectile?.position || target?.position || null,
            });
            if (damageResult?.isDead) {
                owner._killPlayer(target, 'PROJECTILE', { killer: projectileOwner || null });
            }
            if (damageResult?.isDead && projectileOwner) {
                const attackerLabel = projectileOwner.isBot ? `Bot ${projectileOwner.index + 1}` : `P${projectileOwner.index + 1}`;
                const targetLabel = target.isBot ? `Bot ${target.index + 1}` : `P${target.index + 1}`;
                eventBus?.emitHuntFeed(`${attackerLabel} -> ${targetLabel}: ELIMINATED`);
            }
            if (!damageResult?.isDead && projectileOwner) {
                const attackerLabel = projectileOwner.isBot ? `Bot ${projectileOwner.index + 1}` : `P${projectileOwner.index + 1}`;
                const targetLabel = target.isBot ? `Bot ${target.index + 1}` : `P${target.index + 1}`;
                eventBus?.emitHuntFeed(`${attackerLabel} -> ${targetLabel}: ${formatFeedDamageSuffix(damageResult)}`);
            }
        },
        runtimeProfiler: owner.runtimeProfiler || null,
    });

    const huntScoring = new HuntScoring();
    eventBus = new EntityEventBus({
        onPlayerFeedback: (player, message) => {
            if (typeof owner.onPlayerFeedback === 'function') owner.onPlayerFeedback(player, message);
        },
        onHuntDamageEvent: (event) => {
            if (typeof owner.onHuntDamageEvent === 'function') owner.onHuntDamageEvent(event || null);
        },
        onHuntFeedEvent: (message) => {
            if (typeof owner.onHuntFeedEvent === 'function') owner.onHuntFeedEvent(message);
        },
        onPlayerDied: (player, cause) => {
            if (typeof owner.onPlayerDied === 'function') owner.onPlayerDied(player, cause);
        },
        onRoundEnd: (winner, outcome = null) => {
            if (typeof owner.onRoundEnd === 'function') owner.onRoundEnd(winner, outcome);
        },
    });

    const tempVectors = {
        primary: new THREE.Vector3(),
        secondary: new THREE.Vector3(),
        direction: new THREE.Vector3(),
        alternateDirection: new THREE.Vector3(),
        cameraAnchor: new THREE.Vector3(),
        cameraRenderPosition: new THREE.Vector3(),
        collisionNormal: new THREE.Vector3(),
        previousPlayerPosition: new THREE.Vector3(),
    };
    const tempQuaternion = new THREE.Quaternion();
    const fallbackArenaCollision = { hit: true, kind: 'wall', isWall: true, normal: null };
    const lockOnCache = new Map();
    const trailSpatialIndex = new TrailSpatialIndex({
        getPlayers: () => owner.players,
        gridSize: 10,
    });

    let collisionResponseSystem = null;
    const spawnPlacementSystem = new SpawnPlacementSystem(owner, {
        isBotPositionSafe: (player, position) => (
            collisionResponseSystem
                ? collisionResponseSystem.isBotPositionSafe(player, position)
                : true
        ),
    });
    collisionResponseSystem = new CollisionResponseSystem(owner, spawnPlacementSystem);

    const runtimeContext = new EntityRuntimeContext({
        players: owner.players,
        arena: owner.arena,
        tempVectors: {
            primary: tempVectors.primary,
            secondary: tempVectors.secondary,
            direction: tempVectors.direction,
            previousPlayerPosition: tempVectors.previousPlayerPosition,
        },
        cache: {
            lockOn: lockOnCache,
        },
        services: {
            particles: owner.particles,
            audio: owner.audio,
            recorder: owner.recorder,
            runtimeProfiler: owner.runtimeProfiler || null,
            entityRuntimeConfig: owner.entityRuntimeConfig,
        },
        callbacks: {
            getStrategy: () => owner.gameModeStrategy || null,
            combat: {
                shootItemProjectile: (player, preferredIndex = -1) => projectileSystem.shootItemProjectile(player, preferredIndex),
                shootHuntGun: (player) => owner._overheatGunSystem.tryFire(player),
                resetRespawnCombatState: (player) => owner._overheatGunSystem.resetPlayer(player?.index),
            },
            spawn: {
                getPlanarSpawnLevel: () => owner._getPlanarSpawnLevel(),
                findSpawnPosition: (minDistance = 12, margin = 12, planarLevel = null) => owner._findSpawnPosition(minDistance, margin, planarLevel),
                findSafeSpawnDirection: (position, radius = 0.8) => owner._findSafeSpawnDirection(position, radius),
            },
            lifecycle: {
                killPlayer: (player, cause = 'UNKNOWN', options = {}) => owner._killPlayer(player, cause, options),
            },
            trails: {
                getTrailSpatialIndex: () => trailSpatialIndex,
            },
            parcours: {
                onPlayerSpawn: (player, options = {}) => owner._parcoursProgressSystem?.onPlayerSpawn?.(player, options),
                onPlayerDeath: (player, options = {}) => owner._parcoursProgressSystem?.onPlayerDeath?.(player, options),
            },
        },
        events: {
            emitHuntDamageEvent: (event) => owner._emitHuntDamageEvent(event || null),
            emitHuntFeed: (message) => eventBus?.emitHuntFeed(message),
        },
    });

    return {
        projectileSystem,
        huntScoring,
        eventBus,
        tempVectors,
        tempQuaternion,
        fallbackArenaCollision,
        lockOnCache,
        trailSpatialIndex,
        spawnPlacementSystem,
        collisionResponseSystem,
        runtimeContext,
    };
}

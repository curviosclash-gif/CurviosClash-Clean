import * as THREE from 'three';
import { ProjectileSystem } from '../systems/ProjectileSystem.js';
import { TrailSpatialIndex } from '../systems/TrailSpatialIndex.js';
import { SpawnPlacementSystem } from '../systems/SpawnPlacementSystem.js';
import { CollisionResponseSystem } from '../systems/CollisionResponseSystem.js';
import { EntityRuntimeContext } from './EntityRuntimeContext.js';
import { EntityEventBus } from './EntityEventBus.js';
import { HuntScoring } from '../../hunt/HuntScoring.js';
import { isRocketTierType } from '../../hunt/RocketPickupSystem.js';
import {
    GAMEPLAY_ACTION_RESULT_CODES,
    buildGameplayActionResult,
    encodeGameplayActionResultForLog,
} from '../../shared/contracts/GameplayActionResultContract.js';

export function createEntityRuntimeSupport(owner) {
    let eventBus = null;
    const projectileSystem = new ProjectileSystem({
        renderer: owner.renderer,
        entityRuntimeConfig: owner.entityRuntimeConfig,
        getArena: () => owner.arena,
        getPlayers: () => owner.players,
        getTurrets: () => owner._staticTurretSystem?.getDestructibleTargets?.() || [],
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
                    // Spawn explosion particles along all destroyed trail segments
                    if (trailHit?.explosionPoints?.length > 0) {
                        owner.particles.spawnTrailExplosion(trailHit.explosionPoints);
                    }
                } else {
                    owner.particles.spawnTrailImpact(position, color, { destroyed: isDestroyed });
                }
            }
            if (owner.audio && !projectileOwner?.isBot) {
                if (!isRocketTierType(projectile?.type)) owner.audio.play('HIT');
            }
        },
        onProjectilePowerup: (target, projectile) => {
            if (isRocketTierType(projectile?.type)) return;
            owner.recorder?.logEvent?.('ITEM_HIT', projectile?.owner?.index ?? -1, encodeGameplayActionResultForLog(
                buildGameplayActionResult({
                    ok: true,
                    code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_HIT_SUCCESS,
                    mode: 'hit',
                    type: projectile?.type,
                })
            ));
            if (owner.particles) owner.particles.spawnExplosion(target.position, 0xff0000);
            if (owner.audio) owner.audio.play('POWERUP');
        },
        onProjectileDamage: (target, projectileOwner, type, damageResult, projectile) => {
            owner.recorder?.logEvent?.('ITEM_HIT', projectileOwner?.index ?? -1, encodeGameplayActionResultForLog(
                buildGameplayActionResult({
                    ok: true,
                    code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_HIT_SUCCESS,
                    mode: 'hit',
                    type,
                })
            ));
            owner._emitHuntDamageEvent({
                target,
                sourcePlayer: projectileOwner || null,
                cause: type || 'PROJECTILE',
                damageResult,
                projectileType: type || null,
                impactPoint: projectile?.position || target?.position || null,
            });
            if (damageResult?.isDead) {
                owner._killPlayer(target, 'PROJECTILE', {
                    killer: projectileOwner || null,
                    impactPoint: projectile?.position || target?.position || null,
                    projectileType: type || projectile?.type || null,
                });
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
            getSimulationNowMs: () => Math.max(0, Number(owner._simulationClockMs) || 0),
            combat: {
                shootItemProjectile: (player, preferredIndex = -1) => projectileSystem.shootItemProjectile(player, preferredIndex),
                shootHuntGun: (player) => owner._overheatGunSystem.tryFire(player),
                deployMgTurret: (player) => owner._staticTurretSystem?.deployForPlayer?.(player) || null,
                getMgTurretTargets: () => owner._staticTurretSystem?.getDestructibleTargets?.() || [],
                damageMgTurret: (turret, amount, options = {}) => (
                    owner._staticTurretSystem?.damageTurret?.(turret, amount, options) || null
                ),
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
                isRespawnEnabled: () => owner._parcoursProgressSystem?.isRespawnEnabled?.() === true,
                takeRespawnPlan: (player) => owner._parcoursProgressSystem?.takeRespawnPlan?.(player) || null,
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

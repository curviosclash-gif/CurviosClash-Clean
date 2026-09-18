import * as THREE from 'three';
import { ProjectileSystem } from '../systems/ProjectileSystem.js';
import { TrailSpatialIndex } from '../systems/TrailSpatialIndex.js';
import { SpawnPlacementSystem } from '../systems/SpawnPlacementSystem.js';
import { CollisionResponseSystem } from '../systems/CollisionResponseSystem.js';
import { EntityRuntimeContext } from './EntityRuntimeContext.js';
import { EntityEventBus } from './EntityEventBus.js';
import { resolveWorldAudioOptions } from '../audio/WorldAudioOptions.js';
import { HuntScoring } from '../../hunt/HuntScoring.js';
import { isRocketTierType, resolveRocketTierDamage } from '../../hunt/RocketPickupSystem.js';
import {
    GAMEPLAY_ACTION_RESULT_CODES,
    buildGameplayActionResult,
    encodeGameplayActionResultForLog,
} from '../../shared/contracts/GameplayActionResultContract.js';

export function applyEnvironmentProjectileDamage(owner, target, projectile) {
    if (!target?.alive) return null;
    if (target.hasShield === true || Number(target.shieldHP) > 0) {
        target.hasShield = false;
        target.shieldHP = 0;
        owner.audio?.play?.('SHIELD_HIT', { intensity: 0.75, depleted: true });
        owner.particles?.spawnHit?.(target.position, target.color);
        return { applied: 0, absorbedByShield: 1, remainingHp: target.hp, isDead: false };
    }
    const damage = resolveRocketTierDamage(projectile?.type, owner);
    return owner._applyModeDamage(target, damage, 'EXCLUSION_ZONE', {
        impactPoint: projectile?.position || target.position,
        nowSeconds: Math.max(0, Number(owner._simulationClockMs) || 0) * 0.001,
    });
}

/**
 * S2.3: a rocket shot down by a defence rocket is credited to the defender.
 *
 * Static turrets fire rockets too and carry index -1, so only a real player slot is
 * counted. A mode without hunt scoring (plain CLASSIC) simply counts nothing. The
 * position belongs to a pooled projectile state that is recycled right after this
 * call, so it is only read here and never kept.
 */
export function handleRocketIntercept(owner, event) {
    const defender = event?.defender || null;
    const defenderIndex = Number(defender?.index);
    if (!defender || defender.staticTurret === true || !Number.isInteger(defenderIndex) || defenderIndex < 0) return;
    owner?._huntScoring?.registerIntercept?.(defenderIndex);
    // The endless parcours pays its run xp per event (like a kill), and only to a human.
    if (defender.isBot !== true) owner?.endlessParcoursRuntime?.collectRunXp?.('intercept', 1);
    owner?.recorder?.logEvent?.(
        'ROCKET_INTERCEPT',
        defenderIndex,
        String(event?.target?.type || ''),
        event?.position || null
    );
}

export function createEntityRuntimeSupport(owner) {
    let eventBus = null;
    const projectileSystem = new ProjectileSystem({
        renderer: owner.renderer,
        entityRuntimeConfig: owner.entityRuntimeConfig,
        getArena: () => owner.arena,
        getPlayers: () => owner.players,
        getTurrets: () => owner._targetableRegistry?.collect?.() || [],
        getStrategy: () => owner.gameModeStrategy || null,
        peekInventoryItem: (player, preferredIndex, action) => owner._peekInventoryItem(player, preferredIndex, action),
        takeInventoryItem: (player, preferredIndex, action) => owner._takeInventoryItem(player, preferredIndex, action),
        resolveLockOn: (player, profile) => (profile === 'item'
            ? owner._huntCombatSystem.checkItemLockOn(player)
            : owner._checkLockOn(player)),
        getTrailSpatialIndex: () => owner._trailSpatialIndex,
        onShoot: (player, type) => {
            if (!owner.audio || player?.isBot) return;
            owner.audio.play(isRocketTierType(type) ? 'ROCKET_SHOOT' : 'SHOOT');
        },
        onProjectileHit: (position, color, projectileOwner, projectile) => {
            if (isRocketTierType(projectile?.type)) {
                if (owner.particles) owner.particles.spawnRocketImpact(position, projectile?.type, color);
                owner.audio?.play?.(
                    'ROCKET_IMPACT',
                    resolveWorldAudioOptions(owner, position)
                );
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
            if (owner.particles) owner.particles.spawnExplosion(target.position, 0xff0000, { blast: 'ITEM_BURST' });
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
                    killer: projectileOwner?.staticTurret ? null : projectileOwner || null,
                    impactPoint: projectile?.position || target?.position || null,
                    projectileType: type || projectile?.type || null,
                });
            }
        },
        applyEnvironmentDamage: (target, projectile) => applyEnvironmentProjectileDamage(owner, target, projectile),
        onRocketIntercepted: (event) => handleRocketIntercept(owner, event),
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
                shootItemProjectile: (player, preferredIndex = -1, rocketOnly = false) => projectileSystem.shootItemProjectile(player, preferredIndex, rocketOnly),
                shootHuntGun: (player) => owner._overheatGunSystem.tryFire(player),
                deployRocketTurret: (player) => owner._staticTurretSystem?.deployForPlayer?.(player, 'rocket') || null,
                deployMgTurret: (player) => owner._staticTurretSystem?.deployForPlayer?.(player) || null,
                getMgTurretTargets: () => owner._targetableRegistry?.collect?.() || [],
                damageMgTurret: (target, amount, options = {}) => target?.takeDamage?.(amount, options) || null,
                resetRespawnCombatState: (player) => owner._overheatGunSystem.resetPlayer(player?.index),
            },
            globalEffects: {
                canActivateFog: () => owner._globalFogEffectSystem?.networkReplica !== true,
                activateFog: () => owner._globalFogEffectSystem?.activate?.() === true,
                canActivateLightning: () => owner._lightningStrikeSystem?.canActivate?.() === true,
                activateLightning: (player) => owner._lightningStrikeSystem?.activate?.(player) === true,
            },
            spawn: {
                getPlanarSpawnLevel: () => owner._getPlanarSpawnLevel(),
                findSpawnPosition: (minDistance = 12, margin = 12, planarLevel = null) => owner._findSpawnPosition(minDistance, margin, planarLevel),
                findSafeSpawnDirection: (position, radius = 0.8, player = null) => owner._findSafeSpawnDirection(position, radius, player),
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

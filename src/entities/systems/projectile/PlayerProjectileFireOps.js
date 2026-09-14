import { isPickupTypeShootable, normalizePickupType } from '../../PickupRegistry.js';
import { ensurePlayerInventoryCollections } from '../../player/PlayerInventoryOps.js';
import { ROCKET_RANGE_MULTIPLIER } from '../../../hunt/RocketPickupSystem.js';
import {
    applyWeaponFanDirection,
    resolveWeaponFanProjectileCount,
} from '../../../hunt/WeaponFanOps.js';
import {
    GAMEPLAY_ACTION_RESULT_CODES,
    buildGameplayActionResult,
} from '../../../shared/contracts/GameplayActionResultContract.js';
import { configureProjectileRange } from './ProjectileStatePool.js';

function failed(code, message, type = null) {
    return buildGameplayActionResult({ ok: false, code, message, type });
}

export function shootPlayerItemProjectile(system, player, preferredIndex = -1, rocketOnly = false) {
    const config = system.entityRuntimeConfig;
    if ((player.shootCooldown || 0) > 0) {
        return failed(
            GAMEPLAY_ACTION_RESULT_CODES.ITEM_SHOOT_COOLDOWN,
            `Schuss bereit in ${player.shootCooldown.toFixed(1)}s`
        );
    }

    const strategy = system.getStrategy();
    const modeType = String(strategy?.getPickupModeType?.() || strategy?.modeType || 'CLASSIC').trim().toUpperCase();
    const { rocketInventory } = ensurePlayerInventoryCollections(player);
    const rocketType = normalizePickupType(rocketInventory[0], { fallback: rocketInventory[0] });
    const itemPreview = rocketOnly
        ? (rocketType
            ? buildGameplayActionResult({ ok: true, code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_SHOOT_SUCCESS, type: rocketType })
            : failed(GAMEPLAY_ACTION_RESULT_CODES.ITEM_SHOOT_EMPTY, 'Keine Rakete verfuegbar'))
        : system.peekInventoryItem(player, preferredIndex, 'shoot');
    if (!itemPreview?.ok) {
        return failed(
            itemPreview?.code || GAMEPLAY_ACTION_RESULT_CODES.ITEM_SHOOT_EMPTY,
            itemPreview?.reason || 'Kein Item verfuegbar',
            itemPreview?.type || null
        );
    }
    if (!isPickupTypeShootable(itemPreview.type, modeType)) {
        return failed(
            GAMEPLAY_ACTION_RESULT_CODES.ITEM_SHOOT_FORBIDDEN,
            'Item kann nicht verschossen werden',
            itemPreview.type
        );
    }

    const type = itemPreview.type;
    const power = config.POWERUP.TYPES[type];
    if (!power) {
        return failed(GAMEPLAY_ACTION_RESULT_CODES.ITEM_SHOOT_INVALID_TYPE, 'Item ungueltig', type);
    }
    const rocketParams = strategy?.resolveRocketProjectileParams(type, config) || null;
    const huntRocket = !!rocketParams;
    const homingEnabled = modeType === 'HUNT';
    const rocketConfig = config?.HUNT?.ROCKET || {};
    const targetingConfig = config?.HUNT?.TARGETING || {};
    const homingMinTurnRate = Math.max(0.000001, Number(rocketConfig.HOMING_MIN_TURN_RATE) || 0.1);
    const homingMinLockOnAngle = Math.max(0.000001, Number(rocketConfig.HOMING_MIN_LOCK_ON_ANGLE) || 5);
    const homingMinRange = Math.max(0.000001, Number(rocketConfig.HOMING_MIN_RANGE) || 10);
    const homingMinReacquireInterval = Math.max(0.000001, Number(rocketConfig.HOMING_MIN_REACQUIRE_INTERVAL) || 0.04);
    const fallbackReacquireInterval = Math.max(
        homingMinReacquireInterval,
        Number(rocketConfig.HOMING_FALLBACK_REACQUIRE_INTERVAL) || 0.2
    );
    const visualScale = huntRocket ? rocketParams.visualScale : 1;
    const collisionRadiusMultiplier = huntRocket ? rocketParams.collisionRadiusMultiplier : 1;
    const baseTurnRate = Math.max(homingMinTurnRate, Number(config?.HOMING?.TURN_RATE || 3));
    const homingTurnRate = huntRocket ? Math.max(baseTurnRate, rocketParams.homingTurnRate) : baseTurnRate;
    const baseLockOnAngle = Math.max(homingMinLockOnAngle, Number(config?.HOMING?.LOCK_ON_ANGLE || 15));
    const homingLockOnAngle = huntRocket ? Math.max(baseLockOnAngle, rocketParams.homingLockOnAngle) : baseLockOnAngle;
    const baseHomingRange = Math.max(homingMinRange, Number(config?.HOMING?.MAX_LOCK_RANGE || 100));
    const homingRange = huntRocket ? Math.max(baseHomingRange, rocketParams.homingRange) : baseHomingRange;
    const homingReacquireInterval = huntRocket
        ? rocketParams.homingReacquireInterval
        : fallbackReacquireInterval;
    const projectileSpawnOffset = Math.max(
        0.1,
        Number(targetingConfig.PROJECTILE_SPAWN_OFFSET) || Number(targetingConfig.MUZZLE_OFFSET) || 2.2
    );

    player.getAimDirection(system._tmpDir).normalize();
    const projectileCount = resolveWeaponFanProjectileCount(player.activeEffects, modeType);
    system._tmpFanRight.set(1, 0, 0);
    if (player?.quaternion) system._tmpFanRight.applyQuaternion(player.quaternion);
    system._tmpFanAxis.crossVectors(system._tmpDir, system._tmpFanRight);
    if (system._tmpFanAxis.lengthSq() <= 0.000001) system._tmpFanAxis.set(0, 1, 0);
    else system._tmpFanAxis.normalize();
    const lockOnTarget = system.resolveLockOn(player);
    let firstProjectile = null;
    for (let i = 0; i < projectileCount; i += 1) {
        applyWeaponFanDirection(system._tmpDir, system._tmpFanAxis, i, projectileCount, system._tmpFanDirection);
        system._tmpVec.copy(player.position).addScaledVector(system._tmpFanDirection, projectileSpawnOffset);
        const mesh = system._acquireProjectileMesh(type, power.color);
        mesh.scale.setScalar(visualScale);
        mesh.position.copy(system._tmpVec);
        system._tmpVec2.copy(system._tmpVec).add(system._tmpFanDirection);
        mesh.lookAt(system._tmpVec2);

        const projectile = system._acquireProjectileState();
        projectile.mesh = mesh;
        projectile.flame = mesh.userData.flame || null;
        projectile.poolKey = type;
        projectile.owner = player;
        projectile.type = type;
        projectile.huntRocket = huntRocket;
        projectile.homingEnabled = homingEnabled;
        projectile.visualScale = visualScale;
        projectile.position.copy(system._tmpVec);
        projectile.velocity.copy(system._tmpFanDirection).multiplyScalar(config.PROJECTILE.SPEED);
        projectile.radius = config.PROJECTILE.RADIUS * collisionRadiusMultiplier;
        configureProjectileRange(projectile, config.PROJECTILE, huntRocket ? ROCKET_RANGE_MULTIPLIER : 1);
        projectile.traveled = 0;
        projectile.homingTurnRate = homingTurnRate;
        projectile.homingLockOnAngle = homingLockOnAngle;
        projectile.homingRange = homingRange;
        projectile.homingReacquireInterval = homingReacquireInterval;
        projectile.homingReacquireTimer = 0;
        projectile.target = lockOnTarget;
        if (homingEnabled && (!projectile.target || !projectile.target.alive)) {
            projectile.target = system._acquireHomingTarget(
                projectile,
                system.getPlayers(),
                system.getTrailSpatialIndex()
            );
        }
        projectile.foamBounces = 0;
        projectile.foamBounceCooldown = 0;
        system._rocketTrailSystem.initializeProjectile(projectile);
        system.projectiles.push(projectile);
        if (!firstProjectile) firstProjectile = projectile;
    }

    const itemResult = rocketOnly && rocketType
        ? { ok: rocketInventory.shift() === rocketType, type: rocketType }
        : system.takeInventoryItem(player, preferredIndex, 'shoot');
    if (!itemResult.ok) {
        return failed(GAMEPLAY_ACTION_RESULT_CODES.ITEM_SHOOT_EMPTY, 'Kein Item verfuegbar', type);
    }

    player.shootCooldown = config.PROJECTILE.COOLDOWN;
    system.onShoot(player, type, firstProjectile);
    return buildGameplayActionResult({
        ok: true,
        code: GAMEPLAY_ACTION_RESULT_CODES.ITEM_SHOOT_SUCCESS,
        mode: 'shoot',
        type,
        meta: { projectileCount },
    });
}

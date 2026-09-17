// ============================================
// Player.js - player state and orchestration
// ============================================

import * as THREE from 'three';
import { Trail } from './Trail.js';
import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';
import { createGameplayCameraState } from '../shared/contracts/CameraModeContract.js';
import { isValidVehicleId, VEHICLE_DEFINITIONS } from './vehicle-registry.js';
import {
    applyDamage,
    applyHealing,
    resetPlayerHealth,
    updatePlayerHealthRegen,
} from '../hunt/HealthSystem.js';
import {
    applyPlayerPowerup,
    removePlayerEffect,
    updatePlayerEffects,
} from './player/PlayerEffectOps.js';
import {
    addPlayerInventoryItem,
    cyclePlayerInventoryItem,
    dropPlayerInventoryItem,
    usePlayerInventoryItem,
} from './player/PlayerInventoryOps.js';
import {
    initializePlayerHitbox,
    isSphereInPlayerOBB,
    preparePlayerObbCollisionQuery,
    setPlayerLookAtWorld,
    updatePlayerMotion,
} from './player/PlayerMotionOps.js';
import { resetPlayerCharges, resolveMotionClockFactor } from './player/PlayerChargeOps.js';
import { PlayerController } from './player/PlayerController.js';
import { createPlayerView } from './player/createPlayerView.js';
import { applyFourPlayerPlanarPhysicsConstraint } from '../four-player-planar/FourPlayerPlanarPhysics.js';

export class Player {
    constructor(renderer, index, color, isBot = false, options = {}) {
        this.renderer = renderer;
        this.index = index;
        this.color = color;
        this.isBot = isBot;
        this.entityManager = options?.entityManager || null;
        this.entityRuntimeConfig = options?.entityRuntimeConfig || options?.entityManager?.entityRuntimeConfig || null;
        this.gameplayConfig = resolveGameplayConfig(this);
        const gameplayCameraState = createGameplayCameraState(this.gameplayConfig);
        this.alive = true;
        this.score = 0;
        const playerConfig = this.gameplayConfig.PLAYER;

        // Physics
        this.position = new THREE.Vector3();
        this.velocity = new THREE.Vector3(0, 0, -1);
        this.quaternion = new THREE.Quaternion();
        this.speed = playerConfig.SPEED;
        this.baseSpeed = playerConfig.SPEED;
        this.turnSpeed = playerConfig.TURN_SPEED;
        this.rollSpeed = playerConfig.ROLL_SPEED;

        // Reused temp objects
        this._tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
        this._tmpEuler2 = new THREE.Euler(0, 0, 0, 'YXZ');
        this._tmpQuat = new THREE.Quaternion();
        this._tmpVec = new THREE.Vector3();
        this._tmpDir = new THREE.Vector3();
        this._tmpAimRight = new THREE.Vector3();
        this._tmpAimUp = new THREE.Vector3();
        this._tmpMat = new THREE.Matrix4();

        // Boost and slow-motion reserves (see PlayerChargeOps)
        resetPlayerCharges(this, playerConfig);

        // Powerup effects
        this.activeEffects = [];
        this._speedEffectBaseSpeed = null;
        this._pickupShieldOwned = false;
        this.inventory = []; this.rocketInventory = [];
        this.selectedItemIndex = 0;
        this.hasShield = false;
        this.shieldHP = 0;
        this.maxShieldHp = 1;
        this.shieldHitFeedback = 0;
        this.isGhost = false;
        this.hasSlowTime = false;
        this.slowTimeScale = 1;
        this.invertControls = false;
        this.trailGapActive = false;
        this.pickupRadiusMultiplier = 1;
        this.decoyActive = false;
        this.itemActionsDisabled = false;
        this.maxHp = 1;
        this.hp = 1;
        this.lastDamageTimestamp = -Infinity;
        this.itemUseCooldownRemaining = 0;
        this.invertPitchBase = false;
        this.modelScale = playerConfig.MODEL_SCALE || 1;
        this.cockpitCamera = gameplayCameraState.cockpitCamera;
        this.spawnProtectionTimer = 0;
        // Short grace after a bounce so the same wall is not hit again on the next frame.
        // Kept apart from spawnProtectionTimer, which also makes a player immune to damage.
        this.arenaCollisionGraceTimer = 0;
        this.wallDamageCooldown = 0;
        this.crashDamageCooldown = 0;
        this.planarAimOffset = 0;
        this.fightAimAssistTargetIndex = -1;
        this.fightAimAssistLockRemaining = 0;
        this.steeringLockTimer = 0;
        this.currentPlanarY = 0;
        this.controlRampEnabled = false;
        this.controlRampRates = {
            attackRate: 12.0,
            releaseRate: 8.5,
        };
        this.controlProfileId = '';
        this.dynamicActionAdapterEnabled = false;
        this._renderPrevPosition = new THREE.Vector3();
        this._renderPrevQuaternion = new THREE.Quaternion();
        this._renderInterpolationPosition = new THREE.Vector3();
        this._renderInterpolationQuaternion = new THREE.Quaternion();
        this._renderDiscontinuityVersion = 0;

        // Special gate effects
        this.boostPortalTimer = 0;
        this.boostPortalParams = null;
        this.boostPortalDir = new THREE.Vector3();

        this.slingshotTimer = 0;
        this.slingshotParams = null;
        this.slingshotForward = new THREE.Vector3();
        this.slingshotUp = new THREE.Vector3();

        const requestedVehicleId = String(options?.vehicleId || '').trim();
        this.vehicleId = isValidVehicleId(requestedVehicleId)
            ? requestedVehicleId
            : String(playerConfig.DEFAULT_VEHICLE_ID || 'ship5');

        const vehicleDef = VEHICLE_DEFINITIONS.find((v) => v.id === this.vehicleId) || VEHICLE_DEFINITIONS[0];
        const vehicleHitboxRadius = vehicleDef.hitbox?.radius || playerConfig.HITBOX_RADIUS || 0.8;
        this.hitboxRadius = vehicleHitboxRadius * this.modelScale;
        this._trailVisualRearOffsetBase = Math.max(0.6, vehicleHitboxRadius * 1.05);

        // Hitbox state
        this.hitboxBox = new THREE.Box3();
        this.hitboxSize = new THREE.Vector3();
        this.hitboxCenter = new THREE.Vector3();

        this._tmpWorldToLocal = new THREE.Matrix4();
        this._tmpLocalSphere = new THREE.Sphere();
        this._tmpHitboxScale = new THREE.Vector3(1, 1, 1);
        this._shieldBaseScale = new THREE.Vector3(1, 1, 1);
        this._obbCollisionPrepared = false;

        initializePlayerHitbox(this, this.hitboxRadius);

        // View refs (kept on player for compatibility)
        this.group = null;
        this.vehicleMesh = null;
        this.shieldMesh = null;
        this.firstPersonAnchor = null;
        this.flames = [];

        this.cameraMode = gameplayCameraState.cameraModeIndex;

        this.controller = new PlayerController();
        this.controller.setRampRates(this.controlRampRates);
        this.particleSystem = options?.particles || options?.entityManager?.particles || null;
        this.view = createPlayerView(this, renderer);
        this.view.createModel();

        this.trail = new Trail(renderer, color, this.index, options.entityManager);
        this.trail.setVisualRearOffset(this._trailVisualRearOffsetBase * Math.max(0, this.modelScale));
        this._renderPrevPosition.copy(this.position);
        this._renderPrevQuaternion.copy(this.quaternion);
        this._renderInterpolationPosition.copy(this.position);
        this._renderInterpolationQuaternion.copy(this.quaternion);
        resetPlayerHealth(this);
    }

    spawn(position, startDirection = null) {
        const playerConfig = this.gameplayConfig.PLAYER;
        const gameplaySection = this.gameplayConfig.GAMEPLAY;
        this.position.copy(position);
        this.alive = true;
        if (Number.isFinite(this._speedEffectBaseSpeed)) {
            this.baseSpeed = this._speedEffectBaseSpeed;
        }
        this._speedEffectBaseSpeed = null;
        this.speed = this.baseSpeed;
        resetPlayerCharges(this, playerConfig);
        this.activeEffects = [];
        this._pickupShieldOwned = false;
        this.hasShield = false;
        this.isGhost = false;
        this.hasSlowTime = false;
        this.slowTimeScale = 1;
        this.invertControls = false;
        this.trailGapActive = false;
        this.pickupRadiusMultiplier = 1;
        this.decoyActive = false;
        this.itemActionsDisabled = false;
        this.spawnProtectionTimer = playerConfig.SPAWN_PROTECTION || 0;
        this.arenaCollisionGraceTimer = 0;
        this.wallDamageCooldown = 0;
        this.crashDamageCooldown = 0;
        this.planarAimOffset = 0;
        this.fightAimAssistTargetIndex = -1;
        this.fightAimAssistLockRemaining = 0;
        this.steeringLockTimer = 0;
        this.itemUseCooldownRemaining = 0;
        resetPlayerHealth(this);

        const fallbackY = playerConfig.START_Y || 5;
        const spawnY = Number.isFinite(position?.y) ? position.y : fallbackY;
        this.currentPlanarY = gameplaySection.PLANAR_MODE ? spawnY : fallbackY;
        this.controller?.resetAxisState?.();

        this.trail.clear();
        this.trail.resetWidth();
        this.view?.setVisible(true);

        if (startDirection && startDirection.lengthSq() > 0.0001) {
            this._tmpVec.copy(startDirection).normalize();
            this.quaternion.setFromUnitVectors(this._tmpDir.set(0, 0, -1), this._tmpVec);
        } else {
            const roll = this.entityManager?.runtimeRng?.next;
            const angle = (typeof roll === 'function' ? roll() : Math.random()) * Math.PI * 2;
            this._tmpEuler.set(0, angle, 0, 'YXZ');
            this.quaternion.setFromEuler(this._tmpEuler);
        }

        applyFourPlayerPlanarPhysicsConstraint(this);

        this.markRenderDiscontinuity('spawn');
        this._obbCollisionPrepared = false;
        this.view?.syncFromState();
    }

    lockSteering(seconds = 0.2) {
        const duration = Number(seconds);
        if (!Number.isFinite(duration) || duration <= 0) return;
        this.steeringLockTimer = Math.max(this.steeringLockTimer || 0, duration);
    }

    setLookAtWorld(x, y, z) {
        const success = setPlayerLookAtWorld(this, x, y, z);
        if (success) {
            this.view?.syncRotation();
            this._obbCollisionPrepared = false;
        }
        return success;
    }

    update(dt, input, renderFrameId = 0, strategy = null) {
        if (!this.alive) return;
        this._obbCollisionPrepared = false;

        this.spawnProtectionTimer = Math.max(0, this.spawnProtectionTimer - dt);
        this.arenaCollisionGraceTimer = Math.max(0, (this.arenaCollisionGraceTimer || 0) - dt);
        this.wallDamageCooldown = Math.max(0, (this.wallDamageCooldown || 0) - dt);
        this.crashDamageCooldown = Math.max(0, (this.crashDamageCooldown || 0) - dt);
        this.fightAimAssistLockRemaining = Math.max(
            0,
            Number(this.fightAimAssistLockRemaining || 0) - dt
        );
        this.steeringLockTimer = Math.max(0, (this.steeringLockTimer || 0) - dt);
        this.shieldHitFeedback = Math.max(0, (this.shieldHitFeedback || 0) - dt * 3.2);
        this.itemUseCooldownRemaining = Math.max(0, Number(this.itemUseCooldownRemaining || 0) - dt);
        const steeringLocked = this.steeringLockTimer > 0;

        if (!strategy || typeof strategy.updateHealthRegen !== 'function') {
            updatePlayerHealthRegen(this, dt);
        }
        updatePlayerEffects(this, dt);

        // 61.4.1: Apply modifier per-frame effects via strategy
        if (strategy) {
            if (typeof strategy.updateHealthRegen === 'function') {
                strategy.updateHealthRegen(this, dt, this.entityManager);
            }
            if (!this.alive) return;
            if (typeof strategy.applyBoostTick === 'function') {
                strategy.applyBoostTick(this, dt, this.entityManager);
            }
            if (!this.alive) return;
        }

        // Capture vor JEDEM Substep, nicht nur einmal pro Frame.
        // So interpoliert render() immer zwischen den letzten beiden Physics-States
        // statt über N Substeps hinweg (was bei Framedrops zum Ruckeln fuehrt).
        this._renderPrevPosition.copy(this.position);
        this._renderPrevQuaternion.copy(this.quaternion);

        // Bullet time: only this vehicle's steering and travel run on the real clock;
        // every other timer in update() stays on the world clock `dt`.
        const motionDt = dt * resolveMotionClockFactor(this);
        const controlState = this.controller.resolveControlState(this, input, steeringLocked, motionDt);
        // 61.4.1: Thread turn rate multiplier from strategy
        const turnRateMultiplier = (strategy && typeof strategy.getTurnRateMultiplier === 'function')
            ? strategy.getTurnRateMultiplier(this) : 1;
        updatePlayerMotion(this, dt, controlState, turnRateMultiplier, motionDt);
    }

    setControlOptions(options = {}) {
        if (typeof options.invertPitch === 'boolean') {
            this.invertPitchBase = options.invertPitch;
        }
        if (typeof options.modelScale === 'number') {
            this.modelScale = options.modelScale;
            this.trail?.setVisualRearOffset?.(
                this._trailVisualRearOffsetBase * Math.max(0, this.modelScale)
            );
            this.view?.applyModelScale();
        }
        if (typeof options.cockpitCamera === 'boolean') {
            const gameplayCameraState = createGameplayCameraState(this.gameplayConfig);
            this.cockpitCamera = gameplayCameraState.cockpitCamera;
            this.cameraMode = gameplayCameraState.cameraModeIndex;
        }
        if (typeof options.speed === 'number' && Number.isFinite(options.speed) && options.speed > 0) {
            const currentPermanentSpeed = Number.isFinite(this._speedEffectBaseSpeed)
                ? this._speedEffectBaseSpeed
                : this.baseSpeed;
            let strategyMultiplier = 1;
            if (Number.isFinite(this._arcadeBaseSpeed) && this._arcadeBaseSpeed > 0) {
                strategyMultiplier = currentPermanentSpeed / this._arcadeBaseSpeed;
                this._arcadeBaseSpeed = options.speed;
                this._fightBaseSpeed = null;
            } else if (Number.isFinite(this._fightBaseSpeed) && this._fightBaseSpeed > 0) {
                strategyMultiplier = currentPermanentSpeed / this._fightBaseSpeed;
                this._fightBaseSpeed = options.speed;
                this._arcadeBaseSpeed = null;
            }
            if (!Number.isFinite(strategyMultiplier) || strategyMultiplier <= 0) {
                strategyMultiplier = 1;
            }
            const nextPermanentSpeed = options.speed * strategyMultiplier;
            if (Number.isFinite(this._speedEffectBaseSpeed)) {
                const activeMultiplier = this._speedEffectBaseSpeed > 0
                    ? (this.baseSpeed / this._speedEffectBaseSpeed)
                    : 1;
                this._speedEffectBaseSpeed = nextPermanentSpeed;
                this.baseSpeed = nextPermanentSpeed * (Number.isFinite(activeMultiplier) ? activeMultiplier : 1);
            } else {
                this.baseSpeed = nextPermanentSpeed;
            }
            if (!this.isBoosting) {
                this.speed = this.baseSpeed;
            }
        }
        if (typeof options.turnSpeed === 'number' && Number.isFinite(options.turnSpeed) && options.turnSpeed > 0) {
            this.turnSpeed = options.turnSpeed;
        }
        if (typeof options.rollSpeed === 'number' && Number.isFinite(options.rollSpeed) && options.rollSpeed > 0) {
            this.rollSpeed = options.rollSpeed;
        }
        if (typeof options.controlRampEnabled === 'boolean') {
            this.controlRampEnabled = options.controlRampEnabled;
        }
        if (typeof options.controlRampAttackRate === 'number' && Number.isFinite(options.controlRampAttackRate) && options.controlRampAttackRate > 0) {
            this.controlRampRates.attackRate = options.controlRampAttackRate;
        }
        if (typeof options.controlRampReleaseRate === 'number' && Number.isFinite(options.controlRampReleaseRate) && options.controlRampReleaseRate > 0) {
            this.controlRampRates.releaseRate = options.controlRampReleaseRate;
        }
        this.controller?.setRampRates?.(this.controlRampRates);
    }

    applyPowerup(type, options = {}) {
        applyPlayerPowerup(this, type, options);
    }

    _removeEffect(effect) {
        removePlayerEffect(this, effect);
    }

    addToInventory(type) {
        return addPlayerInventoryItem(this, type);
    }

    cycleItem() {
        cyclePlayerInventoryItem(this);
    }

    useItem() {
        return usePlayerInventoryItem(this);
    }

    dropItem() {
        return dropPlayerInventoryItem(this);
    }

    kill() {
        this.alive = false;
        this.hp = 0;
        // A dead player stops updating, so any clock effect it still carries would
        // freeze the whole match in slow motion until the next spawn.
        this.manualSlowMoActive = false;
        this.isSlowMoActive = false;
        this.hasSlowTime = false;
        this.slowTimeScale = 1;
        this.trail?.hideVisualHead?.();
        this.view?.setVisible(false);
    }

    takeDamage(amount, options = {}) {
        // Walls, trails, hazards and turrets already skip a protected vehicle; weapon hits land here.
        if ((this.spawnProtectionTimer || 0) > 0) return { applied: 0, absorbedByShield: 0, hpApplied: 0, remainingHp: this.hp, isDead: this.hp <= 0 };
        const clockMs = this.entityManager?._simulationClockMs;
        return applyDamage(this, amount, Number.isFinite(clockMs) && options.nowSeconds == null ? { ...options, nowSeconds: Math.max(0, clockMs) * 0.001 } : options);
    }

    heal(amount) {
        const strategy = this.entityManager?.gameModeStrategy || null;
        return typeof strategy?.applyHealing === 'function'
            ? strategy.applyHealing(this, amount, this.entityRuntimeConfig)
            : applyHealing(this, amount);
    }

    isDead() {
        return !this.alive || this.hp <= 0;
    }

    getDirection(out = null) {
        if (out) {
            return out.set(0, 0, -1).applyQuaternion(this.quaternion);
        }
        return new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
    }

    markRenderDiscontinuity(_reason = 'external') {
        this._renderPrevPosition.copy(this.position);
        this._renderPrevQuaternion.copy(this.quaternion);
        this._renderInterpolationPosition.copy(this.position);
        this._renderInterpolationQuaternion.copy(this.quaternion);
        this._renderDiscontinuityVersion = (this._renderDiscontinuityVersion + 1) >>> 0;
    }

    _shouldAutoResetRenderInterpolation() {
        const playerConfig = this.gameplayConfig.PLAYER;
        const speed = Math.max(
            1,
            Number(this.speed) || Number(this.baseSpeed) || Number(playerConfig.SPEED) || 18
        );
        const radius = Math.max(0.2, Number(this.hitboxRadius) || Number(playerConfig.HITBOX_RADIUS) || 0.8);
        const maxInterpolatedDistance = Math.max(radius * 3.5, speed * 0.5);
        if (this._renderPrevPosition.distanceToSquared(this.position) > maxInterpolatedDistance * maxInterpolatedDistance) {
            return true;
        }
        const angularDelta = this._renderPrevQuaternion.angleTo(this.quaternion);
        return angularDelta > 2.0;
    }

    resolveRenderTransform(alpha = 1, outPosition = null, outQuaternion = null) {
        if (this._shouldAutoResetRenderInterpolation()) {
            this.markRenderDiscontinuity('auto');
        }

        const resolvedAlpha = Number.isFinite(alpha)
            ? Math.max(0, Math.min(1, alpha))
            : 1;

        if (outPosition) {
            if (resolvedAlpha <= 0) {
                outPosition.copy(this._renderPrevPosition);
            } else if (resolvedAlpha >= 1) {
                outPosition.copy(this.position);
            } else {
                outPosition.copy(this._renderPrevPosition).lerp(this.position, resolvedAlpha);
            }
        }

        if (outQuaternion) {
            if (resolvedAlpha <= 0) {
                outQuaternion.copy(this._renderPrevQuaternion);
            } else if (resolvedAlpha >= 1) {
                outQuaternion.copy(this.quaternion);
            } else {
                outQuaternion.copy(this._renderPrevQuaternion).slerp(this.quaternion, resolvedAlpha);
            }
        }
        return resolvedAlpha;
    }

    resolveRenderPosition(alpha = 1, out = null) {
        const target = out || this._renderInterpolationPosition;
        this.resolveRenderTransform(alpha, target, null);
        return target;
    }

    resolveRenderQuaternion(alpha = 1, out = null) {
        const target = out || this._renderInterpolationQuaternion;
        this.resolveRenderTransform(alpha, null, target);
        return target;
    }

    resolveRenderDirection(alpha = 1, out = null) {
        const target = out || this._tmpDir;
        this.resolveRenderQuaternion(alpha, this._renderInterpolationQuaternion);
        return target.set(0, 0, -1).applyQuaternion(this._renderInterpolationQuaternion);
    }

    getFirstPersonCameraAnchor(out = null) {
        if (this.view) {
            return this.view.getFirstPersonCameraAnchor(out);
        }

        const target = out || new THREE.Vector3();
        this.getDirection(this._tmpDir);
        return target.copy(this.position).add(this._tmpDir);
    }

    getAimDirection(out = null) {
        const gameplaySection = this.gameplayConfig.GAMEPLAY;
        const target = out || new THREE.Vector3();
        this.getDirection(target).normalize();

        if (!gameplaySection.PLANAR_MODE) {
            return target;
        }

        const aimOffset = Math.min(1, Math.max(-1, this.planarAimOffset || 0));
        if (Math.abs(aimOffset) < 0.0001) {
            return target;
        }

        this._tmpAimRight.crossVectors(this._tmpDir.set(0, 1, 0), target);
        if (this._tmpAimRight.lengthSq() < 0.000001) {
            this._tmpAimRight.set(1, 0, 0);
        } else {
            this._tmpAimRight.normalize();
        }
        this._tmpAimUp.crossVectors(target, this._tmpAimRight).normalize();

        const angleRad = THREE.MathUtils.degToRad(this.gameplayConfig.PROJECTILE.PLANAR_AIM_MAX_ANGLE_DEG) * aimOffset;
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);
        target.multiplyScalar(cosA).addScaledVector(this._tmpAimUp, sinA).normalize();
        return target;
    }

    dispose() {
        this.trail.dispose();
        this.trail = null;
        this.view?.dispose();

        this.vehicleMesh = null;
        this.shieldMesh = null;
        this.firstPersonAnchor = null;
        this.flames = [];
        this.group = null;

        this.controller = null;
        this.particleSystem = null;
        this.view = null;
        this.activeEffects = [];
        this.gameplayConfig = null;
        this.entityRuntimeConfig = null;
    }

    isSphereInOBB(worldCenter, radius) {
        return isSphereInPlayerOBB(this, worldCenter, radius);
    }

    prepareObbCollisionQuery() {
        return preparePlayerObbCollisionQuery(this);
    }

    // prepareObbCollisionQuery() is a no-op once the cache is warm, so callers that moved
    // or rotated the player mid-frame have to invalidate it first - otherwise every
    // following hit test runs against the pose the player had before the move.
    refreshObbCollisionQuery() {
        this._obbCollisionPrepared = false;
        return preparePlayerObbCollisionQuery(this);
    }

    activateBoostPortal(params, forward) {
        this.boostPortalTimer = params.duration || 1.5;
        this.boostPortalParams = params;
        this.boostPortalDir.copy(forward);

        this.isBoosting = true;
    }

    activateSlingshot(params, forward, up) {
        this.slingshotTimer = params.duration || 2.0;
        this.slingshotParams = params;
        this.slingshotForward.copy(forward);
        this.slingshotUp.copy(up);

        this.lockSteering(0.15);
    }
}

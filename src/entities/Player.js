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
import { PlayerController } from './player/PlayerController.js';
import { createPlayerView } from './player/createPlayerView.js';

export class Player {
    constructor(renderer, index, color, isBot = false, options = {}) {
        this.renderer = renderer;
        this.index = index;
        this.color = color;
        this.isBot = isBot;
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

        // Boost
        this.boostCharge = playerConfig.BOOST_DURATION;
        this.boostTimer = this.boostCharge;
        this.boostCooldown = 0;
        this.manualBoostActive = false;
        this.isBoosting = false;

        // Powerup effects
        this.activeEffects = [];
        this.inventory = [];
        this.selectedItemIndex = 0;
        this.hasShield = false;
        this.shieldHP = 0;
        this.maxShieldHp = 1;
        this.shieldHitFeedback = 0;
        this.isGhost = false;
        this.hasSlowTime = false;
        this.slowTimeScale = 1;
        this.invertControls = false;
        this.maxHp = 1;
        this.hp = 1;
        this.lastDamageTimestamp = -Infinity;
        this.itemUseCooldownRemaining = 0;
        this.invertPitchBase = false;
        this.modelScale = playerConfig.MODEL_SCALE || 1;
        this.cockpitCamera = gameplayCameraState.cockpitCamera;
        this.spawnProtectionTimer = 0;
        this.planarAimOffset = 0;
        this.steeringLockTimer = 0;
        this.controlRampEnabled = false;
        this.controlRampRates = {
            attack: 12.0,
            release: 8.5,
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
        this.speed = this.baseSpeed;
        this.boostCharge = playerConfig.BOOST_DURATION;
        this.boostTimer = this.boostCharge;
        this.boostCooldown = 0;
        this.manualBoostActive = false;
        this.isBoosting = false;
        this.activeEffects = [];
        this.hasShield = false;
        this.isGhost = false;
        this.hasSlowTime = false;
        this.slowTimeScale = 1;
        this.invertControls = false;
        this.spawnProtectionTimer = playerConfig.SPAWN_PROTECTION || 0;
        this.planarAimOffset = 0;
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
            const angle = Math.random() * Math.PI * 2;
            this._tmpEuler.set(0, angle, 0, 'YXZ');
            this.quaternion.setFromEuler(this._tmpEuler);
        }

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
        this.steeringLockTimer = Math.max(0, (this.steeringLockTimer || 0) - dt);
        this.shieldHitFeedback = Math.max(0, (this.shieldHitFeedback || 0) - dt * 3.2);
        this.itemUseCooldownRemaining = Math.max(0, Number(this.itemUseCooldownRemaining || 0) - dt);
        const steeringLocked = this.steeringLockTimer > 0;

        updatePlayerHealthRegen(this, dt);
        updatePlayerEffects(this, dt);

        // 61.4.1: Apply modifier per-frame effects via strategy
        if (strategy) {
            if (typeof strategy.updateHealthRegen === 'function') {
                strategy.updateHealthRegen(this, dt);
            }
            if (typeof strategy.applyBoostTick === 'function') {
                strategy.applyBoostTick(this, dt);
            }
        }

        // Capture vor JEDEM Substep, nicht nur einmal pro Frame.
        // So interpoliert render() immer zwischen den letzten beiden Physics-States
        // statt über N Substeps hinweg (was bei Framedrops zum Ruckeln fuehrt).
        this._renderPrevPosition.copy(this.position);
        this._renderPrevQuaternion.copy(this.quaternion);

        const controlState = this.controller.resolveControlState(this, input, steeringLocked, dt);
        // 61.4.1: Thread turn rate multiplier from strategy
        const turnRateMultiplier = (strategy && typeof strategy.getTurnRateMultiplier === 'function')
            ? strategy.getTurnRateMultiplier() : 1;
        updatePlayerMotion(this, dt, controlState, turnRateMultiplier);
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
            this.baseSpeed = options.speed;
            if (!this.isBoosting) {
                this.speed = options.speed;
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
            this.controlRampRates.attack = options.controlRampAttackRate;
        }
        if (typeof options.controlRampReleaseRate === 'number' && Number.isFinite(options.controlRampReleaseRate) && options.controlRampReleaseRate > 0) {
            this.controlRampRates.release = options.controlRampReleaseRate;
        }
        this.controller?.setRampRates?.(this.controlRampRates);
    }

    applyPowerup(type) {
        applyPlayerPowerup(this, type);
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
        this.trail?.hideVisualHead?.();
        this.view?.setVisible(false);
    }

    takeDamage(amount, options = {}) {
        return applyDamage(this, amount, options);
    }

    heal(amount) {
        return applyHealing(this, amount);
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
        this.view?.dispose();

        this.vehicleMesh = null;
        this.shieldMesh = null;
        this.firstPersonAnchor = null;
        this.flames = [];
        this.group = null;

        this.controller = null;
        this.particleSystem = null;
        this.view = null;
    }

    isSphereInOBB(worldCenter, radius) {
        return isSphereInPlayerOBB(this, worldCenter, radius);
    }

    prepareObbCollisionQuery() {
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

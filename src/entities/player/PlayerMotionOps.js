import { resolveEntityRuntimeConfig } from '../../shared/contracts/EntityRuntimeConfig.js';
import { applyFourPlayerPlanarPhysicsConstraint } from '../../four-player-planar/FourPlayerPlanarPhysics.js';
import { updatePlayerCharges } from './PlayerChargeOps.js';

const MIN_HITBOX_RADIUS = 0.2;
const HITBOX_HEIGHT_FACTOR = 0.7;

function applyFallbackHitbox(player, fallbackRadius) {
    player.hitboxBox.set(
        player._tmpVec.set(-fallbackRadius, -fallbackRadius * HITBOX_HEIGHT_FACTOR, -fallbackRadius),
        player._tmpDir.set(fallbackRadius, fallbackRadius * HITBOX_HEIGHT_FACTOR, fallbackRadius)
    );
}

function updateHitboxDerivedState(player) {
    if (!player?.hitboxBox || !player?.hitboxSize || !player?.hitboxCenter) return;
    player.hitboxBox.getSize(player.hitboxSize);
    player.hitboxBox.getCenter(player.hitboxCenter);
}

function hasValidHitbox(box) {
    if (!box || box.isEmpty()) return false;
    const min = box.min;
    const max = box.max;
    return Number.isFinite(min.x)
        && Number.isFinite(min.y)
        && Number.isFinite(min.z)
        && Number.isFinite(max.x)
        && Number.isFinite(max.y)
        && Number.isFinite(max.z);
}

function clampAxisInput(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    if (numeric > 1) return 1;
    if (numeric < -1) return -1;
    return numeric;
}

export function initializePlayerHitbox(player, radius) {
    if (!player?.hitboxBox) return;
    const fallbackRadius = Math.max(MIN_HITBOX_RADIUS, Number(radius) || Number(resolveEntityRuntimeConfig(player).PLAYER.HITBOX_RADIUS) || 0.8);
    applyFallbackHitbox(player, fallbackRadius);
    updateHitboxDerivedState(player);
}

export function syncPlayerHitboxFromVehicleMesh(player, mesh = null) {
    if (!player?.hitboxBox) return null;

    const targetMesh = mesh || player.vehicleMesh;
    const fallbackRadius = Math.max(MIN_HITBOX_RADIUS, Number(player.hitboxRadius) || Number(resolveEntityRuntimeConfig(player).PLAYER.HITBOX_RADIUS) || 0.8);

    if (!targetMesh) {
        applyFallbackHitbox(player, fallbackRadius);
        updateHitboxDerivedState(player);
        return player.hitboxBox;
    }

    if (targetMesh.localBox) {
        player.hitboxBox.copy(targetMesh.localBox);
    } else {
        targetMesh.updateMatrixWorld?.(true);
        if (player._tmpMat && targetMesh.matrixWorld) {
            const inverse = player._tmpMat.copy(targetMesh.matrixWorld).invert();
            player.hitboxBox.setFromObject(targetMesh).applyMatrix4(inverse);
        } else {
            player.hitboxBox.setFromObject(targetMesh);
        }
    }

    if (!hasValidHitbox(player.hitboxBox)) {
        applyFallbackHitbox(player, fallbackRadius);
    }

    updateHitboxDerivedState(player);
    return player.hitboxBox;
}

export function updatePlayerMotion(player, dt, controlState = null, turnRateMultiplier = 1, motionDt = dt) {
    const config = resolveEntityRuntimeConfig(player);
    const resolvedTurnSpeed = Number(player?.turnSpeed) || Number(config.PLAYER.TURN_SPEED) || 0;
    const resolvedRollSpeed = Number(player?.rollSpeed) || Number(config.PLAYER.ROLL_SPEED) || 0;
    // 61.4.1: tight_turns modifier reduces turn rate
    const turnRateMul = Number.isFinite(turnRateMultiplier)
        ? Math.max(0.1, turnRateMultiplier) : 1.0;
    // Bullet time: `dt` stays the world clock (reserves, powerup timers, trail), while
    // `motionDt` is the clock this vehicle steers and travels on. They differ only for
    // the player holding the slow-motion key; otherwise motionDt === dt.
    //
    // Collision headroom for the worst case (boost 45 * 2.3 = 103.5 u/s at motionDt
    // (1/60)/0.4 = 4.3125 units per step, smallest vehicle hitbox radius 0.8):
    //   wall sweep  ceil(4.3125 / 0.8)  =  6 steps of 0.72 u  <= CRASH_SWEEP_MAX_STEPS 16
    //   trail sweep ceil(4.3125 / 1.36) =  4 steps of 1.08 u  <= the 12 step cap, and
    //               1.08 u stays inside the 2 * 1.6 u search diameter.
    // Both sweeps therefore stay gap-free; no substepping and no raised cap needed.
    const resolvedMotionDt = Number.isFinite(motionDt) && motionDt > 0 ? motionDt : dt;
    const turnSpeed = resolvedTurnSpeed * turnRateMul * resolvedMotionDt;
    const rollSpeed = resolvedRollSpeed * resolvedMotionDt;

    const pitchInput = clampAxisInput(controlState?.pitchInput);
    const yawInput = clampAxisInput(controlState?.yawInput);
    const rollInput = clampAxisInput(controlState?.rollInput);
    const manualBoostActive = updatePlayerCharges(player, dt, controlState);
    const boostEffectActive = manualBoostActive || player.boostPortalTimer > 0;
    player.isBoosting = boostEffectActive;

    player._tmpEuler.set(
        pitchInput * turnSpeed,
        yawInput * turnSpeed,
        rollInput * rollSpeed,
        'YXZ'
    );
    player._tmpQuat.setFromEuler(player._tmpEuler);
    player.quaternion.multiply(player._tmpQuat);

    if (config.PLAYER.AUTO_ROLL && rollInput === 0) {
        player._tmpEuler2.setFromQuaternion(player.quaternion, 'YXZ');
        player._tmpEuler2.z *= (1 - config.PLAYER.AUTO_ROLL_SPEED * resolvedMotionDt);

        if (config.GAMEPLAY.PLANAR_MODE) {
            player._tmpEuler2.x = 0;
        }

        player.quaternion.setFromEuler(player._tmpEuler2);
    } else if (config.GAMEPLAY.PLANAR_MODE) {
        player._tmpEuler2.setFromQuaternion(player.quaternion, 'YXZ');
        player._tmpEuler2.x = 0;
        player.quaternion.setFromEuler(player._tmpEuler2);
    }

    player.speed = boostEffectActive
        ? player.baseSpeed * config.PLAYER.BOOST_MULTIPLIER
        : player.baseSpeed;

    player._tmpVec.set(0, 0, -1).applyQuaternion(player.quaternion);
    player.velocity.copy(player._tmpVec).multiplyScalar(player.speed);

    if (player.boostPortalTimer > 0) {
        const factor = Math.min(1, player.boostPortalTimer / 0.5);
        const strength = (player.boostPortalParams?.forwardImpulse || 40) * factor;
        player.velocity.addScaledVector(player.boostPortalDir, strength);
        player.speed = Math.max(player.speed, (player.boostPortalParams?.bonusSpeed || 50));
    }

    if (player.slingshotTimer > 0) {
        const factor = Math.min(1, player.slingshotTimer / 1.0);
        const fStrength = (player.slingshotParams?.forwardImpulse || 25) * factor;
        const uStrength = (player.slingshotParams?.liftImpulse || 5) * factor;
        player.velocity.addScaledVector(player.slingshotForward, fStrength);
        player.velocity.addScaledVector(player.slingshotUp, uStrength);
    }

    if (config.GAMEPLAY.PLANAR_MODE) {
        player.velocity.y = 0;
        player.position.y = player.currentPlanarY;
    }

    player.position.x += player.velocity.x * resolvedMotionDt;
    if (!config.GAMEPLAY.PLANAR_MODE) {
        player.position.y += player.velocity.y * resolvedMotionDt;
    }
    player.position.z += player.velocity.z * resolvedMotionDt;
    applyFourPlayerPlanarPhysicsConstraint(player);
}

export function setPlayerLookAtWorld(player, x, y, z) {
    if (!player?.position || !player?.quaternion) return false;

    const tx = Number(x);
    const ty = Number(y);
    const tz = Number(z);
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || !Number.isFinite(tz)) {
        return false;
    }

    player._tmpVec.set(tx, ty, tz).sub(player.position);
    if (player._tmpVec.lengthSq() <= 0.000001) {
        return false;
    }

    player._tmpVec.normalize();
    player.quaternion.setFromUnitVectors(player._tmpDir.set(0, 0, -1), player._tmpVec);
    if (player) {
        player._obbCollisionPrepared = false;
    }
    return true;
}

export function preparePlayerObbCollisionQuery(player) {
    if (!player?.hitboxBox) return false;
    if (player._obbCollisionPrepared === true) {
        return true;
    }

    const scaleValue = Number(player.modelScale) || 1;
    if (!player._tmpHitboxScale) return false;
    player._tmpWorldToLocal.compose(
        player.position,
        player.quaternion,
        player._tmpHitboxScale.set(scaleValue, scaleValue, scaleValue)
    ).invert();

    player._obbCollisionPrepared = true;
    return true;
}

export function isSphereInPlayerOBB(player, worldCenter, radius) {
    if (!player?.alive || !player?.hitboxBox || !worldCenter) return false;
    if (!player._obbCollisionPrepared && !preparePlayerObbCollisionQuery(player)) return false;

    player._tmpLocalSphere.center.copy(worldCenter).applyMatrix4(player._tmpWorldToLocal);
    player._tmpLocalSphere.radius = radius;

    return player.hitboxBox.intersectsSphere(player._tmpLocalSphere);
}

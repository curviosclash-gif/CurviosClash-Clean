import { resolveEntityRuntimeConfig } from '../../shared/contracts/EntityRuntimeConfig.js';

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

function resolveBoostCapacity(player) {
    return Math.max(0.001, Number(resolveEntityRuntimeConfig(player)?.PLAYER?.BOOST_DURATION) || 1);
}

function resolveBoostRechargeTime(player) {
    return Math.max(0.001, Number(resolveEntityRuntimeConfig(player)?.PLAYER?.BOOST_COOLDOWN) || 1);
}

function syncBoostUiState(player, maxCharge, rechargeRate) {
    player.boostTimer = player.boostCharge;
    const missingCharge = Math.max(0, maxCharge - player.boostCharge);
    player.boostCooldown = rechargeRate > 0 ? missingCharge / rechargeRate : 0;
}

function updateBoostState(player, dt, controlState = null) {
    const maxCharge = resolveBoostCapacity(player);
    const rechargeTime = resolveBoostRechargeTime(player);
    const rechargeRate = maxCharge / rechargeTime;
    const minActivationCharge = Math.max(0.05, maxCharge * 0.02);
    const boostHeld = !!controlState?.boost;
    const boostPressed = !!controlState?.boostPressed;

    if (!Number.isFinite(player.boostCharge)) {
        player.boostCharge = maxCharge;
    } else if (player.boostCharge < 0) {
        player.boostCharge = 0;
    } else if (player.boostCharge > maxCharge) {
        player.boostCharge = maxCharge;
    }

    if (player.isBot) {
        player.manualBoostActive = boostHeld && player.boostCharge > minActivationCharge;
    } else if (boostPressed) {
        if (player.manualBoostActive) {
            player.manualBoostActive = false;
        } else if (player.boostCharge > minActivationCharge) {
            player.manualBoostActive = true;
        }
    }

    if (player.manualBoostActive) {
        player.boostCharge = Math.max(0, player.boostCharge - dt);
        if (player.boostCharge <= 0.0001) {
            player.boostCharge = 0;
            player.manualBoostActive = false;
        }
    } else if (player.boostCharge < maxCharge) {
        player.boostCharge = Math.min(maxCharge, player.boostCharge + rechargeRate * dt);
    }

    syncBoostUiState(player, maxCharge, rechargeRate);
    return player.manualBoostActive;
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

export function updatePlayerMotion(player, dt, controlState = null, motionOptions = null) {
    const config = resolveEntityRuntimeConfig(player);
    const resolvedTurnSpeed = Number(player?.turnSpeed) || Number(config.PLAYER.TURN_SPEED) || 0;
    const resolvedRollSpeed = Number(player?.rollSpeed) || Number(config.PLAYER.ROLL_SPEED) || 0;
    // 61.4.1: tight_turns modifier reduces turn rate
    const turnRateMul = (motionOptions && typeof motionOptions.turnRateMultiplier === 'number')
        ? Math.max(0.1, motionOptions.turnRateMultiplier) : 1.0;
    const turnSpeed = resolvedTurnSpeed * turnRateMul * dt;
    const rollSpeed = resolvedRollSpeed * dt;

    const pitchInput = clampAxisInput(controlState?.pitchInput);
    const yawInput = clampAxisInput(controlState?.yawInput);
    const rollInput = clampAxisInput(controlState?.rollInput);
    const manualBoostActive = updateBoostState(player, dt, controlState);
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
        player._tmpEuler2.z *= (1 - config.PLAYER.AUTO_ROLL_SPEED * dt);

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

    player.position.x += player.velocity.x * dt;
    if (!config.GAMEPLAY.PLANAR_MODE) {
        player.position.y += player.velocity.y * dt;
    }
    player.position.z += player.velocity.z * dt;
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

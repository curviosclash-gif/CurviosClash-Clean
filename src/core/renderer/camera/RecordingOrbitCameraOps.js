import * as THREE from 'three';

const BASE_FOV_OFFSET = 0;
const FOV_BOOST_OFFSET = 22;
const FOV_HIT_OFFSET = -10;
const FOV_HIT_SNAP_BACK = 5;
const FOV_DUEL_OFFSET = 8;
const FOV_DECAY_SPEED = 6;
const FOV_SNAP_BACK_DELAY = 0.25;

export const RECORDING_ORBIT_FOV = Object.freeze({
    BOOST: FOV_BOOST_OFFSET,
    HIT: FOV_HIT_OFFSET,
    HIT_SNAP_BACK: FOV_HIT_SNAP_BACK,
    SNAP_BACK_DELAY: FOV_SNAP_BACK_DELAY,
});

export function resetRecordingOrbitPlayerState(state, playerIndex) {
    state._phaseByPlayer[playerIndex] = undefined;
    state._blendByPlayer[playerIndex] = undefined;
    state._shotTimerByPlayer[playerIndex] = undefined;
    state._shotDurationByPlayer[playerIndex] = undefined;
    state._shotSeqIndexByPlayer[playerIndex] = undefined;
    state._slotStyleByPlayer[playerIndex] = undefined;
    state._prevShotType[playerIndex] = undefined;
    state._prevHpRatio[playerIndex] = undefined;
    state._prevScore[playerIndex] = undefined;
    state._prevBoosting[playerIndex] = undefined;
    state._baselineSpeed[playerIndex] = undefined;
    state._eventOverrideShot[playerIndex] = undefined;
    state._eventOverrideTimer[playerIndex] = undefined;
    state._shakeIntensity[playerIndex] = undefined;
    state._shakeDecay[playerIndex] = undefined;
    state._fovOffset[playerIndex] = undefined;
    state._fovTarget[playerIndex] = undefined;
    state._fovSnapBackTimer[playerIndex] = undefined;
    state._baseFovByPlayer[playerIndex] = undefined;
    state._letterboxTimer[playerIndex] = undefined;
    state._collisionSolver.resetPlayer(playerIndex);
}

export function resetRecordingOrbitPlayer(state, playerIndex) {
    if (!Number.isInteger(playerIndex) || playerIndex < 0) return;
    resetRecordingOrbitPlayerState(state, playerIndex);
    state._lastPlayerPositionByPlayer[playerIndex] = undefined;
    state._discontinuityVersionByPlayer[playerIndex] = undefined;
}

export function detectRecordingOrbitPositionDiscontinuity(
    state,
    playerIndex,
    playerPosition,
    discontinuityVersion = null
) {
    const nextDiscontinuityVersion = Number(discontinuityVersion);
    const previousDiscontinuityVersion = state._discontinuityVersionByPlayer[playerIndex];
    const versionChanged = Number.isFinite(nextDiscontinuityVersion)
        && Number.isFinite(previousDiscontinuityVersion)
        && nextDiscontinuityVersion !== previousDiscontinuityVersion;
    if (Number.isFinite(nextDiscontinuityVersion)) {
        state._discontinuityVersionByPlayer[playerIndex] = nextDiscontinuityVersion;
    }
    let previousPosition = state._lastPlayerPositionByPlayer[playerIndex];
    if (!previousPosition) {
        previousPosition = new THREE.Vector3();
        state._lastPlayerPositionByPlayer[playerIndex] = previousPosition;
        previousPosition.copy(playerPosition);
        return false;
    }
    const thresholdSq = state.discontinuityDistance * state.discontinuityDistance;
    const discontinuity = versionChanged
        || previousPosition.distanceToSquared(playerPosition) > thresholdSq;
    previousPosition.copy(playerPosition);
    return discontinuity;
}

export function isWithinRecordingArenaBounds(position, arena) {
    const bounds = arena?.bounds || null;
    if (!bounds) return true;
    const minX = Number(bounds.min?.x ?? bounds.minX);
    const maxX = Number(bounds.max?.x ?? bounds.maxX);
    const minY = Number(bounds.min?.y ?? bounds.minY);
    const maxY = Number(bounds.max?.y ?? bounds.maxY);
    const minZ = Number(bounds.min?.z ?? bounds.minZ);
    const maxZ = Number(bounds.max?.z ?? bounds.maxZ);
    if (![minX, maxX, minY, maxY, minZ, maxZ].every(Number.isFinite)) return true;
    const margin = 1.25;
    return position.x >= minX + margin
        && position.x <= maxX - margin
        && position.y >= minY + margin
        && position.y <= maxY - margin
        && position.z >= minZ + margin
        && position.z <= maxZ - margin;
}

export function moveRecordingCameraTowardFallback(camera, fallbackTarget, exitSpeed, dt) {
    const fallbackPosition = fallbackTarget?.position || null;
    if (!fallbackPosition
        || !Number.isFinite(fallbackPosition.x)
        || !Number.isFinite(fallbackPosition.y)
        || !Number.isFinite(fallbackPosition.z)) {
        return;
    }
    camera.position.lerp(fallbackPosition, 1 - Math.exp(-exitSpeed * dt));
}

export function updateRecordingOrbitFov(
    state,
    playerIndex,
    camera,
    dt,
    baseFov,
    isDuel,
    dynamicFovEnabled = true,
    dynamicFovIntensity = 1
) {
    if (!camera) return;
    if (!dynamicFovEnabled) {
        state._fovOffset[playerIndex] = 0;
        state._fovTarget[playerIndex] = 0;
        state._fovSnapBackTimer[playerIndex] = 0;
        if (Math.abs(camera.fov - baseFov) > 0.01) {
            camera.fov = baseFov;
            camera.updateProjectionMatrix();
        }
        return;
    }

    if ((state._fovSnapBackTimer[playerIndex] || 0) > 0) {
        state._fovSnapBackTimer[playerIndex] -= dt;
        if (state._fovSnapBackTimer[playerIndex] <= 0) {
            state._fovTarget[playerIndex] = FOV_HIT_SNAP_BACK;
            state._fovSnapBackTimer[playerIndex] = 0;
        }
    }

    let rawTarget = state._fovTarget[playerIndex] || BASE_FOV_OFFSET;
    if (isDuel) rawTarget = Math.max(rawTarget, FOV_DUEL_OFFSET);
    if ((state._eventOverrideTimer[playerIndex] || 0) <= 0
        && (state._fovSnapBackTimer[playerIndex] || 0) <= 0) {
        state._fovTarget[playerIndex] = rawTarget + (0 - rawTarget) * Math.min(1, dt * 3);
        rawTarget = state._fovTarget[playerIndex];
    }

    const intensity = THREE.MathUtils.clamp(Number(dynamicFovIntensity) || 0, 0, 1.5);
    const target = rawTarget * intensity;
    const current = state._fovOffset[playerIndex] || 0;
    const alpha = 1 - Math.exp(-FOV_DECAY_SPEED * dt);
    const next = current + (target - current) * alpha;
    state._fovOffset[playerIndex] = Math.abs(next) < 0.05 ? 0 : next;

    const desiredFov = baseFov + state._fovOffset[playerIndex];
    if (Math.abs(camera.fov - desiredFov) > 0.01) {
        camera.fov = desiredFov;
        camera.updateProjectionMatrix();
    }
}

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

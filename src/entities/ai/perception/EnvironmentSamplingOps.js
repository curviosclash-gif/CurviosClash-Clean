import * as THREE from 'three';

const DEFAULT_WORLD_UP = new THREE.Vector3(0, 1, 0);
const DEFAULT_PROBE = new THREE.Vector3();
const DEFAULT_TO_TARGET = new THREE.Vector3();
const DEFAULT_DIRECTION = new THREE.Vector3();

export const PERCEPTION_THRESHOLDS = Object.freeze({
    targetInFrontDot: 0.52,
    targetYawDeadzone: 0.04,
    targetPitchDeadzone: 0.06,
    projectileApproachDot: 0.25,
});

export function resolveAdaptiveWallProbeSteps(previousRatio, minSteps = 8, maxSteps = 20) {
    const safeMin = Math.max(4, Math.trunc(minSteps));
    const safeMax = Math.max(safeMin, Math.trunc(maxSteps));
    if (!Number.isFinite(previousRatio)) return safeMax;
    if (previousRatio >= 0.72) return safeMin;
    if (previousRatio >= 0.45) return Math.max(safeMin, Math.trunc((safeMin + safeMax) * 0.5));
    return safeMax;
}

export function buildPerceptionBasis(forward, rightOut, upOut, worldUp = DEFAULT_WORLD_UP) {
    rightOut.crossVectors(worldUp, forward);
    if (rightOut.lengthSq() <= 0.000001) {
        rightOut.set(1, 0, 0);
    } else {
        rightOut.normalize();
    }
    upOut.crossVectors(forward, rightOut).normalize();
}

export function sampleWallDistance(arena, origin, direction, radius, maxDistance, steps = 20, probe = DEFAULT_PROBE) {
    if (!arena || typeof arena.checkCollision !== 'function') {
        return maxDistance;
    }

    const safeSteps = Math.max(4, Math.trunc(steps));
    const safeMaxDistance = Math.max(1, Number(maxDistance) || 1);
    const stepDistance = safeMaxDistance / safeSteps;

    for (let i = 1; i <= safeSteps; i++) {
        probe.copy(origin).addScaledVector(direction, stepDistance * i);
        if (arena.checkCollision(probe, radius)) {
            return stepDistance * (i - 1);
        }
    }

    return safeMaxDistance;
}

export function findNearestEnemySample(
    player,
    players,
    forward,
    toTarget = DEFAULT_TO_TARGET
) {
    let nearest = null;
    let nearestDistSq = Infinity;

    for (let i = 0; i < players.length; i++) {
        const other = players[i];
        if (!other || other === player || !other.alive) continue;
        toTarget.subVectors(other.position, player.position);
        const distSq = toTarget.lengthSq();
        if (distSq < nearestDistSq) {
            nearest = other;
            nearestDistSq = distSq;
        }
    }

    if (!nearest) {
        return { nearest: null, distanceSq: Infinity, alignment: 0 };
    }

    toTarget.subVectors(nearest.position, player.position).normalize();
    return {
        nearest,
        distanceSq: nearestDistSq,
        alignment: forward.dot(toTarget),
    };
}

/**
 * @param {any} player
 * @param {any[]} projectiles
 * @param {number} threatRange
 * @param {{ approachDot?: number, toTarget?: any, direction?: any }} [options]
 * @returns {number}
 */
export function computeProjectileThreatFlag(
    player,
    projectiles,
    threatRange,
    {
        approachDot = PERCEPTION_THRESHOLDS.projectileApproachDot,
        toTarget = DEFAULT_TO_TARGET,
        direction = DEFAULT_DIRECTION,
    } = {}
) {
    if (!Array.isArray(projectiles) || projectiles.length === 0) {
        return 0;
    }

    const maxDistSq = Math.max(1, threatRange * threatRange);
    for (let i = 0; i < projectiles.length; i++) {
        const projectile = projectiles[i];
        if (!projectile || !projectile.position || !projectile.velocity) continue;
        if (projectile.owner === player) continue;

        toTarget.subVectors(player.position, projectile.position);
        const distSq = toTarget.lengthSq();
        if (distSq > maxDistSq || distSq <= 0.000001) continue;

        direction.copy(projectile.velocity);
        if (direction.lengthSq() <= 0.000001) continue;
        direction.normalize();
        toTarget.normalize();

        const approachingDot = direction.dot(toTarget);
        if (approachingDot > approachDot) {
            return 1;
        }
    }

    return 0;
}

export function computeTargetSteeringSignals(
    forward,
    right,
    up,
    toTarget,
    {
        yawDeadzone = PERCEPTION_THRESHOLDS.targetYawDeadzone,
        pitchDeadzone = PERCEPTION_THRESHOLDS.targetPitchDeadzone,
    } = {}
) {
    if (!toTarget) {
        return { yaw: 0, pitch: 0, aimDot: 0 };
    }

    const lengthSq = toTarget.lengthSq();
    if (lengthSq <= 0.000001) {
        return { yaw: 0, pitch: 0, aimDot: 0 };
    }

    const invLength = 1 / Math.sqrt(lengthSq);
    const nx = toTarget.x * invLength;
    const ny = toTarget.y * invLength;
    const nz = toTarget.z * invLength;
    const yawSignal = right.x * nx + right.y * ny + right.z * nz;
    const pitchSignal = up.x * nx + up.y * ny + up.z * nz;
    const aimDot = forward.x * nx + forward.y * ny + forward.z * nz;
    return {
        yaw: Math.abs(yawSignal) > yawDeadzone ? (yawSignal > 0 ? 1 : -1) : 0,
        pitch: Math.abs(pitchSignal) > pitchDeadzone ? (pitchSignal > 0 ? 1 : -1) : 0,
        aimDot,
    };
}

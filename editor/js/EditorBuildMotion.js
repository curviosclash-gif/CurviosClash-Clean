import * as THREE from 'three';

export const BUILD_SPEED_FACTORS = Object.freeze([0.25, 0.5, 1, 2, 4]);

export function createBuildPose(position = new THREE.Vector3(), quaternion = new THREE.Quaternion()) {
    const angles = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');
    return { position: position.clone(), quaternion: quaternion.clone(), yaw: angles.y, pitch: angles.x,
        movement: new THREE.Vector3(), rotation: new THREE.Euler(0, 0, 0, 'YXZ') };
}

export function stepBuildPose(pose, codes, { dt, speed, lookX = 0, lookY = 0, enabled = true }) {
    if (!enabled) return 0;
    const seconds = Math.min(0.1, Math.max(0, Number(dt) || 0));
    pose.yaw -= lookX * 0.0022;
    pose.pitch = THREE.MathUtils.clamp(pose.pitch - lookY * 0.0022, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    pose.quaternion.setFromEuler(pose.rotation.set(pose.pitch, pose.yaw, 0));
    const axis = (positive, negative) => Number(codes.has(positive)) - Number(codes.has(negative));
    pose.movement.set(axis('KeyD', 'KeyA'), 0, axis('KeyS', 'KeyW'));
    pose.movement.applyQuaternion(pose.quaternion);
    pose.movement.y += Number(codes.has('Space')) - Number(codes.has('ShiftLeft') || codes.has('ShiftRight'));
    if (pose.movement.lengthSq() === 0) return 0;
    pose.movement.normalize();
    const velocity = Math.max(0, Number(speed) || 0);
    pose.position.addScaledVector(pose.movement, velocity * seconds);
    return velocity;
}

export function resolveBuildPosition(position, snapSize = 0, target = new THREE.Vector3()) {
    target.copy(position);
    if (Number.isFinite(snapSize) && snapSize > 0) {
        target.set(Math.round(position.x / snapSize) * snapSize,
            Math.round(position.y / snapSize) * snapSize, Math.round(position.z / snapSize) * snapSize);
    }
    return target;
}

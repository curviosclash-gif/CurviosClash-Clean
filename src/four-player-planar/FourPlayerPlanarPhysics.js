import { isFourPlayerPlanarRuntime } from './FourPlayerPlanarContract.js';

export function applyFourPlayerPlanarPhysicsConstraint(player) {
    if (!player || !isFourPlayerPlanarRuntime(player?.entityManager?.runtimeConfig)) return false;
    const planarY = Number.isFinite(Number(player.currentPlanarY)) ? Number(player.currentPlanarY) : 0;
    player.position.y = planarY;
    player.velocity.y = 0;
    player._tmpEuler2.setFromQuaternion(player.quaternion, 'YXZ');
    player._tmpEuler2.x = 0;
    player.quaternion.setFromEuler(player._tmpEuler2).normalize();
    return true;
}

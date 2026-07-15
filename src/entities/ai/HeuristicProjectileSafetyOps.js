import { WORLD_UP } from './HeuristicBotPolicyOps.js';

export function resolveDirectionalProjectileThreat(policy, state, player, runtimeContext, config) {
    state.projectileYaw = 0;
    state.projectilePitch = 0;
    state.projectileTimeToImpact = Infinity;
    const projectiles = runtimeContext?.projectiles;
    if (!Array.isArray(projectiles) || projectiles.length === 0 || !player?.position) return false;

    if (typeof player.getDirection === 'function') {
        player.getDirection(policy._tmpForward);
        if (policy._tmpForward.lengthSq() > 0.000001) policy._tmpForward.normalize();
        else policy._tmpForward.set(0, 0, 1);
    } else {
        policy._tmpForward.set(0, 0, 1);
    }
    policy._tmpRight.crossVectors(WORLD_UP, policy._tmpForward);
    if (policy._tmpRight.lengthSq() <= 0.000001) policy._tmpRight.set(1, 0, 0);
    else policy._tmpRight.normalize();
    policy._tmpUp.crossVectors(policy._tmpForward, policy._tmpRight);
    if (policy._tmpUp.lengthSq() <= 0.000001) policy._tmpUp.copy(WORLD_UP);
    else policy._tmpUp.normalize();

    const playerSpeed = Number(player.speed) || 0;
    const maxRangeSq = config.projectileThreatRange ** 2;
    for (let i = 0; i < projectiles.length; i += 1) {
        const projectile = projectiles[i];
        if (!projectile?.position || !projectile?.velocity || projectile.owner === player) continue;
        policy._tmpProjectileRelative.subVectors(projectile.position, player.position);
        if (policy._tmpProjectileRelative.lengthSq() > maxRangeSq) continue;
        policy._tmpProjectileVelocity.copy(projectile.velocity)
            .addScaledVector(policy._tmpForward, -playerSpeed);
        const relativeSpeedSq = policy._tmpProjectileVelocity.lengthSq();
        if (relativeSpeedSq <= 0.000001) continue;
        const timeToImpact = -policy._tmpProjectileRelative.dot(policy._tmpProjectileVelocity) / relativeSpeedSq;
        if (timeToImpact < 0 || timeToImpact > config.projectileImpactHorizon) continue;

        policy._tmpEvade.copy(policy._tmpProjectileRelative)
            .addScaledVector(policy._tmpProjectileVelocity, timeToImpact);
        const projectileRadius = Math.max(0, Number(projectile.hitboxRadius ?? projectile.radius) || 0);
        const safetyRadius = Math.max(0.1, Number(player.hitboxRadius) || 0.8)
            + projectileRadius
            + config.projectileSafetyRadius;
        if (policy._tmpEvade.lengthSq() > safetyRadius * safetyRadius) continue;
        if (timeToImpact >= state.projectileTimeToImpact) continue;

        if (policy._tmpEvade.lengthSq() <= 0.000001) {
            policy._tmpEvade.crossVectors(policy._tmpProjectileVelocity, WORLD_UP);
            if (policy._tmpEvade.lengthSq() <= 0.000001) policy._tmpEvade.copy(policy._tmpRight);
        } else {
            policy._tmpEvade.multiplyScalar(-1);
        }
        policy._tmpEvade.normalize();
        const yawSignal = policy._tmpRight.dot(policy._tmpEvade);
        const pitchSignal = policy._tmpUp.dot(policy._tmpEvade);
        state.projectileYaw = Math.abs(yawSignal) > 0.08 ? (yawSignal > 0 ? 1 : -1) : 0;
        state.projectilePitch = !state.planarMode && Math.abs(pitchSignal) > 0.08
            ? (pitchSignal > 0 ? 1 : -1)
            : 0;
        state.projectileTimeToImpact = timeToImpact;
    }
    return state.projectileTimeToImpact < Infinity;
}

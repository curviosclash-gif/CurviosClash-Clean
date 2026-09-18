import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

function axis(input, key, positive, negative) {
    const analog = Number(input?.[key]);
    if (Number.isFinite(analog)) return THREE.MathUtils.clamp(analog, -1, 1);
    return Number(input?.[positive] === true) - Number(input?.[negative] === true);
}

/** Copy an owner's normal flight axes onto the rocket without keeping the input object. */
export function applyGuidedRocketInput(projectile, input, config = {}) {
    if (!projectile) return;
    projectile.steerYaw = axis(input, 'yawAxis', 'yawRight', 'yawLeft');
    projectile.steerPitch = axis(input, 'pitchAxis', 'pitchUp', 'pitchDown');
    if (input?.boostPressed === true && projectile.boostUsed !== true) {
        projectile.boostUsed = true;
        projectile.boostRemaining = Math.max(0, Number(config.GUIDED_BOOST_SECONDS) || 2);
    }
}

/** Turn and set speed before the ordinary projectile step moves and collides. */
export function stepGuidedRocket(projectile, dt, config = {}, scratchRight) {
    if (!projectile || !(dt > 0)) return;
    const velocity = projectile.velocity;
    if (velocity.lengthSq() < 0.000001) velocity.set(1, 0, 0);
    const speed = Math.max(1, Number(config.GUIDED_SPEED) || 70);
    const boostLeft = Math.max(0, Number(projectile.boostRemaining) || 0);
    const boostShare = Math.min(1, boostLeft / dt);
    const multiplier = Math.max(1, Number(config.GUIDED_BOOST_MULTIPLIER) || 1.5);
    const turnRate = Math.max(0, Number(config.GUIDED_TURN_RATE) || 2.5);
    const boostTurnRate = Math.max(0, Number(config.GUIDED_BOOST_TURN_RATE) || 1.8);
    const effectiveTurnRate = turnRate + (boostTurnRate - turnRate) * boostShare;
    velocity.normalize().applyAxisAngle(UP, (Number(projectile.steerYaw) || 0) * effectiveTurnRate * dt);
    scratchRight.crossVectors(velocity, UP);
    if (scratchRight.lengthSq() < 0.000001) scratchRight.set(0, 0, 1);
    else scratchRight.normalize();
    velocity.applyAxisAngle(scratchRight, (Number(projectile.steerPitch) || 0) * effectiveTurnRate * dt);
    velocity.normalize().multiplyScalar(speed * (1 + (multiplier - 1) * boostShare));
    projectile.boostRemaining = Math.max(0, boostLeft - dt);
}

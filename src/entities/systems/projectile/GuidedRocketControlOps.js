import * as THREE from 'three';
import { resolveGameplayConfig } from '../../../shared/contracts/GameplayConfigContract.js';

const UP = new THREE.Vector3(0, 1, 0);

function axis(input, key, positive, negative) {
    const analog = Number(input?.[key]);
    if (Number.isFinite(analog)) return THREE.MathUtils.clamp(analog, -1, 1);
    return Number(input?.[positive] === true) - Number(input?.[negative] === true);
}

/** Copy an owner's normal flight axes onto the rocket without keeping the input object. */
export function applyGuidedRocketInput(projectile, input, config = {}) {
    if (!projectile) return;
    const owner = projectile.owner;
    let yaw = axis(input, 'yawAxis', 'yawLeft', 'yawRight');
    let pitch = axis(input, 'pitchAxis', 'pitchUp', 'pitchDown');
    // The rocket answers the stick exactly like the owner's ship (PlayerController): the menu's
    // pitch inversion, the INVERT item and the planar mode apply to both.
    if (owner?.invertPitchBase) pitch = -pitch;
    if (owner?.invertControls) {
        pitch = -pitch;
        yaw = -yaw;
    }
    if (owner && resolveGameplayConfig(owner).GAMEPLAY.PLANAR_MODE) pitch = 0;
    projectile.steerYaw = yaw;
    projectile.steerPitch = pitch;
    if (input?.boostPressed === true && projectile.boostUsed !== true) {
        projectile.boostUsed = true;
        projectile.boostRemaining = Math.max(0, Number(config.GUIDED_BOOST_SECONDS) || 2);
    }
}

/** The fire key pressed again while steering lets go of the rocket. */
export function wantsGuidedRocketRelease(input) {
    return input?.shootRocket === true || input?.shootItem === true;
}

/** Hand a steered rocket to the ordinary homing: it keeps heading and speed and picks its own target. */
export function releaseGuidedRocket(projectile, acquireTarget) {
    if (!projectile?.guidedActive) return false;
    projectile.guidedActive = false;
    projectile.steerYaw = 0;
    projectile.steerPitch = 0;
    projectile.boostRemaining = 0;
    projectile.homingEnabled = true;
    projectile.targetReacquireDisabled = false;
    projectile.homingReacquireTimer = 0;
    projectile.target = acquireTarget?.(projectile) || null;
    return true;
}

export function findGuidedRocketForOwner(projectiles, owner) {
    return projectiles.find((projectile) => projectile.guidedActive && projectile.owner === owner) || null;
}

/** Route one owner's flight input to their steered rocket; false when they steer none. */
export function applyGuidedOwnerInput(system, owner, input) {
    const projectile = findGuidedRocketForOwner(system.projectiles, owner);
    if (!projectile) return false;
    // The press that lets go is swallowed, so it never fires the next rocket as well.
    if (wantsGuidedRocketRelease(input)) {
        releaseGuidedRocket(projectile, (rocket) => system._acquireHomingTarget(
            rocket, system.getPlayers(), system.getTrailSpatialIndex()));
        return true;
    }
    applyGuidedRocketInput(projectile, input, system.entityRuntimeConfig?.HUNT?.ROCKET);
    return true;
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

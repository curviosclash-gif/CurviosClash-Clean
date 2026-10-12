import { applySteeringTowardPosition } from '../../hunt/HuntBotPolicy.js';
import { clamp } from '../../shared/utils/MathOps.js';
import {
    WORLD_UP,
    resolveStableStrafeRight,
} from './HeuristicBotPolicyOps.js';

const NEUTRAL_TACTIC_BIAS = 0.5;
const VEHICLE_APPROACH_HORIZON_SECONDS = 1.1;
const VEHICLE_CRASH_DISTANCE = 7;

// Hunt: crashes only cost health, so steering clear is a tunable tactic.
export function findImminentTrafficThreat(policy, player, players) {
    if (Number(policy?.profile?.trafficAvoidanceBias) <= NEUTRAL_TACTIC_BIAS) return null;
    return findVehicleCollisionCourse(player, players);
}

// The vehicle whose flight path meets this one first within the next second, or null.
export function findVehicleCollisionCourse(player, players) {
    if (!player?.position || !player?.velocity || !Array.isArray(players)) return null;
    let selected = null;
    let selectedTime = Infinity;
    for (const other of players) {
        // Ghost replays never collide (PlayerCollisionPhase skips them), so they are no threat.
        if (!other || other === player || other.alive === false || other.isGhost === true
            || !other.position || !other.velocity) continue;
        const relativeX = Number(other.position.x) - Number(player.position.x);
        const relativeY = Number(other.position.y) - Number(player.position.y);
        const relativeZ = Number(other.position.z) - Number(player.position.z);
        const velocityX = Number(other.velocity.x) - Number(player.velocity.x);
        const velocityY = Number(other.velocity.y) - Number(player.velocity.y);
        const velocityZ = Number(other.velocity.z) - Number(player.velocity.z);
        const velocitySq = velocityX * velocityX + velocityY * velocityY + velocityZ * velocityZ;
        if (!(velocitySq > 0.000001)) continue;
        const approachTime = clamp(
            -(relativeX * velocityX + relativeY * velocityY + relativeZ * velocityZ) / velocitySq,
            0,
            VEHICLE_APPROACH_HORIZON_SECONDS
        );
        const closestX = relativeX + velocityX * approachTime;
        const closestY = relativeY + velocityY * approachTime;
        const closestZ = relativeZ + velocityZ * approachTime;
        const closestDistanceSq = closestX * closestX + closestY * closestY + closestZ * closestZ;
        if (approachTime > 0.02 && closestDistanceSq < VEHICLE_CRASH_DISTANCE * VEHICLE_CRASH_DISTANCE && approachTime < selectedTime) {
            selected = other;
            selectedTime = approachTime;
        }
    }
    return selected;
}

export function applyTrafficAvoidanceSteering(policy, input, player, threat) {
    if (!player?.position || !threat?.position) return;
    policy._tmpGate.subVectors(player.position, threat.position);
    if (policy._tmpGate.lengthSq() <= 0.000001) {
        if (typeof player.getDirection === 'function') player.getDirection(policy._tmpForward);
        else policy._tmpForward.set(0, 0, -1);
        policy._tmpRight.crossVectors(WORLD_UP, policy._tmpForward);
        if (policy._tmpRight.lengthSq() <= 0.000001) policy._tmpRight.set(1, 0, 0);
        else policy._tmpRight.normalize();
        policy._tmpGate.copy(policy._tmpRight)
            .multiplyScalar(resolveStableStrafeRight(player) ? 1 : -1);
    } else {
        policy._tmpGate.normalize();
    }
    if (typeof player.getDirection === 'function') player.getDirection(policy._tmpForward);
    else policy._tmpForward.set(0, 0, -1);
    if (policy._tmpForward.lengthSq() <= 0.000001) policy._tmpForward.set(0, 0, -1);
    else policy._tmpForward.normalize();
    policy._tmpTarget.copy(player.position)
        .addScaledVector(policy._tmpForward, 12)
        .addScaledVector(policy._tmpGate, 18);
    applySteeringTowardPosition(policy, input, player, policy._tmpTarget);
}

// Safety evade: which yaw/pitch side leads away from the closest approach of `threat`
// (+1 = along the probe basis right/up, as the projectile dodge counts it, 0 = no preference).
export function resolveVehicleEvadeTurn(policy, state, player, threat) {
    state.vehicleYaw = 0;
    state.vehiclePitch = 0;
    if (!player?.position || !player?.velocity || !threat?.position || !threat?.velocity) return;
    if (typeof player.getDirection === 'function') player.getDirection(policy._tmpForward);
    else policy._tmpForward.set(0, 0, 1);
    if (policy._tmpForward.lengthSq() <= 0.000001) policy._tmpForward.set(0, 0, 1);
    else policy._tmpForward.normalize();
    policy._tmpRight.crossVectors(WORLD_UP, policy._tmpForward);
    if (policy._tmpRight.lengthSq() <= 0.000001) policy._tmpRight.set(1, 0, 0);
    else policy._tmpRight.normalize();
    policy._tmpUp.crossVectors(policy._tmpForward, policy._tmpRight);
    if (policy._tmpUp.lengthSq() <= 0.000001) policy._tmpUp.copy(WORLD_UP);
    else policy._tmpUp.normalize();

    const relative = policy._tmpProjectileRelative.subVectors(threat.position, player.position);
    const relativeVelocity = policy._tmpProjectileVelocity.subVectors(threat.velocity, player.velocity);
    const velocitySq = relativeVelocity.lengthSq();
    const approachTime = velocitySq > 0.000001
        ? clamp(-relative.dot(relativeVelocity) / velocitySq, 0, VEHICLE_APPROACH_HORIZON_SECONDS)
        : 0;
    const away = policy._tmpEvade.copy(relative).addScaledVector(relativeVelocity, approachTime).multiplyScalar(-1);
    // Dead-on: each side sees the opposite relative velocity, so the pair turns to opposite sides.
    if (away.lengthSq() <= 0.000001) away.crossVectors(relativeVelocity, WORLD_UP);
    if (away.lengthSq() <= 0.000001) return;
    away.normalize();
    const yawSignal = policy._tmpRight.dot(away);
    const pitchSignal = policy._tmpUp.dot(away);
    state.vehicleYaw = Math.abs(yawSignal) > 0.08 ? Math.sign(yawSignal) : 0;
    state.vehiclePitch = !state.planarMode && Math.abs(pitchSignal) > 0.08 ? Math.sign(pitchSignal) : 0;
}

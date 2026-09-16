import { applySteeringTowardPosition } from '../../hunt/HuntBotPolicy.js';
import { clamp } from '../../shared/utils/MathOps.js';
import {
    WORLD_UP,
    resolveStableStrafeRight,
} from './HeuristicBotPolicyOps.js';

const NEUTRAL_TACTIC_BIAS = 0.5;

export function findImminentTrafficThreat(policy, player, players) {
    if (Number(policy?.profile?.trafficAvoidanceBias) <= NEUTRAL_TACTIC_BIAS
        || !player?.position || !player?.velocity) return null;
    let selected = null;
    let selectedTime = Infinity;
    for (const other of players) {
        if (!other || other === player || other.alive === false || !other.position || !other.velocity) continue;
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
            1.1
        );
        const closestX = relativeX + velocityX * approachTime;
        const closestY = relativeY + velocityY * approachTime;
        const closestZ = relativeZ + velocityZ * approachTime;
        const closestDistanceSq = closestX * closestX + closestY * closestY + closestZ * closestZ;
        if (approachTime > 0.02 && closestDistanceSq < 7 * 7 && approachTime < selectedTime) {
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

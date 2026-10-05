import * as THREE from 'three';
import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';
import { clamp } from '../shared/utils/MathOps.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export function clearSteeringInput(input) {
    input.pitchAxis = undefined;
    input.yawAxis = undefined;
    input.rollAxis = undefined;
    input.yawLeft = false;
    input.yawRight = false;
    input.pitchUp = false;
    input.pitchDown = false;
}

export function applySteeringTowardPosition(policy, input, player, targetPosition, options = null) {
    if (!targetPosition || !player?.position) return;
    const planarMode = !!resolveGameplayConfig(player).GAMEPLAY.PLANAR_MODE;
    policy._tmpGate.subVectors(targetPosition, player.position);
    if (policy._tmpGate.lengthSq() <= 0.000001) return;
    policy._tmpGate.normalize();
    player.getDirection(policy._tmpForward).normalize();
    policy._tmpRight.crossVectors(WORLD_UP, policy._tmpForward);
    if (policy._tmpRight.lengthSq() <= 0.000001) policy._tmpRight.set(1, 0, 0);
    else policy._tmpRight.normalize();
    policy._tmpUp.crossVectors(policy._tmpForward, policy._tmpRight).normalize();

    const yawTowardTarget = policy._tmpRight.dot(policy._tmpGate);
    const precision = options?.precision === true;
    if (precision) {
        const gain = Math.max(0.1, Number(options?.gain) || 4);
        input.yawLeft = false;
        input.yawRight = false;
        if (Math.abs(yawTowardTarget) > 0.0001) input.yawAxis = clamp(yawTowardTarget * gain, -1, 1);
        else if (policy._tmpForward.dot(policy._tmpGate) < 0) {
            input.yawAxis = ((Number(player.index) || 0) & 1) === 0 ? 1 : -1;
        } else input.yawAxis = 0;
    } else if (Math.abs(yawTowardTarget) > 0.03) {
        input.yawLeft = yawTowardTarget > 0;
        input.yawRight = yawTowardTarget < 0;
    } else if (policy._tmpForward.dot(policy._tmpGate) < 0) {
        input.yawLeft = ((Number(player.index) || 0) & 1) === 0;
        input.yawRight = !input.yawLeft;
    }

    if (!planarMode) {
        const pitchTowardTarget = policy._tmpUp.dot(policy._tmpGate);
        if (precision) {
            const gain = Math.max(0.1, Number(options?.gain) || 4);
            input.pitchUp = false;
            input.pitchDown = false;
            input.pitchAxis = Math.abs(pitchTowardTarget) > 0.0001
                ? clamp(pitchTowardTarget * gain, -1, 1) : 0;
        } else if (Math.abs(pitchTowardTarget) > 0.07) {
            input.pitchUp = pitchTowardTarget > 0;
            input.pitchDown = pitchTowardTarget < 0;
        }
    }
}

function resolveSensorYawPitch(snapshot) {
    const yaw = Number.isFinite(snapshot?.targetYaw) ? snapshot.targetYaw : 0;
    const pitch = Number.isFinite(snapshot?.targetPitch) ? snapshot.targetPitch : 0;
    return { yaw, pitch };
}

export function applyRetreatSteeringFallback(policy, input, player, enemy) {
    if (!player?.position) return;
    const retreatDistance = 24;
    if (enemy?.position) {
        policy._tmpGate.subVectors(player.position, enemy.position);
        if (policy._tmpGate.lengthSq() > 0.000001) {
            policy._tmpGate.normalize().multiplyScalar(retreatDistance).add(player.position);
            applySteeringTowardPosition(policy, input, player, policy._tmpGate);
            return;
        }
    }
    if (typeof player.getDirection === 'function') {
        player.getDirection(policy._tmpForward);
    } else {
        policy._tmpForward.set(0, 0, 1);
    }
    if (policy._tmpForward.lengthSq() <= 0.000001) {
        policy._tmpForward.set(0, 0, 1);
    } else {
        policy._tmpForward.normalize();
    }
    policy._tmpGate.copy(player.position).addScaledVector(policy._tmpForward, retreatDistance);
    applySteeringTowardPosition(policy, input, player, policy._tmpGate);
}

export function applyRetreatSteeringFromSensors(input, snapshot, player) {
    const planarMode = !!resolveGameplayConfig(player).GAMEPLAY.PLANAR_MODE;
    const steering = resolveSensorYawPitch(snapshot);
    // snapshot.targetYaw traegt dieselbe Zuordnung wie applySteeringTowardPosition, also
    // "zum Gegner hin". Der Rueckzug braucht das Gegenteil: Vorzeichen umdrehen. Beim Pitch
    // steht die umgedrehte Zuordnung schon unten.
    if (Math.abs(steering.yaw) > 0.01) {
        input.yawLeft = steering.yaw < 0;
        input.yawRight = steering.yaw > 0;
    }
    if (!planarMode && Math.abs(steering.pitch) > 0.01) {
        input.pitchUp = steering.pitch < 0;
        input.pitchDown = steering.pitch > 0;
    }
}

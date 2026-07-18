import * as THREE from 'three';
import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';
import { clamp } from '../utils/MathOps.js';

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

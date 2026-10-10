import * as THREE from 'three';
import { canTargetEnemy } from '../../shared/contracts/TeamCombatContract.js';

const DIRECTIONS = [-1, 0, 1];
const STEP_SECONDS = 0.06;
const TURN_SECONDS = 0.3;
const HORIZON_SECONDS = 1.5;
const NOSE_OFFSET = 4;
const HISTORY_SAMPLES = 48;
const FULL_PATH_BONUS = 10;

export function isSoloVolumeFlight(runtimeContext, player) {
    if (!player || runtimeContext?.rules?.planarMode !== false) return false;
    if (runtimeContext.mode !== 'CLASSIC' && runtimeContext.mode !== 'HUNT') return false;
    const players = runtimeContext.navigationPlayers || runtimeContext.players;
    if (!Array.isArray(players)) return false;
    for (const other of players) {
        if (other?.alive && canTargetEnemy(player, other)) return false;
    }
    return true;
}

// A short dynamic-window rollout: score paths the ship can actually fly at its current
// speed and turn rate. Straight ray probes treat a sideways opening as immediately
// reachable, even though the ship must first travel through its turning arc.
export class SoloFlightController {
    constructor() {
        this.position = new THREE.Vector3();
        this.forward = new THREE.Vector3();
        this.probe = new THREE.Vector3();
        this.orientation = new THREE.Quaternion();
        this.turn = new THREE.Quaternion();
        this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
        this.lastYaw = 0;
        this.lastPitch = 0;
        this.holdUntil = 0;
        this.clock = 0;
        this.history = Array.from({ length: HISTORY_SAMPLES }, () => new THREE.Vector3());
        this.historyCount = 0;
        this.historyWrite = 0;
        this.nextSampleAt = 0;
    }

    reset() {
        this.lastYaw = 0;
        this.lastPitch = 0;
        this.holdUntil = 0;
        this.clock = 0;
        this.historyCount = 0;
        this.historyWrite = 0;
        this.nextSampleAt = 0;
    }

    _clear(player, arena, manager, wallRadius, trailRadius, skipRecent) {
        const wallCheck = arena?.checkBotCollisionFast || arena?.checkCollisionFast;
        if (typeof wallCheck === 'function') {
            if (wallCheck.call(arena, this.position, wallRadius)) return false;
            this.probe.copy(this.position).addScaledVector(this.forward, NOSE_OFFSET);
            if (wallCheck.call(arena, this.probe, wallRadius)) return false;
        }
        return !manager?.checkGlobalCollision?.(
            this.position, trailRadius, player.index, skipRecent, null
        )?.hit;
    }

    _score(player, arena, manager, yaw, pitch, speed, turnSpeed, wallRadius, trailRadius, skipRecent) {
        this.position.copy(player.position);
        this.orientation.copy(player.quaternion);
        let clearTime = HORIZON_SECONDS;
        for (let elapsed = STEP_SECONDS; elapsed <= HORIZON_SECONDS + 0.00001; elapsed += STEP_SECONDS) {
            const steering = elapsed <= TURN_SECONDS + 0.00001;
            this.euler.set(steering ? pitch * turnSpeed * STEP_SECONDS : 0,
                steering ? yaw * turnSpeed * STEP_SECONDS : 0, 0, 'YXZ');
            this.turn.setFromEuler(this.euler);
            this.orientation.multiply(this.turn);
            this.forward.set(0, 0, -1).applyQuaternion(this.orientation);
            this.position.addScaledVector(this.forward, speed * STEP_SECONDS);
            if (!this._clear(player, arena, manager, wallRadius, trailRadius, skipRecent)) {
                clearTime = elapsed - STEP_SECONDS;
                break;
            }
        }
        // Prefer useful forward motion in clear space, and retain a chosen escape long
        // enough to avoid left/right chatter. Neither term can outweigh a real collision.
        let novelty = 0;
        if (clearTime === HORIZON_SECONDS) {
            let nearestSq = Infinity;
            for (let i = 0; i < this.historyCount; i++) {
                const distanceSq = this.position.distanceToSquared(this.history[i]);
                if (distanceSq < nearestSq) nearestSq = distanceSq;
            }
            if (Number.isFinite(nearestSq)) novelty = Math.min(8, Math.sqrt(nearestSq) * 0.2);
        }
        return clearTime * 100 + (clearTime === HORIZON_SECONDS ? FULL_PATH_BONUS : 0)
            + novelty - (Math.abs(yaw) + Math.abs(pitch)) * 2
            + (yaw === this.lastYaw ? 1 : 0) + (pitch === this.lastPitch ? 1 : 0);
    }

    update(action, dt, player, runtimeContext) {
        this.clock += Math.max(0, Number(dt) || 0);
        const arena = runtimeContext.arena;
        const manager = player.trail?.entityManager;
        if (!arena || !manager || !player.quaternion) return action;
        const speed = Math.max(1, Number(player.speed) || Number(player.baseSpeed) || 45);
        const turnSpeed = Math.max(0.1, Number(player.turnSpeed) || 3.4);
        const wallRadius = Math.max(0.2, Number(player.arcadeAvoidRadius || player.hitboxRadius) || 0.8);
        const trailRadius = wallRadius * 2;
        const skipRecent = manager.constructor?.deriveSelfTrailSkipRecentSegments?.(player) ?? 20;
        if (this.clock >= this.nextSampleAt) {
            this.history[this.historyWrite].copy(player.position);
            this.historyWrite = (this.historyWrite + 1) % HISTORY_SAMPLES;
            this.historyCount = Math.min(HISTORY_SAMPLES, this.historyCount + 1);
            this.nextSampleAt = this.clock + 2;
        }
        let bestYaw = 0;
        let bestPitch = 0;
        let bestScore = -Infinity;
        let heldScore = -Infinity;

        for (const pitch of DIRECTIONS) {
            for (const yaw of DIRECTIONS) {
                const score = this._score(player, arena, manager, yaw, pitch, speed, turnSpeed,
                    wallRadius, trailRadius, skipRecent);
                if (yaw === this.lastYaw && pitch === this.lastPitch) heldScore = score;
                if (score > bestScore) {
                    bestScore = score;
                    bestYaw = yaw;
                    bestPitch = pitch;
                }
            }
        }
        if (this.clock < this.holdUntil && heldScore >= HORIZON_SECONDS * 100 + FULL_PATH_BONUS - 4
            && heldScore >= bestScore - 4) {
            bestYaw = this.lastYaw;
            bestPitch = this.lastPitch;
        }
        if (bestYaw !== this.lastYaw || bestPitch !== this.lastPitch) {
            this.holdUntil = this.clock + 0.12;
        }
        this.lastYaw = bestYaw;
        this.lastPitch = bestPitch;
        action.yawLeft = bestYaw > 0;
        action.yawRight = bestYaw < 0;
        action.pitchUp = bestPitch > 0;
        action.pitchDown = bestPitch < 0;
        action.yawAxis = undefined;
        action.pitchAxis = undefined;
        action.boost = false;
        return action;
    }
}

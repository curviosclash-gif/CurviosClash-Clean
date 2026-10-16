import * as THREE from 'three';
import { canTargetEnemy } from '../../shared/contracts/TeamCombatContract.js';
import { resolveEntityRuntimeConfig } from '../../shared/contracts/EntityRuntimeConfig.js';

const DIRECTIONS = [-1, 0, 1];
const STEP_SECONDS = 0.03;
const TURN_SECONDS = 0.3;
const GUARD_TURN_SECONDS = 0.5;
const HORIZON_SECONDS = 1.5;
const NOSE_OFFSET = 4;
const HISTORY_SAMPLES = 48;
const FULL_PATH_BONUS = 10;
const SAFETY_IMPROVEMENT_SECONDS = 0.12;

function resolveTurnSpeed(player, manager, pitch = false) {
    const modeMultiplier = Number(manager?.gameModeStrategy?.getTurnRateMultiplier?.(player));
    const waterMultiplier = Number(player.waterTurnMultiplier);
    return Math.max(0.1, Number(pitch ? player.pitchTurnSpeed ?? player.turnSpeed : player.turnSpeed) || 3.4)
        * (Number.isFinite(modeMultiplier) ? Math.max(0.1, modeMultiplier) : 1)
        * (Number.isFinite(waterMultiplier) ? Math.max(0.1, waterMultiplier) : 1);
}

function readSteering(action, axisKey, positiveKey, negativeKey) {
    const axis = Number(action?.[axisKey]);
    if (action?.[axisKey] != null && Number.isFinite(axis)) return Math.max(-1, Math.min(1, axis));
    return Number(action?.[positiveKey] === true) - Number(action?.[negativeKey] === true);
}

function applyFlightSteering(action, player, yaw, pitch, planarMode = false) {
    const inputYaw = yaw * (player.invertControls ? -1 : 1);
    const inputPitch = pitch * (player.invertControls ? -1 : 1) * (player.invertPitchBase ? -1 : 1);
    action.yawLeft = inputYaw > 0;
    action.yawRight = inputYaw < 0;
    action.pitchUp = !planarMode && inputPitch > 0;
    action.pitchDown = !planarMode && inputPitch < 0;
    action.yawAxis = undefined;
    action.pitchAxis = undefined;
    action.rollAxis = undefined;
    action.rollLeft = false;
    action.rollRight = false;
    action.boost = false;
    return action;
}

export function isSoloVolumeFlight(runtimeContext, player) {
    if (!player || runtimeContext?.rules?.planarMode !== false) return false;
    if (runtimeContext.mode !== 'CLASSIC' && runtimeContext.mode !== 'HUNT') return false;
    if (runtimeContext.flagObjectives?.length || runtimeContext.escortObjective) return false;
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
        this.clearTime = HORIZON_SECONDS;
        this.lastSimulationMs = null;
        this.lastSpawnAt = null;
    }

    reset() {
        this.lastYaw = 0;
        this.lastPitch = 0;
        this.holdUntil = 0;
        this.clock = 0;
        this.historyCount = 0;
        this.historyWrite = 0;
        this.nextSampleAt = 0;
        this.lastSimulationMs = null;
        this.lastSpawnAt = null;
    }

    _clear(player, arena, manager, wallRadius, trailRadius, skipRecent) {
        const wallCheck = arena?.checkBotCollisionFast || arena?.checkCollisionFast || arena?.checkCollision;
        if (typeof wallCheck === 'function') {
            if (wallCheck.call(arena, this.position, wallRadius)) return false;
            this.probe.copy(this.position).addScaledVector(this.forward, NOSE_OFFSET);
            if (wallCheck.call(arena, this.probe, wallRadius)) return false;
        }
        return !manager?.checkGlobalCollision?.(
            this.position, trailRadius, player.index, skipRecent, null
        )?.hit;
    }

    _score(player, arena, manager, yaw, pitch, speed, turnSpeed, wallRadius, trailRadius, skipRecent,
        planarMode = false, turnSeconds = TURN_SECONDS) {
        const pitchTurnSpeed = resolveTurnSpeed(player, manager, true);
        this.position.copy(player.position);
        this.orientation.copy(player.quaternion);
        let clearTime = HORIZON_SECONDS;
        // Overlap the smallest collision spheres even at boost speed, including the horizon.
        const steps = Math.ceil(HORIZON_SECONDS / Math.min(STEP_SECONDS,
            Math.min(wallRadius, trailRadius) * 1.5 / speed));
        const stepSeconds = HORIZON_SECONDS / steps;
        for (let step = 1; step <= steps; step += 1) {
            const elapsed = step * stepSeconds;
            const steering = elapsed <= turnSeconds + 0.00001;
            this.euler.set(steering && !planarMode ? pitch * pitchTurnSpeed * stepSeconds : 0,
                steering ? yaw * turnSpeed * stepSeconds : 0, 0, 'YXZ');
            this.turn.setFromEuler(this.euler);
            this.orientation.multiply(this.turn);
            if (planarMode) {
                this.euler.setFromQuaternion(this.orientation, 'YXZ');
                this.euler.x = 0;
                this.orientation.setFromEuler(this.euler);
            }
            this.forward.set(0, 0, -1).applyQuaternion(this.orientation);
            this.position.addScaledVector(this.forward, speed * stepSeconds);
            if (planarMode) this.position.y = player.currentPlanarY ?? player.position.y;
            if (!this._clear(player, arena, manager, wallRadius, trailRadius, skipRecent)) {
                clearTime = elapsed - stepSeconds;
                break;
            }
        }
        this.clearTime = clearTime;
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
        const simulationMs = Number(runtimeContext?.entityManager?._simulationClockMs);
        const spawnAt = Number(player?.fightSpawnedAtSeconds);
        if ((Number.isFinite(simulationMs) && this.lastSimulationMs !== null
                && simulationMs < this.lastSimulationMs)
            || (Number.isFinite(spawnAt) && this.lastSpawnAt !== null && spawnAt !== this.lastSpawnAt)) {
            this.reset();
        }
        if (Number.isFinite(simulationMs)) this.lastSimulationMs = simulationMs;
        if (Number.isFinite(spawnAt)) this.lastSpawnAt = spawnAt;
        this.clock += Math.max(0, Number(dt) || 0);
        const arena = runtimeContext?.arena;
        const manager = runtimeContext?.entityManager || player?.trail?.entityManager;
        if (!arena || !manager || !player.quaternion) return action;
        if (!isSoloVolumeFlight(runtimeContext, player)) {
            return this._guardAction(action, player, runtimeContext, arena, manager);
        }
        const speed = Math.max(1, Number(player.speed) || Number(player.baseSpeed) || 45);
        const turnSpeed = resolveTurnSpeed(player, manager);
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
        return applyFlightSteering(action, player, bestYaw, bestPitch);
    }

    _guardAction(action, player, runtimeContext, arena, manager) {
        const planarMode = runtimeContext?.rules?.planarMode === true;
        const minimumImprovement = planarMode ? STEP_SECONDS : SAFETY_IMPROVEMENT_SECONDS;
        const guardTurnSeconds = planarMode ? GUARD_TURN_SECONDS : TURN_SECONDS;
        const baseSpeed = Math.max(1, Number(player.baseSpeed) || Number(player.speed) || 45);
        const normalSpeed = Math.max(1, baseSpeed * (Number(player.waterSpeedMultiplier) || 1)
            * (Number(player.altitudeSpeedFactor) || 1));
        const currentSpeed = Math.max(normalSpeed, Number(player.speed) || 0);
        const boostMultiplier = Number(resolveEntityRuntimeConfig(player).PLAYER.BOOST_MULTIPLIER) || 2;
        const requestedBoost = action.boost === true;
        const plannedSpeed = requestedBoost ? Math.max(currentSpeed, normalSpeed * boostMultiplier) : currentSpeed;
        const candidateSpeed = requestedBoost ? normalSpeed : currentSpeed;
        const turnSpeed = resolveTurnSpeed(player, manager);
        const wallRadius = Math.max(0.2, Number(player.arcadeAvoidRadius || player.hitboxRadius) || 0.8);
        const trailRadius = wallRadius * 2;
        const skipRecent = manager.constructor?.deriveSelfTrailSkipRecentSegments?.(player) ?? 20;
        const invertYaw = player.invertControls ? -1 : 1;
        const invertPitch = (player.invertControls ? -1 : 1) * (player.invertPitchBase ? -1 : 1);
        const yaw = readSteering(action, 'yawAxis', 'yawLeft', 'yawRight') * invertYaw;
        const pitch = planarMode ? 0 : readSteering(action, 'pitchAxis', 'pitchUp', 'pitchDown') * invertPitch;
        this._score(player, arena, manager, yaw, pitch, plannedSpeed, turnSpeed,
            wallRadius, trailRadius, skipRecent, planarMode, guardTurnSeconds);
        let plannedClearTime = this.clearTime;
        if (plannedClearTime === HORIZON_SECONDS) return action;

        // A speed change alone often makes the policy's intended turn safe again.
        if (action.boost) {
            this._score(player, arena, manager, yaw, pitch, normalSpeed, turnSpeed,
                wallRadius, trailRadius, skipRecent, planarMode, guardTurnSeconds);
            if (this.clearTime === HORIZON_SECONDS) {
                action.boost = false;
                return action;
            }
            if (this.clearTime > plannedClearTime + minimumImprovement) {
                action.boost = false;
                plannedClearTime = this.clearTime;
            }
        }

        let bestYaw = yaw;
        let bestPitch = pitch;
        let bestClearTime = plannedClearTime;
        let bestScore = -Infinity;
        for (const candidatePitch of DIRECTIONS) {
            if (planarMode && candidatePitch !== 0) continue;
            for (const candidateYaw of DIRECTIONS) {
                const score = this._score(player, arena, manager, candidateYaw, candidatePitch,
                    candidateSpeed, turnSpeed, wallRadius, trailRadius, skipRecent,
                    planarMode, guardTurnSeconds);
                if (this.clearTime > bestClearTime + 0.00001
                    || (this.clearTime >= bestClearTime - 0.00001 && score > bestScore)) {
                    bestClearTime = this.clearTime;
                    bestScore = score;
                    bestYaw = candidateYaw;
                    bestPitch = candidatePitch;
                }
            }
        }
        if (bestClearTime < plannedClearTime + minimumImprovement) return action;
        this.lastYaw = bestYaw;
        this.lastPitch = bestPitch;
        return applyFlightSteering(action, player, bestYaw, bestPitch, planarMode);
    }
}

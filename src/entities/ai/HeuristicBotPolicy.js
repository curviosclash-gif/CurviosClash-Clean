import * as THREE from 'three';
import {
    LOCAL_OPENNESS_RATIO,
    PRESSURE_LEVEL,
    TARGET_DISTANCE_RATIO,
    WALL_DISTANCE_FRONT,
} from './observation/ObservationSchemaV1.js';
import { BOT_POLICY_TYPES } from './BotPolicyTypes.js';
import {
    applySteeringTowardPosition,
    clearSteeringInput,
} from '../../hunt/HuntBotPolicy.js';
import { FIGHT_TARGET_LOCK_SECONDS } from '../../hunt/FightTargetSelector.js';
import { clamp } from '../../shared/utils/MathOps.js';
import { applyHeuristicClassicBehavior } from './HeuristicClassicTacticsOps.js';
import { applyHeuristicHuntBehavior } from './HeuristicHuntTacticsOps.js';
import { HEURISTIC_DIFFICULTIES, HEURISTIC_PROFILES, hasYaw, normalizeDifficultyName, normalizeProfileName, readObservationValue, readVectorLikePosition, resetInput, resolveInventoryLength, resolveMode, resolveProgressPlayerIndex } from './HeuristicBotPolicyOps.js';
import {
    applyHeuristicObstacleAvoidance,
    applyHeuristicSafetyArbiter,
    createHeuristicSafetyState,
    recordHeuristicBounce,
    resetHeuristicSafetyState,
    resolveBoostPressureCeiling,
} from './HeuristicBotSafetyOps.js';

const FIGHT_BURST_COMMIT_SECONDS = 0.24;

export class HeuristicBotPolicy {
    constructor(options = {}) {
        this.type = BOT_POLICY_TYPES.HEURISTIC;
        this.usesRuntimeContext = true;
        this.requiresObservation = true;
        this.usesObservation = true;
        this.sensePhase = 0;
        this.profileName = normalizeProfileName(
            options.heuristicProfile
            || options.profile
            || options.runtimeConfig?.bot?.heuristicProfile
            || options.runtimeConfig?.bot?.profile
        );
        this.profile = HEURISTIC_PROFILES[this.profileName];
        this.difficultyName = normalizeDifficultyName(
            options.difficulty
            || options.runtimeConfig?.bot?.activeDifficulty
        );
        this.difficulty = HEURISTIC_DIFFICULTIES[this.difficultyName];
        this._input = resetInput({});
        this._decisionSnapshot = {
            mode: 'CLASSIC',
            profile: this.profileName,
            difficulty: this.difficultyName,
            intent: 'avoid',
            pressure: 0,
            boostAllowed: false,
            selectedItemReason: '',
            targetDistanceRatio: 1,
            retreatReason: '',
            safetyState: 'normal',
            safetyReason: '',
            frontClearance: 1,
            intentChanges: 0,
            safetyTransitions: 0,
            steeringChanges: 0,
            safetyActiveRatio: 0,
        };
        this._safetyState = createHeuristicSafetyState();
        this._classicState = {
            intent: 'space-seek',
            commitTimer: 0,
            targetIndex: -1,
        };
        this._huntState = {
            movementIntent: 'search',
            commitTimer: 0,
        };
        this._decisionCounters = {
            updates: 0,
            intentChanges: 0,
            safetyTransitions: 0,
            steeringChanges: 0,
            safetyActiveUpdates: 0,
            lastSteeringSignature: 0,
        };
        this._tmpToEnemy = new THREE.Vector3();
        this._tmpForward = new THREE.Vector3();
        this._tmpRight = new THREE.Vector3();
        this._tmpUp = new THREE.Vector3();
        this._tmpGate = new THREE.Vector3();
        this._tmpTarget = new THREE.Vector3();
        this._tmpAimTarget = new THREE.Vector3();
        this._tmpProjectileRelative = new THREE.Vector3();
        this._tmpProjectileVelocity = new THREE.Vector3();
        this._tmpEvade = new THREE.Vector3();
    }

    _updateSnapshot(mode, intent, pressure, boostAllowed, selectedItemReason, targetDistanceRatio, retreatReason, input) {
        const snapshot = this._decisionSnapshot;
        const counters = this._decisionCounters;
        if (counters.updates > 0 && snapshot.intent !== intent) counters.intentChanges += 1;
        if (counters.updates > 0 && snapshot.safetyState !== this._safetyState.state) counters.safetyTransitions += 1;
        const yawAxis = Number(input?.yawAxis) || 0;
        const pitchAxis = Number(input?.pitchAxis) || 0;
        const steeringSignature = (input?.yawLeft || yawAxis > 0.0001 ? 1 : 0)
            | (input?.yawRight || yawAxis < -0.0001 ? 2 : 0)
            | (input?.pitchUp || pitchAxis > 0.0001 ? 4 : 0)
            | (input?.pitchDown || pitchAxis < -0.0001 ? 8 : 0);
        if (counters.updates > 0 && counters.lastSteeringSignature !== steeringSignature) {
            counters.steeringChanges += 1;
        }
        counters.lastSteeringSignature = steeringSignature;
        counters.updates += 1;
        if (this._safetyState.state === 'evade' || this._safetyState.state === 'recover') {
            counters.safetyActiveUpdates += 1;
        }
        snapshot.mode = mode;
        snapshot.profile = this.profileName;
        snapshot.difficulty = this.difficultyName;
        snapshot.intent = intent;
        snapshot.pressure = pressure;
        snapshot.boostAllowed = boostAllowed === true;
        snapshot.selectedItemReason = selectedItemReason || '';
        snapshot.targetDistanceRatio = targetDistanceRatio;
        snapshot.retreatReason = retreatReason || '';
        snapshot.safetyState = this._safetyState.state;
        snapshot.safetyReason = this._safetyState.reason;
        snapshot.frontClearance = this._safetyState.frontClearance;
        snapshot.intentChanges = counters.intentChanges;
        snapshot.safetyTransitions = counters.safetyTransitions;
        snapshot.steeringChanges = counters.steeringChanges;
        snapshot.safetyActiveRatio = counters.updates > 0 ? counters.safetyActiveUpdates / counters.updates : 0;
    }

    _resolveProfileFromContext(runtimeContext) {
        const nextProfileName = normalizeProfileName(
            runtimeContext?.heuristicProfile
            || runtimeContext?.runtimeConfig?.bot?.heuristicProfile
            || runtimeContext?.runtimeConfig?.bot?.profile
            || this.profileName
        );
        if (nextProfileName !== this.profileName) {
            this.profileName = nextProfileName;
            this.profile = HEURISTIC_PROFILES[nextProfileName];
        }
        const nextDifficultyName = normalizeDifficultyName(
            runtimeContext?.difficulty
            || runtimeContext?.runtimeConfig?.bot?.activeDifficulty
            || this.difficultyName
        );
        if (nextDifficultyName !== this.difficultyName) {
            this.difficultyName = nextDifficultyName;
            this.difficulty = HEURISTIC_DIFFICULTIES[nextDifficultyName];
        }
    }

    _resolveParcoursProgressSnapshot(runtimeContext, player) {
        const explicit = runtimeContext?.parcoursProgress || runtimeContext?.progressSnapshot || runtimeContext?.parcoursProgressSnapshot;
        if (explicit) return explicit;
        const playerIndex = resolveProgressPlayerIndex(player);
        const system = runtimeContext?.parcoursProgressSystem
            || runtimeContext?.entityManager?._parcoursProgressSystem
            || player?.entityManager?._parcoursProgressSystem;
        if (typeof system?.getPlayerProgressSnapshot === 'function') {
            return system.getPlayerProgressSnapshot(playerIndex);
        }
        return null;
    }

    _resolveParcoursRouteSnapshot(runtimeContext, player) {
        const explicit = runtimeContext?.parcoursRoute || runtimeContext?.routeSnapshot || runtimeContext?.parcoursRouteSnapshot;
        if (explicit?.enabled) return explicit;
        if (typeof runtimeContext?.entityManager?.getParcoursRouteSnapshot === 'function') {
            return runtimeContext.entityManager.getParcoursRouteSnapshot();
        }
        if (typeof player?.entityManager?.getParcoursRouteSnapshot === 'function') {
            return player.entityManager.getParcoursRouteSnapshot();
        }
        const system = runtimeContext?.parcoursProgressSystem
            || runtimeContext?.entityManager?._parcoursProgressSystem
            || player?.entityManager?._parcoursProgressSystem;
        if (typeof system?.getRouteSnapshot === 'function') return system.getRouteSnapshot();
        return null;
    }

    _resolveParcoursTarget(runtimeContext, player, out) {
        const progress = this._resolveParcoursProgressSnapshot(runtimeContext, player);
        const route = this._resolveParcoursRouteSnapshot(runtimeContext, player);
        if (route?.enabled) {
            const nextIndex = Math.max(0, Math.trunc(Number(progress?.nextCheckpointIndex) || 0));
            if (nextIndex < Number(route.totalCheckpoints || 0)) {
                const checkpoints = Array.isArray(route.checkpoints) ? route.checkpoints : [];
                for (let i = 0; i < checkpoints.length; i += 1) {
                    const checkpoint = checkpoints[i];
                    if (Number(checkpoint?.routeIndex) !== nextIndex) continue;
                    if (readVectorLikePosition(checkpoint.pos, out)) return true;
                }
            }
            if (route.finish && readVectorLikePosition(route.finish.pos, out)) return true;
        }

        const rings = Array.isArray(runtimeContext?.arena?.checkpointRings) ? runtimeContext.arena.checkpointRings : [];
        for (let i = 0; i < rings.length; i += 1) {
            const ring = rings[i];
            if (ring?.mesh?.userData?.ringState !== 'next') continue;
            if (readVectorLikePosition(ring.pos || ring.mesh?.position, out)) return true;
        }
        return false;
    }

    _applyArcadeBehavior(input, player, runtimeContext, observation) {
        const pressureLevel = clamp(readObservationValue(observation, PRESSURE_LEVEL, 0), 0, 1);
        const wallFront = clamp(readObservationValue(observation, WALL_DISTANCE_FRONT, 1), 0, 1);
        const openness = clamp(readObservationValue(observation, LOCAL_OPENNESS_RATIO, 0), 0, 1);
        const hasTarget = this._resolveParcoursTarget(runtimeContext, player, this._tmpTarget);
        if (!hasTarget || !player?.position) {
            input.shootMG = false;
            return { intent: 'avoid', targetDistanceRatio: 1, selectedItemReason: '', retreatReason: '' };
        }
        clearSteeringInput(input);
        this._tmpGate.subVectors(this._tmpTarget, player.position);
        const distance = this._tmpGate.length();
        const targetDistanceRatio = clamp(distance / 120, 0, 1);
        const directionReady = distance > 0.000001;
        if (directionReady) this._tmpGate.multiplyScalar(1 / distance);
        if (typeof player.getDirection === 'function') {
            player.getDirection(this._tmpForward);
        } else {
            this._tmpForward.set(0, 0, 1);
        }
        if (this._tmpForward.lengthSq() <= 0.000001) {
            this._tmpForward.set(0, 0, 1);
        } else {
            this._tmpForward.normalize();
        }
        const alignment = directionReady ? this._tmpForward.dot(this._tmpGate) : 0;
        applySteeringTowardPosition(this, input, player, this._tmpTarget);
        const turning = hasYaw(input) || input.pitchUp === true || input.pitchDown === true;
        const boostAllowed = (
            alignment > 0.82
            && wallFront > Math.max(this.profile.safetyDistance, 0.34)
            && pressureLevel < resolveBoostPressureCeiling(0.52, this.profile)
            && openness > 0.42
            && !turning
        );
        input.boost = boostAllowed;
        input.shootMG = false;
        input.shootItem = false;
        input.shootItemIndex = -1;
        input.useItem = -1;
        return {
            intent: 'parcours-target',
            targetDistanceRatio,
            selectedItemReason: '',
            retreatReason: wallFront <= this.profile.safetyDistance ? 'wall-pressure' : '',
        };
    }

    update(dt, player, runtimeContext = null) {
        const input = resetInput(this._input);
        if (!player || player.alive === false) return input;
        this._resolveProfileFromContext(runtimeContext);
        const observation = runtimeContext?.observation || null;
        applyHeuristicObstacleAvoidance(this, input, player, observation);

        const mode = resolveMode(runtimeContext, observation);
        const pressureLevel = clamp(readObservationValue(observation, PRESSURE_LEVEL, 0), 0, 1);
        let decision = {
            intent: 'avoid',
            retreatReason: '',
            selectedItemReason: '',
            targetDistanceRatio: clamp(readObservationValue(observation, TARGET_DISTANCE_RATIO, 1), 0, 1),
            targetPlayerIndex: -1,
            targetReachable: true,
        };
        if (mode === 'HUNT') {
            decision = applyHeuristicHuntBehavior(this, input, dt, player, runtimeContext, observation);
        } else if (mode === 'ARCADE') {
            decision = this._applyArcadeBehavior(input, player, runtimeContext, observation);
        } else {
            decision = applyHeuristicClassicBehavior(this, input, dt, player, runtimeContext, observation);
        }
        if (mode !== 'HUNT') input.shootMG = false;
        if (resolveInventoryLength(player) === 0) {
            input.shootItem = false;
            input.shootItemIndex = -1;
            input.useItem = -1;
        }
        applyHeuristicSafetyArbiter(this, input, dt, player, runtimeContext, observation, decision);
        if (mode === 'HUNT' && Number.isInteger(decision.targetPlayerIndex) && decision.targetPlayerIndex >= 0) {
            const safetyVeto = this._safetyState.state === 'evade' || this._safetyState.state === 'recover';
            if (safetyVeto || decision.targetReachable === false) {
                if (player.fightTargetPlayerIndex === decision.targetPlayerIndex) {
                    player.fightTargetLockRemaining = 0;
                }
            } else if (input.shootMG === true || input.shootItem === true) {
                player.fightTargetPlayerIndex = decision.targetPlayerIndex;
                player.fightTargetLockRemaining = Math.max(
                    Math.max(0, Number(player.fightTargetLockRemaining) || 0),
                    FIGHT_TARGET_LOCK_SECONDS
                );
                this._huntState.commitTimer = Math.max(
                    this._huntState.commitTimer,
                    FIGHT_BURST_COMMIT_SECONDS
                );
            }
        }
        this._updateSnapshot(
            mode,
            decision.intent,
            pressureLevel,
            input.boost === true,
            decision.selectedItemReason,
            decision.targetDistanceRatio,
            decision.retreatReason,
            input
        );
        return input;
    }

    getDecisionSnapshot() {
        return this._decisionSnapshot;
    }

    setProfile(profileName) {
        this.profileName = normalizeProfileName(profileName);
        this.profile = HEURISTIC_PROFILES[this.profileName];
    }

    setDifficulty(profileName) {
        this.difficultyName = normalizeDifficultyName(profileName);
        this.difficulty = HEURISTIC_DIFFICULTIES[this.difficultyName];
    }

    onBounce(type, normal = null) {
        recordHeuristicBounce(this._safetyState, type, normal);
    }

    setSensePhase(phase) {
        this.sensePhase = Number.isFinite(Number(phase)) ? Math.max(0, Math.trunc(Number(phase))) : 0;
    }

    reset() {
        resetInput(this._input);
        resetHeuristicSafetyState(this._safetyState);
        this._classicState.intent = 'space-seek';
        this._classicState.commitTimer = 0;
        this._classicState.targetIndex = -1;
        this._huntState.movementIntent = 'search';
        this._huntState.commitTimer = 0;
        this._decisionCounters.updates = 0;
        this._decisionCounters.intentChanges = 0;
        this._decisionCounters.safetyTransitions = 0;
        this._decisionCounters.steeringChanges = 0;
        this._decisionCounters.safetyActiveUpdates = 0;
        this._decisionCounters.lastSteeringSignature = 0;
    }
}

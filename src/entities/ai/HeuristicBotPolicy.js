import * as THREE from 'three';
import {
    LOCAL_OPENNESS_RATIO,
    PRESSURE_LEVEL,
    PROJECTILE_THREAT,
    TARGET_ALIGNMENT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_FRONT,
} from './observation/ObservationSchemaV1.js';
import { BOT_POLICY_TYPES } from './BotPolicyTypes.js';
import {
    applySteeringTowardPosition,
    clearSteeringInput,
    findNearestReadyPortal,
    findNearestReadySpecialGate,
    findStrongestRocketIndex,
    resolveHealthRatio,
    resolveHuntFallbackItemAction,
    resolveShieldRatio,
} from '../../hunt/HuntBotPolicy.js';
import { getPreferredFightEnemy } from '../../hunt/FightTargetSelector.js';
import { resolveHuntTargetOwnerPlayer } from '../../hunt/HuntTargetingOps.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import { clamp } from '../../utils/MathOps.js';
import { applyHeuristicClassicBehavior } from './HeuristicClassicTacticsOps.js';
import { HEURISTIC_DIFFICULTIES, HEURISTIC_PROFILES, WORLD_UP, hasYaw, normalizeDifficultyName, normalizeProfileName, readObservationValue, readVectorLikePosition, resetInput, resolveInventoryLength, resolveMode, resolveProgressPlayerIndex, resolveStableStrafeRight } from './HeuristicBotPolicyOps.js';
import {
    applyHeuristicObstacleAvoidance,
    applyHeuristicSafetyArbiter,
    createHeuristicSafetyState,
    recordHeuristicBounce,
    resetHeuristicSafetyState,
    resolveBoostPressureCeiling,
} from './HeuristicBotSafetyOps.js';

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
        this._tmpProjectileRelative = new THREE.Vector3();
        this._tmpProjectileVelocity = new THREE.Vector3();
        this._tmpEvade = new THREE.Vector3();
    }

    _updateSnapshot(mode, intent, pressure, boostAllowed, selectedItemReason, targetDistanceRatio, retreatReason, input) {
        const snapshot = this._decisionSnapshot;
        const counters = this._decisionCounters;
        if (counters.updates > 0 && snapshot.intent !== intent) counters.intentChanges += 1;
        if (counters.updates > 0 && snapshot.safetyState !== this._safetyState.state) counters.safetyTransitions += 1;
        const steeringSignature = (input?.yawLeft ? 1 : 0)
            | (input?.yawRight ? 2 : 0)
            | (input?.pitchUp ? 4 : 0)
            | (input?.pitchDown ? 8 : 0);
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

    _applyRetreatSteering(input, player, enemy) {
        if (!player?.position) return;
        if (enemy?.position) {
            this._tmpGate.subVectors(player.position, enemy.position);
            if (this._tmpGate.lengthSq() > 0.000001) {
                this._tmpGate.normalize().multiplyScalar(24).add(player.position);
                applySteeringTowardPosition(this, input, player, this._tmpGate);
                return;
            }
        }
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
        this._tmpRight.crossVectors(WORLD_UP, this._tmpForward);
        if (this._tmpRight.lengthSq() <= 0.000001) {
            this._tmpRight.set(1, 0, 0);
        } else {
            this._tmpRight.normalize();
        }
        input.yawRight = true;
        input.yawLeft = false;
    }

    _applyHuntBehavior(input, player, runtimeContext, observation) {
        const players = Array.isArray(runtimeContext?.players) ? runtimeContext.players : [];
        const huntTarget = runtimeContext?.huntTarget || null;
        const preferred = getPreferredFightEnemy(player, players, this._tmpToEnemy);
        const targetPlayer = resolveHuntTargetOwnerPlayer(huntTarget, players);
        const enemy = targetPlayer && (
            targetPlayer === preferred.enemy
            || preferred.candidateCount <= 1
            || targetPlayer.index === player.fightLastAttackerIndex
        ) ? targetPlayer : preferred.enemy;
        const healthRatio = resolveHealthRatio(player);
        const shieldRatio = resolveShieldRatio(player);
        const enemyHealthRatio = resolveHealthRatio(enemy);
        const enemyShieldRatio = resolveShieldRatio(enemy);
        const vitalityRatio = clamp(healthRatio * 0.72 + shieldRatio * 0.28, 0, 1);
        const enemyVitalityRatio = clamp(enemyHealthRatio * 0.72 + enemyShieldRatio * 0.28, 0, 1);
        const pressureLevel = clamp(readObservationValue(observation, PRESSURE_LEVEL, 0), 0, 1);
        const projectileThreat = readObservationValue(observation, PROJECTILE_THREAT, 0) >= 0.5;
        let targetAlignment = clamp(readObservationValue(observation, TARGET_ALIGNMENT, 0), -1, 1);
        let targetInFront = readObservationValue(observation, TARGET_IN_FRONT, 0) >= 0.5;
        const observedTargetDistanceRatio = clamp(readObservationValue(observation, TARGET_DISTANCE_RATIO, 1), 0, 1);
        const targetDistanceMax = Math.max(1, Number(runtimeContext?.observationContext?.targetDistanceMax) || 120);
        let targetDistanceSq = preferred.distSq;
        let targetDistanceRatio = observedTargetDistanceRatio;
        if (enemy?.position && player?.position) {
            this._tmpToEnemy.subVectors(enemy.position, player.position);
            targetDistanceSq = this._tmpToEnemy.lengthSq();
            targetDistanceRatio = clamp(Math.sqrt(targetDistanceSq) / targetDistanceMax, 0, 1);
            if (targetDistanceSq > 0.000001) {
                this._tmpToEnemy.multiplyScalar(1 / Math.sqrt(targetDistanceSq));
                if (typeof player.getDirection === 'function') {
                    player.getDirection(this._tmpForward);
                    if (this._tmpForward.lengthSq() > 0.000001) this._tmpForward.normalize();
                    targetAlignment = this._tmpForward.dot(this._tmpToEnemy);
                    targetInFront = targetAlignment >= this.difficulty.aimDot;
                }
            }
        }
        const wallFront = clamp(readObservationValue(observation, WALL_DISTANCE_FRONT, 1), 0, 1);
        const aggression = clamp(0.5 + (vitalityRatio - enemyVitalityRatio) * 0.9, 0.12, 1);
        const survivalPressure = Math.max(pressureLevel, projectileThreat ? 0.84 : 0, (1 - vitalityRatio) * 0.95);
        const rocketIndex = findStrongestRocketIndex(player?.inventory || []);
        let intent = 'fight-search';
        let retreatReason = '';

        const itemAction = resolveHuntFallbackItemAction(player, {
            pressureLevel,
            aggression,
            targetInFront,
            healthRatio,
            shieldRatio,
            survivalPressure,
            preferDefense: projectileThreat || survivalPressure > 0.62,
            preferTraversal: survivalPressure > 0.72 || vitalityRatio < 0.38,
            enemyClose: targetDistanceSq <= 22 * 22,
            crashRisk: projectileThreat ? 1 : (pressureLevel > 0.64 ? 0.5 : 0),
        });

        const attackWindow = clamp(this.profile.attackWindow * this.difficulty.attackWindowScale, 0.1, 1);
        if (
            enemy
            && targetInFront
            && targetAlignment >= this.difficulty.aimDot
            && survivalPressure < 0.84
            && aggression >= 0.38
            && targetDistanceRatio < attackWindow
        ) {
            input.shootMG = true;
        }
        const rocketWindow = targetDistanceRatio >= 0.16
            && targetDistanceRatio <= Math.min(0.9, attackWindow + 0.12);
        if (
            rocketIndex >= 0
            && enemy
            && targetInFront
            && targetAlignment >= this.difficulty.aimDot
            && rocketWindow
            && pressureLevel < 0.9
            && (aggression >= 0.32 || enemyVitalityRatio > 0.55 || survivalPressure > 0.72)
        ) {
            input.shootItem = true;
            input.shootItemIndex = rocketIndex;
        }
        if (itemAction.useItem >= 0) {
            input.useItem = itemAction.useItem;
        } else if (rocketIndex < 0 && itemAction.shootItem === true && itemAction.shootItemIndex >= 0) {
            input.shootItem = true;
            input.shootItemIndex = itemAction.shootItemIndex;
        }

        if (enemy && (vitalityRatio <= this.profile.retreatVitality || (vitalityRatio < 0.52 && survivalPressure > this.profile.retreatPressure))) {
            intent = 'retreat';
            retreatReason = vitalityRatio <= this.profile.retreatVitality ? 'low-vitality' : 'pressure';
            const huntConfig = resolveGameplayConfig(player).HUNT;
            const gateAssistRange = Math.max(24, Number(huntConfig?.RETREAT_GATE_RANGE || 54));
            const specialGates = Array.isArray(runtimeContext?.arena?.specialGates) ? runtimeContext.arena.specialGates : [];
            const readyGate = survivalPressure > 0.8
                ? findNearestReadySpecialGate(this, player, specialGates, gateAssistRange * gateAssistRange)
                : null;
            const portalAssistRange = Math.max(30, gateAssistRange * 1.25);
            const readyPortal = readyGate?.gate
                ? null
                : findNearestReadyPortal(this, player, runtimeContext?.arena, portalAssistRange * portalAssistRange);

            clearSteeringInput(input);
            if (readyGate?.gate) {
                applySteeringTowardPosition(this, input, player, readyGate.gate.pos);
            } else if (readyPortal?.entry) {
                applySteeringTowardPosition(this, input, player, readyPortal.entry);
            } else {
                this._applyRetreatSteering(input, player, enemy);
            }
            if (!hasYaw(input)) {
                this._applyRetreatSteering(input, player, enemy);
            }
            input.boost = wallFront > Math.max(this.profile.safetyDistance, 0.34);
            input.shootMG = false;
            if (rocketIndex < 0) {
                input.shootItem = false;
                input.shootItemIndex = -1;
            }
        } else if (enemy?.position && player?.position) {
            clearSteeringInput(input);
            if (targetDistanceRatio > this.profile.strafeDistance && wallFront > this.profile.safetyDistance) {
                applySteeringTowardPosition(this, input, player, enemy.position);
                intent = aggression > 0.5 ? 'attack-approach' : 'approach';
            } else if (targetDistanceRatio > this.profile.preferredRange) {
                applySteeringTowardPosition(this, input, player, enemy.position);
                const strafeRight = resolveStableStrafeRight(player);
                input.rollRight = strafeRight;
                input.rollLeft = !strafeRight;
                intent = 'strafe';
            } else {
                this._applyRetreatSteering(input, player, enemy);
                input.boost = false;
                intent = 'hold-distance';
            }
            if (wallFront <= this.profile.safetyDistance) {
                input.boost = false;
            }
        }
        return { intent, retreatReason, targetDistanceRatio, selectedItemReason: itemAction.type || (rocketIndex >= 0 ? 'rocket' : '') };
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
        };
        if (mode === 'HUNT') {
            decision = this._applyHuntBehavior(input, player, runtimeContext, observation);
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
        this._decisionCounters.updates = 0;
        this._decisionCounters.intentChanges = 0;
        this._decisionCounters.safetyTransitions = 0;
        this._decisionCounters.steeringChanges = 0;
        this._decisionCounters.safetyActiveUpdates = 0;
        this._decisionCounters.lastSteeringSignature = 0;
    }
}

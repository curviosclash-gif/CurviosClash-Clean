import * as THREE from 'three';
import {
    INVENTORY_COUNT_RATIO,
    LOCAL_OPENNESS_RATIO,
    PLANAR_MODE_ACTIVE,
    PRESSURE_LEVEL,
    PROJECTILE_THREAT,
    TARGET_ALIGNMENT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_DOWN,
    WALL_DISTANCE_FRONT,
    WALL_DISTANCE_LEFT,
    WALL_DISTANCE_RIGHT,
    WALL_DISTANCE_UP,
} from './observation/ObservationSchemaV1.js';
import { BOT_POLICY_TYPES } from './BotPolicyTypes.js';
import {
    applySteeringTowardPosition,
    clearSteeringInput,
    findNearestReadyPortal,
    findNearestReadySpecialGate,
    findStrongestRocketIndex,
    getNearestEnemy,
    resolveHealthRatio,
    resolveHuntFallbackItemAction,
    resolveShieldRatio,
} from '../../hunt/HuntBotPolicy.js';
import { resolveHuntTargetOwnerPlayer } from '../../hunt/HuntTargetingOps.js';
import {
    isPickupTypeOffensive,
    isPickupTypeSelfUsable,
    isPickupTypeShootable,
    isRocketPickupType,
    normalizePickupType,
} from '../PickupRegistry.js';
import { BOT_ITEM_RULES } from './BotTuningConfig.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import { clamp } from '../../utils/MathOps.js';
import { HEURISTIC_PROFILES, WORLD_UP, hasYaw, normalizeProfileName, readObservationValue, readVectorLikePosition, resetInput, resolveInventoryLength, resolveMode, resolveProgressPlayerIndex, resolveSelectedItemIndex } from './HeuristicBotPolicyOps.js';

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
        this._input = resetInput({});
        this._decisionSnapshot = {
            mode: 'CLASSIC',
            profile: this.profileName,
            intent: 'avoid',
            pressure: 0,
            boostAllowed: false,
            selectedItemReason: '',
            targetDistanceRatio: 1,
            retreatReason: '',
        };
        this._tmpToEnemy = new THREE.Vector3();
        this._tmpForward = new THREE.Vector3();
        this._tmpRight = new THREE.Vector3();
        this._tmpUp = new THREE.Vector3();
        this._tmpGate = new THREE.Vector3();
        this._tmpTarget = new THREE.Vector3();
    }

    _updateSnapshot(mode, intent, pressure, boostAllowed, selectedItemReason, targetDistanceRatio, retreatReason = '') {
        const snapshot = this._decisionSnapshot;
        snapshot.mode = mode;
        snapshot.profile = this.profileName;
        snapshot.intent = intent;
        snapshot.pressure = pressure;
        snapshot.boostAllowed = boostAllowed === true;
        snapshot.selectedItemReason = selectedItemReason || '';
        snapshot.targetDistanceRatio = targetDistanceRatio;
        snapshot.retreatReason = retreatReason || '';
    }

    _resolveProfileFromContext(runtimeContext) {
        const nextProfileName = normalizeProfileName(
            runtimeContext?.heuristicProfile
            || runtimeContext?.runtimeConfig?.bot?.heuristicProfile
            || runtimeContext?.runtimeConfig?.bot?.profile
            || this.profileName
        );
        if (nextProfileName === this.profileName) return;
        this.profileName = nextProfileName;
        this.profile = HEURISTIC_PROFILES[nextProfileName];
    }

    _applyObstacleAvoidance(input, player, observation) {
        const wallFront = clamp(readObservationValue(observation, WALL_DISTANCE_FRONT, 1), 0, 1);
        const wallLeft = clamp(readObservationValue(observation, WALL_DISTANCE_LEFT, 1), 0, 1);
        const wallRight = clamp(readObservationValue(observation, WALL_DISTANCE_RIGHT, 1), 0, 1);
        const wallUp = clamp(readObservationValue(observation, WALL_DISTANCE_UP, 1), 0, 1);
        const wallDown = clamp(readObservationValue(observation, WALL_DISTANCE_DOWN, 1), 0, 1);
        const pressureLevel = clamp(readObservationValue(observation, PRESSURE_LEVEL, 0), 0, 1);
        const projectileThreat = readObservationValue(observation, PROJECTILE_THREAT, 0) >= 0.5;
        const openness = clamp(readObservationValue(observation, LOCAL_OPENNESS_RATIO, 0), 0, 1);
        const planarMode = readObservationValue(observation, PLANAR_MODE_ACTIVE, 0) >= 0.5
            || !!resolveGameplayConfig(player).GAMEPLAY.PLANAR_MODE;

        const frontEmergency = wallFront < 0.2 || pressureLevel > 0.82;
        if (frontEmergency) {
            input.yawRight = wallRight >= wallLeft;
            input.yawLeft = !input.yawRight;
        } else {
            const sideDelta = wallRight - wallLeft;
            if (Math.abs(sideDelta) > 0.14) {
                input.yawRight = sideDelta > 0;
                input.yawLeft = sideDelta < 0;
            }
        }

        if (!planarMode) {
            const verticalDelta = wallUp - wallDown;
            if (Math.abs(verticalDelta) > 0.16 || frontEmergency) {
                input.pitchUp = verticalDelta > 0.02;
                input.pitchDown = verticalDelta < -0.02;
            }
        }

        const boostPressureCeiling = 0.64 / this.profile.boostBias;
        input.boost = (
            (projectileThreat || (openness > 0.58 && pressureLevel < boostPressureCeiling))
            && wallFront > this.profile.safetyDistance
        );
    }

    _applyClassicItemUse(input, player, observation) {
        const targetDistanceRatio = clamp(readObservationValue(observation, TARGET_DISTANCE_RATIO, 1), 0, 1);
        const targetAlignment = clamp(readObservationValue(observation, TARGET_ALIGNMENT, 0), -1, 1);
        const targetInFront = readObservationValue(observation, TARGET_IN_FRONT, 0) >= 0.5;
        const pressureLevel = clamp(readObservationValue(observation, PRESSURE_LEVEL, 0), 0, 1);
        const wallFront = clamp(readObservationValue(observation, WALL_DISTANCE_FRONT, 1), 0, 1);
        const openness = clamp(readObservationValue(observation, LOCAL_OPENNESS_RATIO, 0), 0, 1);
        const inventory = Array.isArray(player?.inventory) ? player.inventory : [];
        const hasInventory = readObservationValue(observation, INVENTORY_COUNT_RATIO, 0) > 0 || inventory.length > 0;
        if (!hasInventory) return '';

        let bestUseScore = Number.NEGATIVE_INFINITY;
        let bestUseIndex = -1;
        let bestUseReason = '';
        let bestShootScore = Number.NEGATIVE_INFINITY;
        let bestShootIndex = -1;
        let bestShootReason = '';
        const danger = Math.max(pressureLevel, 1 - wallFront, openness < 0.34 ? 0.68 : 0);
        const goodCorridor = targetInFront && targetAlignment > (0.54 + this.profile.attackWindow * 0.12) && targetDistanceRatio < this.profile.attackWindow;

        for (let i = 0; i < inventory.length; i += 1) {
            const type = normalizePickupType(inventory[i], { fallback: inventory[i] });
            if (!type || isRocketPickupType(type)) continue;
            const rule = BOT_ITEM_RULES[type];
            if (!rule) continue;
            const offensive = isPickupTypeOffensive(type);
            if (isPickupTypeSelfUsable(type, 'CLASSIC') && !offensive) {
                const utilityPressure = (type === 'SPEED_UP' || type === 'GHOST' || type === 'THICK') && (openness < 0.38 || pressureLevel > 0.58)
                    ? 0.24
                    : 0;
                const score = rule.self + danger * rule.defensiveScale + (1 - wallFront) * rule.emergencyScale + utilityPressure;
                if (score > bestUseScore) {
                    bestUseScore = score;
                    bestUseIndex = i;
                    bestUseReason = danger > 0.72 ? 'defense-danger' : (utilityPressure > 0 ? 'utility-pressure' : 'self-safe');
                }
            }
            if (isPickupTypeShootable(type, 'CLASSIC') && offensive && goodCorridor) {
                const score = rule.offense + targetAlignment * 0.22 + (1 - targetDistanceRatio) * 0.14 - pressureLevel * 0.12;
                if (score > bestShootScore) {
                    bestShootScore = score;
                    bestShootIndex = i;
                    bestShootReason = 'offense-corridor';
                }
            }
        }

        const useThreshold = (0.7 - pressureLevel * 0.22) * this.profile.itemThresholdScale;
        if (bestUseIndex >= 0 && danger > 0.52 && bestUseScore > useThreshold) {
            input.useItem = bestUseIndex;
            return bestUseReason;
        }
        const shootThreshold = (0.58 + pressureLevel * 0.12) * this.profile.itemThresholdScale;
        if (bestShootIndex >= 0 && bestShootScore > shootThreshold) {
            input.shootItem = true;
            input.shootItemIndex = bestShootIndex;
            return bestShootReason;
        }
        const selectedItemIndex = resolveSelectedItemIndex(player);
        return selectedItemIndex >= 0 ? 'held' : '';
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
        const nearest = getNearestEnemy(player, players, this._tmpToEnemy);
        const enemy = resolveHuntTargetOwnerPlayer(huntTarget, players) || nearest.enemy;
        const healthRatio = resolveHealthRatio(player);
        const shieldRatio = resolveShieldRatio(player);
        const enemyHealthRatio = resolveHealthRatio(enemy);
        const enemyShieldRatio = resolveShieldRatio(enemy);
        const vitalityRatio = clamp(healthRatio * 0.72 + shieldRatio * 0.28, 0, 1);
        const enemyVitalityRatio = clamp(enemyHealthRatio * 0.72 + enemyShieldRatio * 0.28, 0, 1);
        const pressureLevel = clamp(readObservationValue(observation, PRESSURE_LEVEL, 0), 0, 1);
        const projectileThreat = readObservationValue(observation, PROJECTILE_THREAT, 0) >= 0.5;
        const targetInFront = !!huntTarget || readObservationValue(observation, TARGET_IN_FRONT, 0) >= 0.5;
        const targetDistanceRatio = clamp(readObservationValue(observation, TARGET_DISTANCE_RATIO, 1), 0, 1);
        const targetDistanceSq = Number.isFinite(huntTarget?.distance)
            ? huntTarget.distance * huntTarget.distance
            : nearest.distSq;
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

        if (enemy && targetInFront && survivalPressure < 0.84 && aggression >= 0.38 && targetDistanceRatio < this.profile.attackWindow) {
            input.shootMG = true;
        }
        if (rocketIndex >= 0 && enemy && targetInFront && (targetDistanceRatio > 0.18 || pressureLevel > 0.55 || enemyVitalityRatio > 0.46)) {
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
            input.boost = true;
            input.shootMG = false;
            if (rocketIndex < 0) {
                input.shootItem = false;
                input.shootItemIndex = -1;
            }
        } else if (enemy?.position && player?.position) {
            const wallFront = clamp(readObservationValue(observation, WALL_DISTANCE_FRONT, 1), 0, 1);
            clearSteeringInput(input);
            if (targetDistanceRatio > this.profile.strafeDistance && wallFront > this.profile.safetyDistance) {
                applySteeringTowardPosition(this, input, player, enemy.position);
                intent = aggression > 0.5 ? 'attack-approach' : 'approach';
            } else if (targetDistanceRatio > this.profile.preferredRange) {
                applySteeringTowardPosition(this, input, player, enemy.position);
                const strafeRight = ((Number(player?.index) || 0) + this.sensePhase) % 2 === 0;
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
            && pressureLevel < (0.52 / this.profile.boostBias)
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

    update(_dt, player, runtimeContext = null) {
        const input = resetInput(this._input);
        if (!player || player.alive === false) return input;
        this._resolveProfileFromContext(runtimeContext);
        const observation = runtimeContext?.observation || null;
        this._applyObstacleAvoidance(input, player, observation);

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
            const selectedItemReason = this._applyClassicItemUse(input, player, observation);
            decision.selectedItemReason = selectedItemReason;
            decision.intent = selectedItemReason && selectedItemReason !== 'held' ? 'classic-item' : 'avoid';
            input.shootMG = false;
        }
        if (mode !== 'HUNT') input.shootMG = false;
        if (resolveInventoryLength(player) === 0) {
            input.shootItem = false;
            input.shootItemIndex = -1;
            input.useItem = -1;
        }
        this._updateSnapshot(
            mode,
            decision.intent,
            pressureLevel,
            input.boost === true,
            decision.selectedItemReason,
            decision.targetDistanceRatio,
            decision.retreatReason
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

    setSensePhase(phase) {
        this.sensePhase = Number.isFinite(Number(phase)) ? Math.max(0, Math.trunc(Number(phase))) : 0;
    }

    reset() {
        resetInput(this._input);
    }
}

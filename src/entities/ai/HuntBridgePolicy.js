// ============================================
// HuntBridgePolicy.js - hunt-specific bridge policy using observation/runtime context
// ============================================

import * as THREE from 'three';
import {
    PRESSURE_LEVEL,
    PROJECTILE_THREAT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
} from './observation/ObservationSchemaV1.js';
import { BOT_POLICY_TYPES, normalizeBotPolicyType } from './BotPolicyTypes.js';
import { ObservationBridgePolicy } from './ObservationBridgePolicy.js';
import {
    clamp,
    clearSteeringInput,
    findNearestReadyPortal,
    findNearestReadySpecialGate,
    findStrongestRocketIndex,
    getNearestEnemy,
    resolveHealthRatio,
    resolveHuntFallbackItemAction,
    resolveShieldRatio,
    applySteeringTowardPosition,
    HuntBotPolicy,
} from '../../hunt/HuntBotPolicy.js';
import { resolveHuntTargetOwnerPlayer } from '../../hunt/HuntTargetingOps.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TMP_TO_ENEMY = new THREE.Vector3();
const TMP_FORWARD = new THREE.Vector3();
const TMP_RIGHT = new THREE.Vector3();
const TMP_UP = new THREE.Vector3();
const HUNT_BRIDGE_STEERING_SCRATCH = {
    _tmpGate: TMP_TO_ENEMY,
    _tmpForward: TMP_FORWARD,
    _tmpRight: TMP_RIGHT,
    _tmpUp: TMP_UP,
};

function resolveObservationValue(observation, index, fallback = 0) {
    if (!observation || typeof observation.length !== 'number') return fallback;
    const value = Number(observation[index]);
    return Number.isFinite(value) ? value : fallback;
}

function hasYawCommand(action) {
    return action?.yawLeft === true || action?.yawRight === true;
}

function resolveHuntBridgePriorities(player, runtimeContext) {
    const players = Array.isArray(runtimeContext?.players) ? runtimeContext.players : [];
    const observation = runtimeContext?.observation || null;
    const huntTarget = runtimeContext?.huntTarget || null;
    const targetDistanceRatio = clamp(resolveObservationValue(observation, TARGET_DISTANCE_RATIO, 1), 0, 1);
    const pressureLevel = clamp(resolveObservationValue(observation, PRESSURE_LEVEL, 0), 0, 1);
    const projectileThreat = resolveObservationValue(observation, PROJECTILE_THREAT, 0) >= 0.5;

    const nearest = getNearestEnemy(player, players, TMP_TO_ENEMY);
    const enemy = resolveHuntTargetOwnerPlayer(huntTarget, players) || nearest.enemy;
    const healthRatio = resolveHealthRatio(player);
    const shieldRatio = resolveShieldRatio(player);
    const enemyHealthRatio = resolveHealthRatio(enemy);
    const enemyShieldRatio = resolveShieldRatio(enemy);
    const vitalityRatio = clamp(healthRatio * 0.72 + shieldRatio * 0.28, 0, 1);
    const enemyVitalityRatio = clamp(enemyHealthRatio * 0.72 + enemyShieldRatio * 0.28, 0, 1);
    const aggression = clamp(0.5 + (vitalityRatio - enemyVitalityRatio) * 0.9, 0.12, 1.0);
    const rocketIndex = findStrongestRocketIndex(player?.inventory || []);
    const hasSharedTarget = !!huntTarget;
    const targetDistanceSq = Number.isFinite(huntTarget?.distance)
        ? huntTarget.distance * huntTarget.distance
        : nearest.distSq;

    return {
        enemy,
        healthRatio,
        shieldRatio,
        vitalityRatio,
        enemyHealthRatio,
        enemyShieldRatio,
        aggression,
        rocketIndex,
        pressureLevel,
        projectileThreat,
        hasSharedTarget,
        targetDistanceSq,
        targetDistanceRatio,
        targetInFront: hasSharedTarget || resolveObservationValue(observation, TARGET_IN_FRONT, 0) >= 0.5,
    };
}

function applyRetreatManeuver(action, player, enemy) {
    if (!enemy || !player || typeof player.getDirection !== 'function') return;
    const planarMode = !!resolveGameplayConfig(player).GAMEPLAY.PLANAR_MODE;

    TMP_TO_ENEMY.subVectors(enemy.position, player.position).normalize();
    player.getDirection(TMP_FORWARD).normalize();
    TMP_RIGHT.crossVectors(WORLD_UP, TMP_FORWARD);
    if (TMP_RIGHT.lengthSq() <= 0.000001) {
        TMP_RIGHT.set(1, 0, 0);
    } else {
        TMP_RIGHT.normalize();
    }
    TMP_UP.crossVectors(TMP_FORWARD, TMP_RIGHT).normalize();

    const yawTowardEnemy = TMP_RIGHT.dot(TMP_TO_ENEMY);
    if (Math.abs(yawTowardEnemy) > 0.03) {
        action.yawLeft = yawTowardEnemy > 0;
        action.yawRight = yawTowardEnemy < 0;
    }

    if (!planarMode) {
        const pitchTowardEnemy = TMP_UP.dot(TMP_TO_ENEMY);
        if (Math.abs(pitchTowardEnemy) > 0.07) {
            action.pitchUp = pitchTowardEnemy < 0;
            action.pitchDown = pitchTowardEnemy > 0;
        }
    }
}

function resolveHuntBridgeAction(runtimeContext, player) {
    const priorities = resolveHuntBridgePriorities(player, runtimeContext);
    const action = {};
    const huntConfig = resolveGameplayConfig(player).HUNT;
    const specialGates = Array.isArray(runtimeContext?.arena?.specialGates) ? runtimeContext.arena.specialGates : [];
    const survivalPressure = Math.max(
        priorities.pressureLevel,
        priorities.projectileThreat ? 0.82 : 0,
        (1 - priorities.vitalityRatio) * 0.95
    );
    const fallbackItemAction = resolveHuntFallbackItemAction(player, {
        pressureLevel: priorities.pressureLevel,
        aggression: priorities.aggression,
        targetInFront: priorities.targetInFront,
        healthRatio: priorities.healthRatio,
        shieldRatio: priorities.shieldRatio,
        survivalPressure,
        preferDefense: priorities.projectileThreat || survivalPressure > 0.62,
        preferTraversal: survivalPressure > 0.72 || priorities.vitalityRatio < 0.38,
        enemyClose: priorities.targetDistanceSq <= 22 * 22,
        crashRisk: priorities.projectileThreat ? 1 : (priorities.pressureLevel > 0.64 ? 0.5 : 0),
    });
    const mgRange = Math.max(12, Number(huntConfig?.MG?.RANGE || 95));
    const targetDistanceMax = Math.max(1, Number(runtimeContext?.observationContext?.targetDistanceMax || 120));
    const mgRangeRatio = clamp(mgRange / targetDistanceMax, 0, 1);
    const withinMgWindow = priorities.hasSharedTarget
        ? priorities.targetDistanceSq <= mgRange * mgRange
        : (priorities.targetInFront && priorities.targetDistanceRatio <= mgRangeRatio);

    if (
        (priorities.hasSharedTarget || priorities.enemy)
        && withinMgWindow
        && (priorities.shieldRatio > 0.08 || priorities.healthRatio > 0.32)
        && priorities.aggression >= 0.4
        && survivalPressure < 0.85
    ) {
        action.shootMG = true;
    }

    if (priorities.rocketIndex >= 0 && (priorities.hasSharedTarget || priorities.enemy)) {
        const shouldUseRocket = (
            priorities.enemyShieldRatio > 0.18
            || priorities.enemyHealthRatio > 0.45
            || priorities.targetDistanceRatio > 0.2
            || priorities.pressureLevel > 0.56
            || survivalPressure > 0.54
            || priorities.vitalityRatio < 0.52
        );
        if (shouldUseRocket) {
            action.shootItem = true;
            action.shootItemIndex = priorities.rocketIndex;
        }
    }

    if (fallbackItemAction.useItem >= 0) {
        action.useItem = fallbackItemAction.useItem;
    } else if (
        priorities.rocketIndex < 0
        && fallbackItemAction.shootItem === true
        && fallbackItemAction.shootItemIndex >= 0
    ) {
        action.shootItem = true;
        action.shootItemIndex = fallbackItemAction.shootItemIndex;
    }

    if (priorities.projectileThreat || priorities.pressureLevel > 0.74) {
        action.boost = true;
    }

    if (priorities.vitalityRatio <= 0.34 || (priorities.vitalityRatio < 0.52 && survivalPressure > 0.76)) {
        const gateAssistRange = Math.max(24, Number(huntConfig?.RETREAT_GATE_RANGE || 54));
        const readyGate = (survivalPressure > 0.8 || priorities.vitalityRatio < 0.3)
            ? findNearestReadySpecialGate(HUNT_BRIDGE_STEERING_SCRATCH, player, specialGates, gateAssistRange * gateAssistRange)
            : null;
        const portalAssistRange = Math.max(30, gateAssistRange * 1.25);
        const readyPortal = readyGate?.gate
            ? null
            : findNearestReadyPortal(HUNT_BRIDGE_STEERING_SCRATCH, player, runtimeContext?.arena, portalAssistRange * portalAssistRange);
        action.shootMG = false;
        clearSteeringInput(action);
        if (readyGate?.gate) {
            applySteeringTowardPosition(HUNT_BRIDGE_STEERING_SCRATCH, action, player, readyGate.gate.pos);
        } else if (readyPortal?.entry) {
            applySteeringTowardPosition(HUNT_BRIDGE_STEERING_SCRATCH, action, player, readyPortal.entry);
        } else {
            applyRetreatManeuver(action, player, priorities.enemy);
        }
        if (!hasYawCommand(action)) {
            applyRetreatManeuver(action, player, priorities.enemy);
        }
        if (!hasYawCommand(action)) {
            action.yawLeft = true;
            action.yawRight = false;
        }
        action.boost = true;
        if (priorities.rocketIndex < 0) {
            action.shootItem = false;
            action.shootItemIndex = -1;
        }
    }

    return action;
}

export class HuntBridgePolicy extends ObservationBridgePolicy {
    constructor(options = {}) {
        const policyType = normalizeBotPolicyType(options.type || BOT_POLICY_TYPES.HUNT_BRIDGE);
        const fallbackPolicy = options.fallbackPolicy || new HuntBotPolicy(options);
        const resolveAction = typeof options.resolveAction === 'function'
            ? options.resolveAction
            : (runtimeContext, player) => resolveHuntBridgeAction(runtimeContext, player);

        super({
            ...options,
            type: policyType,
            fallbackPolicy,
            resolveAction,
        });

        this.type = policyType;
    }
}

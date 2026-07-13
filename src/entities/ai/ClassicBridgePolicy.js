// ============================================
// ClassicBridgePolicy.js - classic bridge policy driven by observation vectors
// ============================================

import { BOT_POLICY_TYPES, normalizeBotPolicyType } from './BotPolicyTypes.js';
import { ObservationBridgePolicy } from './ObservationBridgePolicy.js';
import { RuleBasedBotPolicy } from './RuleBasedBotPolicy.js';
import {
    INVENTORY_COUNT_RATIO,
    LOCAL_OPENNESS_RATIO,
    PLANAR_MODE_ACTIVE,
    PRESSURE_LEVEL,
    PROJECTILE_THREAT,
    SELECTED_ITEM_SLOT,
    TARGET_ALIGNMENT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_DOWN,
    WALL_DISTANCE_FRONT,
    WALL_DISTANCE_LEFT,
    WALL_DISTANCE_RIGHT,
    WALL_DISTANCE_UP,
} from './observation/ObservationSchemaV1.js';
import { clamp } from '../../utils/MathOps.js';

function resolveObservationValue(observation, index, fallback = 0) {
    if (!observation || typeof observation.length !== 'number') return fallback;
    const value = Number(observation[index]);
    return Number.isFinite(value) ? value : fallback;
}

export function resolveClassicBridgeAction(runtimeContext) {
    const observation = runtimeContext?.observation || null;
    if (!observation || typeof observation.length !== 'number' || observation.length === 0) {
        return null;
    }

    const wallFront = clamp(resolveObservationValue(observation, WALL_DISTANCE_FRONT, 1), 0, 1);
    const wallLeft = clamp(resolveObservationValue(observation, WALL_DISTANCE_LEFT, 1), 0, 1);
    const wallRight = clamp(resolveObservationValue(observation, WALL_DISTANCE_RIGHT, 1), 0, 1);
    const wallUp = clamp(resolveObservationValue(observation, WALL_DISTANCE_UP, 1), 0, 1);
    const wallDown = clamp(resolveObservationValue(observation, WALL_DISTANCE_DOWN, 1), 0, 1);
    const targetDistanceRatio = clamp(resolveObservationValue(observation, TARGET_DISTANCE_RATIO, 1), 0, 1);
    const targetAlignment = clamp(resolveObservationValue(observation, TARGET_ALIGNMENT, 0), -1, 1);
    const targetInFront = resolveObservationValue(observation, TARGET_IN_FRONT, 0) >= 0.5;
    const pressureLevel = clamp(resolveObservationValue(observation, PRESSURE_LEVEL, 0), 0, 1);
    const projectileThreat = resolveObservationValue(observation, PROJECTILE_THREAT, 0) >= 0.5;
    const openness = clamp(resolveObservationValue(observation, LOCAL_OPENNESS_RATIO, 0), 0, 1);
    const inventoryCountRatio = clamp(resolveObservationValue(observation, INVENTORY_COUNT_RATIO, 0), 0, 1);
    const selectedItemSlot = Math.trunc(resolveObservationValue(observation, SELECTED_ITEM_SLOT, -1));
    const planarMode = resolveObservationValue(observation, PLANAR_MODE_ACTIVE, 0) >= 0.5;

    const action = {};
    const obstaclePressure = wallFront < 0.24 || pressureLevel > 0.78;

    if (obstaclePressure) {
        const turnRight = wallRight >= wallLeft;
        action.yawRight = turnRight;
        action.yawLeft = !turnRight;
    } else {
        const sideDelta = wallRight - wallLeft;
        if (Math.abs(sideDelta) > 0.12) {
            action.yawRight = sideDelta > 0;
            action.yawLeft = sideDelta < 0;
        }
    }

    if (!planarMode) {
        const verticalDelta = wallUp - wallDown;
        if (Math.abs(verticalDelta) > 0.12) {
            action.pitchUp = verticalDelta > 0;
            action.pitchDown = verticalDelta < 0;
        }
    }

    if (targetInFront && targetAlignment >= 0.55 && targetDistanceRatio <= 0.48 && pressureLevel < 0.9) {
        action.shootMG = true;
    }

    if (projectileThreat || (targetDistanceRatio > 0.55 && openness > 0.62 && pressureLevel < 0.55)) {
        action.boost = true;
    }
    if (wallFront < 0.16 && !projectileThreat) {
        action.boost = false;
    }

    if (
        inventoryCountRatio > 0
        && selectedItemSlot >= 0
        && (projectileThreat || pressureLevel > 0.82 || (targetInFront && targetDistanceRatio <= 0.24))
    ) {
        action.shootItem = true;
        action.shootItemIndex = selectedItemSlot;
    }

    return action;
}

export class ClassicBridgePolicy extends ObservationBridgePolicy {
    constructor(options = {}) {
        const policyType = normalizeBotPolicyType(options.type || BOT_POLICY_TYPES.CLASSIC_BRIDGE);
        const fallbackPolicy = options.fallbackPolicy || new RuleBasedBotPolicy(options);
        const resolveAction = typeof options.resolveAction === 'function'
            ? options.resolveAction
            : (runtimeContext) => resolveClassicBridgeAction(runtimeContext);

        super({
            ...options,
            type: policyType,
            fallbackPolicy,
            resolveAction,
        });

        this.type = policyType;
    }
}

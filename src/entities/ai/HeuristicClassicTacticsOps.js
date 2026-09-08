import {
    INVENTORY_COUNT_RATIO,
    LOCAL_OPENNESS_RATIO,
    PRESSURE_LEVEL,
    TARGET_ALIGNMENT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_FRONT,
} from './observation/ObservationSchemaV1.js';
import {
    applySteeringTowardPosition,
    clearSteeringInput,
    getNearestEnemy,
} from '../../hunt/HuntBotPolicy.js';
import {
    isPickupTypeOffensive,
    isPickupTypeSelfUsable,
    isPickupTypeShootable,
    isRocketPickupType,
    normalizePickupType,
} from '../PickupRegistry.js';
import { clamp } from '../../shared/utils/MathOps.js';
import { BOT_ITEM_RULES } from './BotTuningConfig.js';
import { hasYaw, readObservationValue, resolveSelectedItemIndex } from './HeuristicBotPolicyOps.js';
import { resolveBoostPressureCeiling } from './HeuristicBotSafetyOps.js';
import { findPreferredPickupTarget } from './BotPickupTargetingOps.js';

export function applyHeuristicClassicItemUse(policy, input, player, observation) {
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
    const danger = Math.max(pressureLevel, 1 - wallFront, openness < 0.34 ? 0.68 : 0);
    const attackWindow = clamp(policy.profile.attackWindow * policy.difficulty.attackWindowScale, 0.1, 1);
    const goodCorridor = targetInFront && targetAlignment > policy.difficulty.aimDot && targetDistanceRatio < attackWindow;

    for (let i = 0; i < inventory.length; i += 1) {
        const type = normalizePickupType(inventory[i], { fallback: inventory[i] });
        if (!type || isRocketPickupType(type)) continue;
        const rule = BOT_ITEM_RULES[type];
        if (!rule) continue;
        const offensive = isPickupTypeOffensive(type);
        if (isPickupTypeSelfUsable(type, 'CLASSIC') && !offensive) {
            const utilityPressure = (type === 'SPEED_UP' || type === 'GHOST' || type === 'THICK')
                && (openness < 0.38 || pressureLevel > 0.58) ? 0.24 : 0;
            const score = rule.self + danger * rule.defensiveScale
                + (1 - wallFront) * rule.emergencyScale + utilityPressure;
            if (score > bestUseScore) {
                bestUseScore = score;
                bestUseIndex = i;
                bestUseReason = danger > 0.72 ? 'defense-danger' : (utilityPressure > 0 ? 'utility-pressure' : 'self-safe');
            }
        }
        if (isPickupTypeShootable(type, 'CLASSIC') && offensive && goodCorridor) {
            const score = rule.offense + targetAlignment * 0.22
                + (1 - targetDistanceRatio) * 0.14 - pressureLevel * 0.12;
            if (score > bestShootScore) {
                bestShootScore = score;
                bestShootIndex = i;
            }
        }
    }

    const useThreshold = (0.7 - pressureLevel * 0.22)
        * policy.profile.defensiveItemThresholdScale * policy.difficulty.itemThresholdScale;
    if (bestUseIndex >= 0 && danger > 0.52 && bestUseScore > useThreshold) {
        input.useItem = bestUseIndex;
        return bestUseReason;
    }
    const shootThreshold = (0.58 + pressureLevel * 0.12)
        * policy.profile.offensiveItemThresholdScale * policy.difficulty.itemThresholdScale;
    if (bestShootIndex >= 0 && bestShootScore > shootThreshold) {
        input.shootItem = true;
        input.shootItemIndex = bestShootIndex;
        return 'offense-corridor';
    }
    return resolveSelectedItemIndex(player) >= 0 ? 'held' : '';
}

export function applyHeuristicClassicBehavior(policy, input, dt, player, runtimeContext, observation) {
    const pressureLevel = clamp(readObservationValue(observation, PRESSURE_LEVEL, 0), 0, 1);
    const wallFront = clamp(readObservationValue(observation, WALL_DISTANCE_FRONT, 1), 0, 1);
    const openness = clamp(readObservationValue(observation, LOCAL_OPENNESS_RATIO, 0), 0, 1);
    const players = Array.isArray(runtimeContext?.players) ? runtimeContext.players : [];
    const nearest = getNearestEnemy(player, players, policy._tmpToEnemy);
    const state = policy._classicState;
    state.commitTimer = Math.max(0, state.commitTimer - Math.max(0, Math.min(Number(dt) || 0, 0.12)));

    const target = nearest.enemy;
    const targetDistance = Number.isFinite(nearest.distSq) ? Math.sqrt(nearest.distSq) : Infinity;
    const unsafe = wallFront <= Math.max(policy.profile.safetyDistance, 0.34)
        || pressureLevel >= 0.68
        || openness < 0.34;
    if (!target?.position || !player?.position) {
        state.intent = 'space-seek';
        state.targetIndex = -1;
        state.commitTimer = 0;
    } else if (unsafe) {
        state.intent = 'space-seek';
        state.targetIndex = target.index;
        state.commitTimer = Math.min(state.commitTimer, 0.18);
    } else if (state.commitTimer <= 0 || state.targetIndex !== target.index) {
        state.intent = targetDistance >= 16 && targetDistance <= 86 ? 'intercept' : 'contain';
        state.targetIndex = target.index;
        state.commitTimer = policy.difficulty.tacticalCommitSeconds;
    }

    if ((state.intent === 'intercept' || state.intent === 'contain') && target?.position && player?.position) {
        policy._tmpTarget.copy(target.position);
        if (typeof target.getDirection === 'function') {
            target.getDirection(policy._tmpUp);
            if (policy._tmpUp.lengthSq() > 0.000001) {
                policy._tmpUp.normalize();
                const baseLead = state.intent === 'intercept'
                    ? clamp(targetDistance * 0.28, 6, 24)
                    : clamp(targetDistance * 0.12, 3, 12);
                policy._tmpTarget.addScaledVector(policy._tmpUp, baseLead * policy.difficulty.tacticalLeadScale);
            }
        }
        clearSteeringInput(input);
        applySteeringTowardPosition(policy, input, player, policy._tmpTarget);
        const turning = hasYaw(input) || input.pitchUp === true || input.pitchDown === true;
        input.boost = state.intent === 'intercept'
            && !turning
            && wallFront > Math.max(policy.profile.safetyDistance, 0.42)
            && pressureLevel < resolveBoostPressureCeiling(0.48, policy.profile)
            && openness > 0.5;
    }

    const selectedItemReason = applyHeuristicClassicItemUse(policy, input, player, observation);
    const pickupTarget = !unsafe && (!selectedItemReason || selectedItemReason === 'held')
        ? findPreferredPickupTarget(player, runtimeContext, { pressure: pressureLevel })
        : null;
    if (pickupTarget?.mesh?.position) {
        clearSteeringInput(input);
        applySteeringTowardPosition(policy, input, player, pickupTarget.mesh.position);
        input.boost = wallFront > 0.55 && pressureLevel < 0.45;
    }
    input.shootMG = false;
    return {
        intent: pickupTarget ? 'pickup-seek' : (selectedItemReason && selectedItemReason !== 'held' ? 'classic-item' : state.intent),
        retreatReason: unsafe ? 'space-pressure' : '',
        selectedItemReason,
        targetDistanceRatio: Number.isFinite(targetDistance) ? clamp(targetDistance / 120, 0, 1) : 1,
    };
}

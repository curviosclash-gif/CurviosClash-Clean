import {
    PRESSURE_LEVEL,
    PROJECTILE_THREAT,
    TARGET_ALIGNMENT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_FRONT,
} from './observation/ObservationSchemaV1.js';
import {
    applySteeringTowardPosition,
    clearSteeringInput,
    findNearestReadyPortal,
    findNearestReadySpecialGate,
    findQueuedRocketIndex,
    resolveHealthRatio,
    resolveHuntFallbackItemAction,
    resolveShieldRatio,
} from '../../hunt/HuntBotPolicy.js';
import { applyBotFlamethrowerInput } from '../../hunt/HuntBotFlamethrowerOps.js';
import { getPreferredFightEnemy } from '../../hunt/FightTargetSelector.js';
import { HUNT_CONFIG } from '../../hunt/HuntConfig.js';
import { resolveHuntTargetOwnerPlayer } from '../../hunt/HuntTargetingOps.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import { clamp } from '../../shared/utils/MathOps.js';
import {
    HEURISTIC_SAFETY_CONFIG,
    checkArenaCollision,
    checkTrailCollision,
    resolveHeuristicSelfTrailSkipRecentSegments,
} from './HeuristicBotSafetyOps.js';
import {
    WORLD_UP,
    hasYaw,
    readObservationValue,
    resolveStableStrafeRight,
} from './HeuristicBotPolicyOps.js';
import { findPreferredPickupTarget } from './BotPickupTargetingOps.js';
import { resolveOpportunisticEnemy } from './HeuristicHuntTargetingOps.js';
import {
    applyTrafficAvoidanceSteering,
    findImminentTrafficThreat,
} from './HeuristicTrafficAvoidanceOps.js';
const PRECISION_AIM_STEERING = Object.freeze({ precision: true, gain: 12 });
const FIGHT_CORRIDOR_BLOCKED = 0;
const FIGHT_CORRIDOR_TRAIL = 1;
const FIGHT_CORRIDOR_CLEAR = 2;
const HUNT_BREAKAWAY_DISTANCE_SQ = 18 * 18;
const NEUTRAL_TACTIC_BIAS = 0.5;
function resolveTacticStrength(value) {
    return clamp((Number(value) - NEUTRAL_TACTIC_BIAS) * 2, 0, 1);
}
function probeFightCorridor(policy, player, targetPosition, runtimeContext) {
    if (!policy || !player?.position || !targetPosition) return FIGHT_CORRIDOR_BLOCKED;
    policy._tmpGate.subVectors(targetPosition, player.position);
    const distance = policy._tmpGate.length();
    if (!(distance > 0.000001)) return FIGHT_CORRIDOR_BLOCKED;
    policy._tmpGate.multiplyScalar(1 / distance);
    const sampleCount = Math.min(
        HEURISTIC_SAFETY_CONFIG.shotProbeMaxSamples,
        Math.max(2, Math.ceil(distance / HEURISTIC_SAFETY_CONFIG.shotProbeStep))
    );
    const radius = Math.max(0.1, Number(player.hitboxRadius) || 0.8)
        * HEURISTIC_SAFETY_CONFIG.shotProbeRadiusMultiplier;
    const skipRecent = resolveHeuristicSelfTrailSkipRecentSegments(runtimeContext, player);
    let trailBlocked = false;
    for (let sampleIndex = 1; sampleIndex < sampleCount; sampleIndex += 1) {
        policy._tmpTarget.copy(player.position).addScaledVector(
            policy._tmpGate,
            distance * sampleIndex / sampleCount
        );
        if (checkArenaCollision(runtimeContext?.arena, policy._tmpTarget, radius)) {
            return FIGHT_CORRIDOR_BLOCKED;
        }
        if (!trailBlocked && checkTrailCollision(
            runtimeContext?.trailSpatialIndex,
            policy._tmpTarget,
            radius,
            player,
            skipRecent
        )) {
            trailBlocked = true;
        }
    }
    return trailBlocked ? FIGHT_CORRIDOR_TRAIL : FIGHT_CORRIDOR_CLEAR;
}
function applyRetreatSteering(policy, input, player, enemy) {
    if (!player?.position) return;
    if (enemy?.position) {
        policy._tmpGate.subVectors(player.position, enemy.position);
        if (policy._tmpGate.lengthSq() > 0.000001) {
            policy._tmpGate.normalize().multiplyScalar(24).add(player.position);
            applySteeringTowardPosition(policy, input, player, policy._tmpGate);
            return;
        }
    }
    if (typeof player.getDirection === 'function') player.getDirection(policy._tmpForward);
    else policy._tmpForward.set(0, 0, 1);
    if (policy._tmpForward.lengthSq() <= 0.000001) policy._tmpForward.set(0, 0, 1);
    else policy._tmpForward.normalize();
    policy._tmpRight.crossVectors(WORLD_UP, policy._tmpForward);
    if (policy._tmpRight.lengthSq() <= 0.000001) policy._tmpRight.set(1, 0, 0);
    else policy._tmpRight.normalize();
    input.yawRight = true;
    input.yawLeft = false;
}
function applyEvasiveRetreatSteering(policy, input, player, enemy, arena) {
    const strength = resolveTacticStrength(policy.profile.escapeLateralBias);
    if (!(strength > 0) || !player?.position || !enemy?.position) {
        applyRetreatSteering(policy, input, player, enemy);
        return;
    }
    policy._tmpGate.subVectors(player.position, enemy.position);
    if (policy._tmpGate.lengthSq() <= 0.000001) {
        applyRetreatSteering(policy, input, player, enemy);
        return;
    }
    policy._tmpGate.normalize();
    policy._tmpRight.crossVectors(WORLD_UP, policy._tmpGate);
    if (policy._tmpRight.lengthSq() <= 0.000001) policy._tmpRight.set(1, 0, 0);
    else policy._tmpRight.normalize();
    let side = resolveStableStrafeRight(player) ? 1 : -1;
    const bounds = arena?.bounds;
    if (bounds) {
        const centerX = (Number(bounds.minX) + Number(bounds.maxX)) * 0.5;
        const centerY = (Number(bounds.minY) + Number(bounds.maxY)) * 0.5;
        const centerZ = (Number(bounds.minZ) + Number(bounds.maxZ)) * 0.5;
        const centerDot = (centerX - player.position.x) * policy._tmpRight.x
            + (centerY - player.position.y) * policy._tmpRight.y
            + (centerZ - player.position.z) * policy._tmpRight.z;
        if (Number.isFinite(centerDot) && Math.abs(centerDot) > 0.01) side = centerDot > 0 ? 1 : -1;
    }
    policy._tmpTarget.copy(player.position)
        .addScaledVector(policy._tmpGate, 24)
        .addScaledVector(policy._tmpRight, side * 14 * strength);
    applyArenaCenterBias(policy._tmpTarget, player, arena);
    applySteeringTowardPosition(policy, input, player, policy._tmpTarget);
    input.rollRight = side < 0;
    input.rollLeft = side > 0;
}
function applyAttackCutoffTarget(policy, player, enemy, targetDistance) {
    const strength = resolveTacticStrength(policy.profile.attackCutoffBias);
    const velocity = enemy?.velocity;
    if (!(strength > 0) || !player?.position || !velocity) return;
    const velocityX = Number(velocity.x);
    const velocityY = Number(velocity.y);
    const velocityZ = Number(velocity.z);
    if (!Number.isFinite(velocityX) || !Number.isFinite(velocityY) || !Number.isFinite(velocityZ)) return;
    const extraLeadSeconds = strength * clamp(targetDistance / 160, 0.08, 0.48);
    policy._tmpAimTarget.x += velocityX * extraLeadSeconds;
    policy._tmpAimTarget.y += velocityY * extraLeadSeconds;
    policy._tmpAimTarget.z += velocityZ * extraLeadSeconds;
}
function applyArenaCenterBias(target, player, arena) {
    const bounds = arena?.bounds;
    if (!target || !player?.position || !bounds) return target;
    const minX = Number(bounds.minX);
    const maxX = Number(bounds.maxX);
    const minY = Number(bounds.minY);
    const maxY = Number(bounds.maxY);
    const minZ = Number(bounds.minZ);
    const maxZ = Number(bounds.maxZ);
    if (!Number.isFinite(minX) || !Number.isFinite(maxX)
        || !Number.isFinite(minY) || !Number.isFinite(maxY)
        || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) return target;
    const centerX = (minX + maxX) * 0.5;
    const centerY = (minY + maxY) * 0.5;
    const centerZ = (minZ + maxZ) * 0.5;
    const edgePressure = Math.max(
        Math.abs(player.position.x - centerX) / Math.max(1, (maxX - minX) * 0.5),
        Math.abs(player.position.y - centerY) / Math.max(1, (maxY - minY) * 0.5),
        Math.abs(player.position.z - centerZ) / Math.max(1, (maxZ - minZ) * 0.5)
    );
    const blend = clamp((edgePressure - 0.72) * 0.75, 0, 0.22);
    target.x += (centerX - target.x) * blend;
    target.y += (centerY - target.y) * blend;
    target.z += (centerZ - target.z) * blend;
    return target;
}
function resolveMovementIntent(policy, dt, requestedIntent) {
    const state = policy._huntState;
    state.commitTimer = Math.max(0, state.commitTimer - Math.max(0, Number(dt) || 0));
    const canSwitch = requestedIntent === 'retreat'
        || requestedIntent === 'traffic-avoid'
        || state.movementIntent === 'retreat'
        || state.movementIntent === 'search'
        || state.commitTimer <= 0;
    if (requestedIntent !== state.movementIntent && canSwitch) {
        state.movementIntent = requestedIntent;
        state.commitTimer = Math.max(0.1, Number(policy.difficulty?.tacticalCommitSeconds) || 0.64);
    }
    return state.movementIntent;
}
function applyBreakawaySteering(policy, input, player, enemy, arena) {
    if (!player?.position || !enemy?.position) return;
    policy._tmpGate.subVectors(player.position, enemy.position);
    if (policy._tmpGate.lengthSq() <= 0.000001) {
        applyRetreatSteering(policy, input, player, enemy);
        return;
    }
    policy._tmpGate.normalize();
    policy._tmpRight.crossVectors(WORLD_UP, policy._tmpGate);
    if (policy._tmpRight.lengthSq() <= 0.000001) policy._tmpRight.set(1, 0, 0);
    else policy._tmpRight.normalize();
    let side = resolveStableStrafeRight(player) ? 1 : -1;
    const bounds = arena?.bounds;
    if (bounds) {
        const centerX = (Number(bounds.minX) + Number(bounds.maxX)) * 0.5;
        const centerY = (Number(bounds.minY) + Number(bounds.maxY)) * 0.5;
        const centerZ = (Number(bounds.minZ) + Number(bounds.maxZ)) * 0.5;
        const centerDot = (centerX - player.position.x) * policy._tmpRight.x
            + (centerY - player.position.y) * policy._tmpRight.y
            + (centerZ - player.position.z) * policy._tmpRight.z;
        if (Number.isFinite(centerDot) && Math.abs(centerDot) > 0.01) side = centerDot > 0 ? 1 : -1;
    }
    policy._tmpTarget.copy(player.position)
        .addScaledVector(policy._tmpGate, 18)
        .addScaledVector(policy._tmpRight, side * 14);
    applyArenaCenterBias(policy._tmpTarget, player, arena);
    applySteeringTowardPosition(policy, input, player, policy._tmpTarget);
    input.rollRight = side < 0;
    input.rollLeft = side > 0;
}
export function applyHeuristicHuntBehavior(policy, input, dt, player, runtimeContext, observation) {
    policy._huntState.openingTimer = Math.max(
        0,
        Number(policy._huntState.openingTimer) - Math.max(0, Number(dt) || 0)
    );
    const players = Array.isArray(runtimeContext?.visiblePlayers)
        ? runtimeContext.visiblePlayers
        : (Array.isArray(runtimeContext?.players) ? runtimeContext.players : []);
    const huntTarget = runtimeContext?.huntTarget || null;
    const preferred = getPreferredFightEnemy(player, players, policy._tmpToEnemy, runtimeContext?.dt);
    const targetPlayer = resolveHuntTargetOwnerPlayer(huntTarget, players);
    let enemy = targetPlayer && (
        targetPlayer === preferred.enemy
        || preferred.candidateCount <= 1
        || targetPlayer.index === player.fightLastAttackerIndex
    ) ? targetPlayer : preferred.enemy;
    enemy = resolveOpportunisticEnemy(policy, player, players, enemy);
    if (player?.endlessForcedRetreat === true) {
        clearSteeringInput(input);
        applyRetreatSteering(policy, input, player, enemy);
        input.boost = true;
        input.shootMG = false;
        input.shootItem = false;
        input.shootRocket = false;
        input.shootItemIndex = -1;
        input.useItem = -1;
        return {
            intent: 'retreat',
            retreatReason: String(player.endlessRetreatReason || 'endless_wave'),
            targetDistanceRatio: 1,
            targetPlayerIndex: Number.isInteger(enemy?.index) ? enemy.index : -1,
            targetReachable: true,
            selectedItemReason: '',
        };
    }
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
    const attackWindow = clamp(policy.profile.attackWindow * policy.difficulty.attackWindowScale, 0.1, 1);
    if (enemy?.position) policy._tmpAimTarget.copy(enemy.position);
    else if (player?.position) policy._tmpAimTarget.copy(player.position);
    else policy._tmpAimTarget.set(0, 0, 0);
    if (enemy?.position && player?.position) {
        policy._tmpToEnemy.subVectors(enemy.position, player.position);
        targetDistanceSq = policy._tmpToEnemy.lengthSq();
        const targetDistance = Math.sqrt(targetDistanceSq);
        targetDistanceRatio = clamp(targetDistance / targetDistanceMax, 0, 1);
        if (targetDistanceSq > 0.000001) {
            policy._tmpToEnemy.multiplyScalar(1 / targetDistance);
            if (typeof player.getDirection === 'function') {
                player.getDirection(policy._tmpForward);
                if (policy._tmpForward.lengthSq() > 0.000001) policy._tmpForward.normalize();
                targetAlignment = policy._tmpForward.dot(policy._tmpToEnemy);
                targetInFront = targetAlignment >= policy.difficulty.aimDot;
            }
        }
        const leadSeconds = targetDistanceRatio >= attackWindow
            ? clamp(targetDistance / 90, 0, 0.75) * policy.difficulty.tacticalLeadScale
            : 0;
        if (leadSeconds > 0 && enemy.velocity && Number.isFinite(Number(enemy.velocity.x))
            && Number.isFinite(Number(enemy.velocity.y)) && Number.isFinite(Number(enemy.velocity.z))) {
            policy._tmpAimTarget.addScaledVector(enemy.velocity, leadSeconds);
        }
        if (targetDistanceRatio >= attackWindow) {
            applyAttackCutoffTarget(policy, player, enemy, targetDistance);
        }
    }
    const wallFront = clamp(readObservationValue(observation, WALL_DISTANCE_FRONT, 1), 0, 1);
    const aggression = clamp(0.5 + (vitalityRatio - enemyVitalityRatio) * 0.9, 0.12, 1);
    const survivalPressure = Math.max(pressureLevel, projectileThreat ? 0.84 : 0, (1 - vitalityRatio) * 0.95);
    const trafficThreat = findImminentTrafficThreat(policy, player, players);
    const rocketIndex = findQueuedRocketIndex(player);
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
        enemyDistanceSq: targetDistanceSq,
        crashRisk: projectileThreat ? 1 : (pressureLevel > 0.64 ? 0.5 : 0),
    });

    const mgAimDot = clamp(
        Number(resolveGameplayConfig(player).HUNT?.MG?.AIM_DOT_MIN ?? HUNT_CONFIG.MG.AIM_DOT_MIN),
        policy.difficulty.aimDot,
        1
    );
    const rocketWindow = targetDistanceRatio >= 0.16
        && targetDistanceRatio <= Math.min(0.9, attackWindow + 0.12);
    const shootReady = Math.max(0, Number(player?.shootCooldown) || 0) <= 0.001;
    const shouldProbeShot = shootReady && enemy?.position
        && targetInFront
        && targetAlignment >= policy.difficulty.aimDot
        && (targetDistanceRatio < attackWindow || (rocketIndex >= 0 && rocketWindow) || itemAction.shootItem === true);
    const fightCorridor = shouldProbeShot
        ? probeFightCorridor(policy, player, enemy.position, runtimeContext)
        : FIGHT_CORRIDOR_BLOCKED;
    const clearMgShot = fightCorridor !== FIGHT_CORRIDOR_BLOCKED;
    const clearProjectileShot = fightCorridor === FIGHT_CORRIDOR_CLEAR;
    const finisherOpportunity = (Number(policy.profile.finisherBias) > NEUTRAL_TACTIC_BIAS
        || Number(policy.profile.openingFanoutBias) > NEUTRAL_TACTIC_BIAS)
        && enemy
        && enemyVitalityRatio <= 0.28
        && vitalityRatio >= 0.30
        && survivalPressure < 0.70
        && !projectileThreat
        && targetInFront
        && targetAlignment >= mgAimDot
        && clearMgShot;
    if (enemy && targetInFront && targetAlignment >= mgAimDot
        && survivalPressure < 0.84 && aggression >= 0.38
        && targetDistanceRatio < attackWindow && clearMgShot) {
        input.shootMG = true;
    }
    if (rocketIndex >= 0 && enemy && targetInFront && targetAlignment >= policy.difficulty.aimDot
        && rocketWindow && pressureLevel < 0.9
        && (aggression >= 0.32 || enemyVitalityRatio > 0.55 || survivalPressure > 0.72)
        && clearProjectileShot) {
        input.shootRocket = true;
    }
    if (itemAction.useItem >= 0) input.useItem = itemAction.useItem;
    else if (clearProjectileShot && rocketIndex < 0 && itemAction.shootItem === true && itemAction.shootItemIndex >= 0) {
        input.shootItem = true;
        input.shootItemIndex = itemAction.shootItemIndex;
    }
    applyBotFlamethrowerInput(
        policy,
        input,
        player,
        enemy,
        enemy?.position && player?.position ? player.position.distanceToSquared(enemy.position) : Infinity,
    );

    const retreatRequested = enemy && !finisherOpportunity
        && (vitalityRatio <= policy.profile.retreatVitality
            || (vitalityRatio < 0.52 && survivalPressure > policy.profile.retreatPressure));
    const pickupTarget = !retreatRequested && survivalPressure < 0.82
        ? findPreferredPickupTarget(player, runtimeContext, { pressure: survivalPressure, maxDistance: 75 })
        : null;
    const openingHook = Number(policy.profile.openingHookBias) > NEUTRAL_TACTIC_BIAS
        && policy._huntState.openingTimer > 0;
    const openingFanout = (Number(policy.profile.openingFanoutBias) > NEUTRAL_TACTIC_BIAS
        || openingHook)
        && policy._huntState.openingTimer > 0;
    const requestedMovementIntent = trafficThreat
        ? 'traffic-avoid'
        : openingHook
        ? 'opening-hook'
        : openingFanout
        ? 'opening-fanout'
        : retreatRequested
        ? 'retreat'
        : (pickupTarget ? 'pickup'
        : (targetDistanceRatio > policy.profile.strafeDistance
            ? 'approach'
            : (targetDistanceSq > HUNT_BREAKAWAY_DISTANCE_SQ ? 'strafe' : 'breakaway')));
    const movementIntent = resolveMovementIntent(policy, dt, enemy ? requestedMovementIntent : 'search');

    if (movementIntent === 'traffic-avoid' && trafficThreat) {
        clearSteeringInput(input);
        applyTrafficAvoidanceSteering(policy, input, player, trafficThreat);
        input.boost = false;
        intent = 'traffic-avoid';
    } else if (movementIntent === 'opening-fanout' || movementIntent === 'opening-hook') {
        clearSteeringInput(input);
        const stableFanRight = resolveStableStrafeRight(player);
        const hookActive = movementIntent === 'opening-hook'
            && policy._huntState.openingTimer < 0.50
            && policy._huntState.openingTimer >= 0.42;
        const fanRight = hookActive
            ? !stableFanRight
            : stableFanRight;
        if (hookActive) {
            input.yawRight = fanRight;
            input.yawLeft = !fanRight;
        } else {
            input.yawRight = fanRight;
            input.yawLeft = !fanRight;
        }
        input.boost = false;
        intent = movementIntent;
    } else if (enemy && movementIntent === 'retreat') {
        intent = 'retreat';
        retreatReason = vitalityRatio <= policy.profile.retreatVitality ? 'low-vitality' : 'pressure';
        const huntConfig = resolveGameplayConfig(player).HUNT;
        const gateAssistRange = Math.max(24, Number(huntConfig?.RETREAT_GATE_RANGE || 54));
        const specialGates = Array.isArray(runtimeContext?.arena?.specialGates) ? runtimeContext.arena.specialGates : [];
        const readyGate = survivalPressure > 0.8
            ? findNearestReadySpecialGate(policy, player, specialGates, gateAssistRange * gateAssistRange)
            : null;
        const portalAssistRange = Math.max(30, gateAssistRange * 1.25);
        const readyPortal = readyGate?.gate
            ? null
            : findNearestReadyPortal(policy, player, runtimeContext?.arena, portalAssistRange * portalAssistRange);
        clearSteeringInput(input);
        if (readyGate?.gate) applySteeringTowardPosition(policy, input, player, readyGate.gate.pos);
        else if (readyPortal?.entry) applySteeringTowardPosition(policy, input, player, readyPortal.entry);
        else applyEvasiveRetreatSteering(policy, input, player, enemy, runtimeContext?.arena);
        if (!hasYaw(input)) applyRetreatSteering(policy, input, player, enemy);
        input.boost = wallFront > Math.max(policy.profile.safetyDistance, 0.34);
        input.shootMG = false;
        if (rocketIndex < 0) {
            input.shootItem = false;
            input.shootRocket = false;
            input.shootItemIndex = -1;
        }
    } else if (pickupTarget?.mesh?.position) {
        clearSteeringInput(input);
        applySteeringTowardPosition(policy, input, player, pickupTarget.mesh.position);
        input.boost = wallFront > 0.55 && survivalPressure < 0.48;
        intent = 'pickup-seek';
    } else if (enemy?.position && player?.position) {
        clearSteeringInput(input);
        if (movementIntent === 'approach' && wallFront > policy.profile.safetyDistance) {
            policy._tmpTarget.copy(policy._tmpAimTarget);
            applyArenaCenterBias(policy._tmpTarget, player, runtimeContext?.arena);
            applySteeringTowardPosition(
                policy,
                input,
                player,
                policy._tmpTarget,
                targetDistanceRatio < attackWindow ? PRECISION_AIM_STEERING : null
            );
            input.boost = targetAlignment >= 0.82
                && wallFront > Math.max(policy.profile.safetyDistance, 0.34)
                && survivalPressure < 0.72;
            intent = aggression > 0.5 ? 'attack-approach' : 'approach';
        } else if (movementIntent === 'strafe') {
            policy._tmpTarget.copy(policy._tmpAimTarget);
            applyArenaCenterBias(policy._tmpTarget, player, runtimeContext?.arena);
            applySteeringTowardPosition(policy, input, player, policy._tmpTarget, PRECISION_AIM_STEERING);
            const strafeRight = resolveStableStrafeRight(player);
            input.rollRight = strafeRight;
            input.rollLeft = !strafeRight;
            input.boost = false;
            intent = 'strafe';
        } else {
            applyBreakawaySteering(policy, input, player, enemy, runtimeContext?.arena);
            input.boost = false;
            intent = 'breakaway';
        }
        if (wallFront <= policy.profile.safetyDistance) input.boost = false;
    }
    return {
        intent,
        retreatReason,
        targetDistanceRatio,
        targetPlayerIndex: Number.isInteger(enemy?.index) ? enemy.index : -1,
        targetReachable: !shouldProbeShot || fightCorridor !== FIGHT_CORRIDOR_BLOCKED,
        selectedItemReason: itemAction.type || (rocketIndex >= 0 ? 'rocket' : ''),
    };
}

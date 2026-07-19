import {
    PLANAR_MODE_ACTIVE,
    PROJECTILE_THREAT,
    WALL_DISTANCE_DOWN,
    WALL_DISTANCE_FRONT,
    WALL_DISTANCE_LEFT,
    WALL_DISTANCE_RIGHT,
    WALL_DISTANCE_UP,
} from './observation/ObservationSchemaV1.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import { clamp } from '../../utils/MathOps.js';
import { WORLD_UP, readObservationValue } from './HeuristicBotPolicyOps.js';
import { resolveDirectionalProjectileThreat } from './HeuristicProjectileSafetyOps.js';
export {
    applyHeuristicObstacleAvoidance,
    resolveBoostPressureCeiling,
} from './HeuristicObstacleAvoidanceOps.js';

export const HEURISTIC_SAFETY_STATES = Object.freeze({
    NORMAL: 'normal',
    EVADE: 'evade',
    RECOVER: 'recover',
    COOLDOWN: 'cooldown',
});

export const HEURISTIC_SAFETY_CONFIG = Object.freeze({
    probeInterval: 0.08,
    probeSampleCount: 3,
    probeMinLookAhead: 6,
    probeMaxLookAhead: 16,
    probeSpeedSeconds: 0.34,
    probeSideSpread: 0.82,
    probeRadiusMultiplier: 1.6,
    trailSkipRecentSegments: 20,
    minimumDangerClearance: 0.34,
    turnTieThreshold: 0.06,
    turnSwitchMargin: 0.14,
    verticalPreferenceMargin: 0.05,
    turnHoldSeconds: 0.32,
    evadeDuration: 0.38,
    recoveryDuration: 0.92,
    cooldownDuration: 0.58,
    bounceWindow: 1.25,
    wallBouncesForRecovery: 2,
    stuckSampleInterval: 0.28,
    stuckTriggerSeconds: 0.84,
    stuckProgressFloor: 0.35,
    stuckProgressSpeedScale: 0.12,
    maximumTimerStep: 0.12,
    projectileThreatRange: 32,
    projectileImpactHorizon: 1.6,
    projectileSafetyRadius: 3.2,
    shotProbeStep: 5,
    shotProbeMaxSamples: 20,
    shotProbeRadiusMultiplier: 0.55,
});

function clamp01(value) {
    return clamp(Number(value) || 0, 0, 1);
}

function sanitizeTimerStep(dt) {
    const numeric = Number(dt);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.min(numeric, HEURISTIC_SAFETY_CONFIG.maximumTimerStep);
}

export function createHeuristicSafetyState() {
    return {
        state: HEURISTIC_SAFETY_STATES.NORMAL,
        reason: '',
        phaseTimer: 0,
        probeTimer: 0,
        probeDirty: true,
        turnDirection: 0,
        turnAxis: 'yaw',
        turnHoldTimer: 0,
        bounceWindowTimer: 0,
        bounceCount: 0,
        pendingBounce: false,
        recoveryRequested: false,
        positionInitialized: false,
        lastX: 0,
        lastY: 0,
        lastZ: 0,
        stuckSampleTimer: 0,
        stuckSeconds: 0,
        collisionNormalX: 0,
        collisionNormalY: 0,
        collisionNormalZ: 0,
        hasCollisionNormal: false,
        sampleArenaClearance: 1,
        sampleTrailClearance: 1,
        frontArenaClearance: 1,
        frontTrailClearance: 1,
        leftArenaClearance: 1,
        leftTrailClearance: 1,
        rightArenaClearance: 1,
        rightTrailClearance: 1,
        upArenaClearance: 1,
        upTrailClearance: 1,
        downArenaClearance: 1,
        downTrailClearance: 1,
        frontClearance: 1,
        leftClearance: 1,
        rightClearance: 1,
        upClearance: 1,
        downClearance: 1,
        planarMode: false,
        projectileYaw: 0,
        projectilePitch: 0,
        projectileTimeToImpact: Infinity,
    };
}

export function resetHeuristicSafetyState(state) {
    if (!state) return;
    state.state = HEURISTIC_SAFETY_STATES.NORMAL;
    state.reason = '';
    state.phaseTimer = 0;
    state.probeTimer = 0;
    state.probeDirty = true;
    state.turnDirection = 0;
    state.turnAxis = 'yaw';
    state.turnHoldTimer = 0;
    state.bounceWindowTimer = 0;
    state.bounceCount = 0;
    state.pendingBounce = false;
    state.recoveryRequested = false;
    state.positionInitialized = false;
    state.lastX = 0;
    state.lastY = 0;
    state.lastZ = 0;
    state.stuckSampleTimer = 0;
    state.stuckSeconds = 0;
    state.collisionNormalX = 0;
    state.collisionNormalY = 0;
    state.collisionNormalZ = 0;
    state.hasCollisionNormal = false;
    state.sampleArenaClearance = 1;
    state.sampleTrailClearance = 1;
    state.frontArenaClearance = 1;
    state.frontTrailClearance = 1;
    state.leftArenaClearance = 1;
    state.leftTrailClearance = 1;
    state.rightArenaClearance = 1;
    state.rightTrailClearance = 1;
    state.upArenaClearance = 1;
    state.upTrailClearance = 1;
    state.downArenaClearance = 1;
    state.downTrailClearance = 1;
    state.frontClearance = 1;
    state.leftClearance = 1;
    state.rightClearance = 1;
    state.upClearance = 1;
    state.downClearance = 1;
    state.planarMode = false;
    state.projectileYaw = 0;
    state.projectilePitch = 0;
    state.projectileTimeToImpact = Infinity;
}

export function recordHeuristicBounce(state, type, normal = null) {
    if (!state) return;
    const source = String(type || '').trim().toUpperCase();
    state.bounceCount = state.bounceWindowTimer > 0
        ? Math.min(8, state.bounceCount + 1)
        : 1;
    state.bounceWindowTimer = HEURISTIC_SAFETY_CONFIG.bounceWindow;
    state.pendingBounce = source === 'TRAIL' || source === 'WALL';
    state.recoveryRequested = source === 'TRAIL'
        || (source === 'WALL' && state.bounceCount >= HEURISTIC_SAFETY_CONFIG.wallBouncesForRecovery);
    state.reason = source === 'TRAIL' ? 'trail-bounce' : 'wall-bounce';
    state.probeDirty = true;

    const nx = Number(normal?.x);
    const ny = Number(normal?.y);
    const nz = Number(normal?.z);
    const lengthSq = nx * nx + ny * ny + nz * nz;
    if (Number.isFinite(lengthSq) && lengthSq > 0.000001) {
        const inverseLength = 1 / Math.sqrt(lengthSq);
        state.collisionNormalX = nx * inverseLength;
        state.collisionNormalY = ny * inverseLength;
        state.collisionNormalZ = nz * inverseLength;
        state.hasCollisionNormal = true;
    }
}

export function checkArenaCollision(arena, position, radius) {
    if (typeof arena?.checkCollisionFast === 'function') {
        return !!arena.checkCollisionFast(position, radius);
    }
    if (typeof arena?.checkCollision === 'function') {
        return !!arena.checkCollision(position, radius);
    }
    return false;
}

export function checkTrailCollision(trailSpatialIndex, position, radius, player) {
    if (typeof trailSpatialIndex?.checkGlobalCollision !== 'function') return false;
    const playerIndex = Number.isInteger(player?.index) ? player.index : -1;
    const hit = trailSpatialIndex.checkGlobalCollision(
        position,
        radius,
        playerIndex,
        HEURISTIC_SAFETY_CONFIG.trailSkipRecentSegments,
        null
    );
    return !!(hit && hit.hit !== false);
}

function samplePath(policy, state, runtimeContext, player, direction, lookAhead, radius) {
    state.sampleArenaClearance = 1;
    state.sampleTrailClearance = 1;
    const sampleCount = HEURISTIC_SAFETY_CONFIG.probeSampleCount;
    for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
        const ratio = sampleIndex / sampleCount;
        policy._tmpTarget.copy(player.position).addScaledVector(direction, lookAhead * ratio);
        if (
            state.sampleArenaClearance === 1
            && checkArenaCollision(runtimeContext?.arena, policy._tmpTarget, radius)
        ) {
            state.sampleArenaClearance = ratio;
        }
        if (
            state.sampleTrailClearance === 1
            && checkTrailCollision(runtimeContext?.trailSpatialIndex, policy._tmpTarget, radius, player)
        ) {
            state.sampleTrailClearance = ratio;
        }
        if (state.sampleArenaClearance < 1 && state.sampleTrailClearance < 1) break;
    }
}

function refreshSafetyProbes(policy, state, player, runtimeContext, observation) {
    state.probeTimer = HEURISTIC_SAFETY_CONFIG.probeInterval;
    state.probeDirty = false;
    const wallFront = clamp01(readObservationValue(observation, WALL_DISTANCE_FRONT, 1));
    const wallLeft = clamp01(readObservationValue(observation, WALL_DISTANCE_LEFT, 1));
    const wallRight = clamp01(readObservationValue(observation, WALL_DISTANCE_RIGHT, 1));
    const wallUp = clamp01(readObservationValue(observation, WALL_DISTANCE_UP, 1));
    const wallDown = clamp01(readObservationValue(observation, WALL_DISTANCE_DOWN, 1));
    state.planarMode = readObservationValue(observation, PLANAR_MODE_ACTIVE, 0) >= 0.5
        || !!resolveGameplayConfig(player).GAMEPLAY.PLANAR_MODE;

    state.frontArenaClearance = 1;
    state.frontTrailClearance = 1;
    state.leftArenaClearance = 1;
    state.leftTrailClearance = 1;
    state.rightArenaClearance = 1;
    state.rightTrailClearance = 1;
    state.upArenaClearance = 1;
    state.upTrailClearance = 1;
    state.downArenaClearance = 1;
    state.downTrailClearance = 1;

    if (player?.position && typeof player?.getDirection === 'function') {
        player.getDirection(policy._tmpForward);
        if (policy._tmpForward.lengthSq() <= 0.000001) {
            policy._tmpForward.set(0, 0, 1);
        } else {
            policy._tmpForward.normalize();
        }
        policy._tmpRight.crossVectors(WORLD_UP, policy._tmpForward);
        if (policy._tmpRight.lengthSq() <= 0.000001) {
            policy._tmpRight.set(1, 0, 0);
        } else {
            policy._tmpRight.normalize();
        }
        policy._tmpUp.crossVectors(policy._tmpForward, policy._tmpRight);
        if (policy._tmpUp.lengthSq() <= 0.000001) {
            policy._tmpUp.copy(WORLD_UP);
        } else {
            policy._tmpUp.normalize();
        }

        const speedLookAhead = Math.abs(Number(player.speed) || Number(player.baseSpeed) || 0)
            * HEURISTIC_SAFETY_CONFIG.probeSpeedSeconds;
        const lookAhead = clamp(
            speedLookAhead,
            HEURISTIC_SAFETY_CONFIG.probeMinLookAhead,
            HEURISTIC_SAFETY_CONFIG.probeMaxLookAhead
        );
        const radius = Math.max(0.1, Number(player.hitboxRadius) || 0.8)
            * HEURISTIC_SAFETY_CONFIG.probeRadiusMultiplier;

        samplePath(policy, state, runtimeContext, player, policy._tmpForward, lookAhead, radius);
        state.frontArenaClearance = state.sampleArenaClearance;
        state.frontTrailClearance = state.sampleTrailClearance;

        policy._tmpGate.copy(policy._tmpForward)
            .addScaledVector(policy._tmpRight, HEURISTIC_SAFETY_CONFIG.probeSideSpread)
            .normalize();
        samplePath(policy, state, runtimeContext, player, policy._tmpGate, lookAhead, radius);
        state.leftArenaClearance = state.sampleArenaClearance;
        state.leftTrailClearance = state.sampleTrailClearance;

        policy._tmpGate.copy(policy._tmpForward)
            .addScaledVector(policy._tmpRight, -HEURISTIC_SAFETY_CONFIG.probeSideSpread)
            .normalize();
        samplePath(policy, state, runtimeContext, player, policy._tmpGate, lookAhead, radius);
        state.rightArenaClearance = state.sampleArenaClearance;
        state.rightTrailClearance = state.sampleTrailClearance;

        if (!state.planarMode) {
            policy._tmpGate.copy(policy._tmpForward)
                .addScaledVector(policy._tmpUp, HEURISTIC_SAFETY_CONFIG.probeSideSpread)
                .normalize();
            samplePath(policy, state, runtimeContext, player, policy._tmpGate, lookAhead, radius);
            state.upArenaClearance = state.sampleArenaClearance;
            state.upTrailClearance = state.sampleTrailClearance;

            policy._tmpGate.copy(policy._tmpForward)
                .addScaledVector(policy._tmpUp, -HEURISTIC_SAFETY_CONFIG.probeSideSpread)
                .normalize();
            samplePath(policy, state, runtimeContext, player, policy._tmpGate, lookAhead, radius);
            state.downArenaClearance = state.sampleArenaClearance;
            state.downTrailClearance = state.sampleTrailClearance;
        }
    }

    state.frontClearance = Math.min(wallFront, state.frontArenaClearance, state.frontTrailClearance);
    state.leftClearance = Math.min(wallLeft, state.leftArenaClearance, state.leftTrailClearance);
    state.rightClearance = Math.min(wallRight, state.rightArenaClearance, state.rightTrailClearance);
    state.upClearance = state.planarMode ? 0 : Math.min(wallUp, state.upArenaClearance, state.upTrailClearance);
    state.downClearance = state.planarMode ? 0 : Math.min(wallDown, state.downArenaClearance, state.downTrailClearance);
}

function updateStuckState(state, dt, player) {
    if (!player?.position || dt <= 0) return;
    state.stuckSampleTimer -= dt;
    if (state.stuckSampleTimer > 0) return;
    state.stuckSampleTimer = HEURISTIC_SAFETY_CONFIG.stuckSampleInterval;

    const x = Number(player.position.x) || 0;
    const y = Number(player.position.y) || 0;
    const z = Number(player.position.z) || 0;
    if (!state.positionInitialized) {
        state.lastX = x;
        state.lastY = y;
        state.lastZ = z;
        state.positionInitialized = true;
        return;
    }

    if (state.state === HEURISTIC_SAFETY_STATES.RECOVER) {
        state.stuckSeconds = 0;
    } else {
        const dx = x - state.lastX;
        const dy = y - state.lastY;
        const dz = z - state.lastZ;
        const speed = Math.abs(Number(player.speed) || Number(player.baseSpeed) || 0);
        const minimumProgress = Math.max(
            HEURISTIC_SAFETY_CONFIG.stuckProgressFloor,
            speed * HEURISTIC_SAFETY_CONFIG.stuckSampleInterval * HEURISTIC_SAFETY_CONFIG.stuckProgressSpeedScale
        );
        if ((dx * dx + dy * dy + dz * dz) < minimumProgress * minimumProgress) {
            state.stuckSeconds += HEURISTIC_SAFETY_CONFIG.stuckSampleInterval;
        } else {
            state.stuckSeconds = Math.max(0, state.stuckSeconds - HEURISTIC_SAFETY_CONFIG.stuckSampleInterval);
        }
        if (state.stuckSeconds >= HEURISTIC_SAFETY_CONFIG.stuckTriggerSeconds) {
            state.recoveryRequested = true;
            state.reason = 'stuck';
        }
    }

    state.lastX = x;
    state.lastY = y;
    state.lastZ = z;
}

function enterSafetyState(state, nextState, reason) {
    state.state = nextState;
    state.reason = reason || state.reason || '';
    if (nextState === HEURISTIC_SAFETY_STATES.EVADE) {
        state.phaseTimer = HEURISTIC_SAFETY_CONFIG.evadeDuration;
    } else if (nextState === HEURISTIC_SAFETY_STATES.RECOVER) {
        state.phaseTimer = HEURISTIC_SAFETY_CONFIG.recoveryDuration;
        state.stuckSeconds = 0;
    } else if (nextState === HEURISTIC_SAFETY_STATES.COOLDOWN) {
        state.phaseTimer = HEURISTIC_SAFETY_CONFIG.cooldownDuration;
    } else {
        state.phaseTimer = 0;
        state.reason = '';
        state.turnDirection = 0;
        state.turnAxis = 'yaw';
    }
}

function resolveDangerReason(state, projectileThreat, dangerThreshold) {
    if (state.frontTrailClearance <= dangerThreshold) return 'trail-ahead';
    if (state.frontArenaClearance <= dangerThreshold || state.frontClearance <= dangerThreshold) return 'wall-ahead';
    if (projectileThreat) return 'projectile';
    if (state.pendingBounce) return state.reason || 'bounce';
    return '';
}

function updateSafetyPhase(state, danger, dangerReason) {
    if (state.recoveryRequested) {
        enterSafetyState(state, HEURISTIC_SAFETY_STATES.RECOVER, state.reason || dangerReason || 'recovery');
    } else if (state.state === HEURISTIC_SAFETY_STATES.NORMAL) {
        if (danger || state.pendingBounce) {
            enterSafetyState(state, HEURISTIC_SAFETY_STATES.EVADE, dangerReason || state.reason || 'danger');
        }
    } else if (state.state === HEURISTIC_SAFETY_STATES.EVADE) {
        if (state.phaseTimer <= 0) {
            if (danger) enterSafetyState(state, HEURISTIC_SAFETY_STATES.EVADE, dangerReason);
            else enterSafetyState(state, HEURISTIC_SAFETY_STATES.COOLDOWN, state.reason);
        }
    } else if (state.state === HEURISTIC_SAFETY_STATES.RECOVER) {
        if (state.phaseTimer <= 0) {
            if (danger) enterSafetyState(state, HEURISTIC_SAFETY_STATES.EVADE, dangerReason);
            else enterSafetyState(state, HEURISTIC_SAFETY_STATES.COOLDOWN, state.reason);
        }
    } else if (state.state === HEURISTIC_SAFETY_STATES.COOLDOWN) {
        if (danger) enterSafetyState(state, HEURISTIC_SAFETY_STATES.EVADE, dangerReason);
        else if (state.phaseTimer <= 0) enterSafetyState(state, HEURISTIC_SAFETY_STATES.NORMAL, '');
    }
    state.pendingBounce = false;
    state.recoveryRequested = false;
}

function resolvePreferredTurn(policy, state, player, dangerThreshold) {
    const left = state.leftClearance;
    const right = state.rightClearance;
    const up = state.upClearance;
    const down = state.downClearance;
    const leftScore = left + (state.projectileYaw > 0 ? 0.18 : 0);
    const rightScore = right + (state.projectileYaw < 0 ? 0.18 : 0);
    const upScore = up + (state.projectilePitch > 0 ? 0.18 : 0);
    const downScore = down + (state.projectilePitch < 0 ? 0.18 : 0);
    let preferredAxis = 'yaw';
    let preferred = leftScore > rightScore ? 1 : -1;
    let preferredScore = Math.max(leftScore, rightScore);
    const bestVerticalScore = Math.max(upScore, downScore);
    if (!state.planarMode && bestVerticalScore > preferredScore + HEURISTIC_SAFETY_CONFIG.verticalPreferenceMargin) {
        preferredAxis = 'pitch';
        preferred = upScore > downScore ? 1 : -1;
        preferredScore = bestVerticalScore;
    }
    if (preferredAxis === 'yaw' && Math.abs(leftScore - rightScore) <= HEURISTIC_SAFETY_CONFIG.turnTieThreshold) {
        if (state.hasCollisionNormal) {
            const normalRightDot = state.collisionNormalX * policy._tmpRight.x
                + state.collisionNormalY * policy._tmpRight.y
                + state.collisionNormalZ * policy._tmpRight.z;
            preferred = normalRightDot >= 0 ? 1 : -1;
        } else {
            preferred = ((Number(player?.index) || 0) & 1) === 0 ? 1 : -1;
        }
    }

    const heldClearance = state.turnAxis === 'pitch'
        ? (state.turnDirection > 0 ? up : down)
        : (state.turnDirection > 0 ? left : right);
    const heldPathFailed = heldClearance <= dangerThreshold
        && preferredScore >= heldClearance + HEURISTIC_SAFETY_CONFIG.turnSwitchMargin;
    if (state.turnDirection === 0 || state.turnHoldTimer <= 0 || heldPathFailed) {
        state.turnAxis = preferredAxis;
        state.turnDirection = preferred;
        state.turnHoldTimer = HEURISTIC_SAFETY_CONFIG.turnHoldSeconds;
    }
}

export function applyHeuristicSafetyArbiter(policy, input, dt, player, runtimeContext, observation, decision = null) {
    const state = policy?._safetyState;
    if (!state) return null;
    const timerStep = sanitizeTimerStep(dt);
    state.phaseTimer = Math.max(0, state.phaseTimer - timerStep);
    state.probeTimer -= timerStep;
    state.turnHoldTimer = Math.max(0, state.turnHoldTimer - timerStep);
    state.bounceWindowTimer = Math.max(0, state.bounceWindowTimer - timerStep);
    if (state.bounceWindowTimer <= 0) state.bounceCount = 0;

    updateStuckState(state, timerStep, player);
    if (state.probeDirty || state.probeTimer <= 0) {
        refreshSafetyProbes(policy, state, player, runtimeContext, observation);
    }

    const dangerThreshold = Math.max(
        Number(policy.profile?.safetyDistance) || 0,
        HEURISTIC_SAFETY_CONFIG.minimumDangerClearance
    );
    const observedProjectileThreat = readObservationValue(observation, PROJECTILE_THREAT, 0) >= 0.5;
    const hasProjectileRuntimeSource = Array.isArray(runtimeContext?.projectiles);
    const directionalProjectileThreat = resolveDirectionalProjectileThreat(
        policy,
        state,
        player,
        runtimeContext,
        HEURISTIC_SAFETY_CONFIG
    );
    const projectileThreat = hasProjectileRuntimeSource
        ? directionalProjectileThreat
        : observedProjectileThreat;
    const frontDanger = state.frontClearance <= dangerThreshold;
    const projectileDanger = projectileThreat;
    const danger = frontDanger || projectileDanger;
    const dangerReason = resolveDangerReason(state, projectileDanger, dangerThreshold);
    updateSafetyPhase(state, danger, dangerReason);

    const safetyActive = state.state === HEURISTIC_SAFETY_STATES.EVADE
        || state.state === HEURISTIC_SAFETY_STATES.RECOVER;
    if (!safetyActive) return state;

    resolvePreferredTurn(policy, state, player, dangerThreshold);
    input.pitchAxis = undefined;
    input.yawAxis = undefined;
    input.rollAxis = undefined;
    input.yawLeft = state.turnAxis === 'yaw' && state.turnDirection > 0;
    input.yawRight = state.turnAxis === 'yaw' && state.turnDirection < 0;
    input.pitchUp = state.turnAxis === 'pitch' && state.turnDirection > 0;
    input.pitchDown = state.turnAxis === 'pitch' && state.turnDirection < 0;
    input.rollLeft = false;
    input.rollRight = false;
    input.boost = false;
    input.shootMG = false;
    input.shootItem = false;
    input.shootItemIndex = -1;
    if (decision) {
        decision.intent = state.state === HEURISTIC_SAFETY_STATES.RECOVER ? 'recover' : 'evade';
        if (!decision.retreatReason) decision.retreatReason = state.reason;
    }
    return state;
}

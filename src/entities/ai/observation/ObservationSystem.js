// ============================================
// ObservationSystem.js - centralized runtime observation extraction
// ============================================

import * as THREE from 'three';
import {
    BOOST_ACTIVE,
    CONTEXT_RESERVED,
    HEALTH_RATIO,
    INVENTORY_COUNT_RATIO,
    ITEM_SLOT_00,
    LOCAL_OPENNESS_RATIO,
    MODE_ID,
    OBSERVATION_LENGTH_V1,
    PLANAR_MODE_ACTIVE,
    PRESSURE_LEVEL,
    PROJECTILE_THREAT,
    SELECTED_ITEM_SLOT,
    SHIELD_RATIO,
    SPEED_RATIO,
    TARGET_ALIGNMENT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_DOWN,
    WALL_DISTANCE_FRONT,
    WALL_DISTANCE_LEFT,
    WALL_DISTANCE_RIGHT,
    WALL_DISTANCE_UP,
} from './ObservationSchemaV1.js';
import {
    clamp,
    clamp01,
    normalizeDistanceRatio,
    normalizeHealthRatio,
    normalizeShieldRatio,
    normalizeSigned,
    normalizeSpeedRatio,
    normalizeRatio,
    toBinaryFlag,
} from './ObservationNormalizeOps.js';
import { encodeItemSlots, ITEM_SLOT_COUNT } from './ItemSlotEncoder.js';
import { encodeModeId } from './ModeFeatureEncoder.js';
import {
    buildPerceptionBasis,
    computeProjectileThreatFlag,
    findNearestEnemySample,
    PERCEPTION_THRESHOLDS,
    resolveAdaptiveWallProbeSteps,
    sampleWallDistance,
} from '../perception/EnvironmentSamplingOps.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TMP_FORWARD = new THREE.Vector3();
const TMP_RIGHT = new THREE.Vector3();
const TMP_UP = new THREE.Vector3();
const TMP_LEFT = new THREE.Vector3();
const TMP_DOWN = new THREE.Vector3();
const TMP_TO_TARGET = new THREE.Vector3();
const TMP_DIRECTION = new THREE.Vector3();
const TMP_PROBE = new THREE.Vector3();
const WALL_SAMPLE_COUNT = 5;
const WALL_INDEX_FRONT = 0;
const WALL_INDEX_LEFT = 1;
const WALL_INDEX_RIGHT = 2;
const WALL_INDEX_UP = 3;
const WALL_INDEX_DOWN = 4;
const WALL_PROBE_STATE_BY_PLAYER = new WeakMap();

const DEFAULT_CONTEXT = Object.freeze({
    arena: null,
    players: [],
    projectiles: [],
    mode: 'classic',
    planarMode: false,
    wallProbeDistance: 45,
    wallProbeMinSteps: 8,
    wallProbeMaxSteps: 20,
    wallProbeCacheWindowMs: 18,
    wallProbeReusePositionEps: 0.2,
    wallProbeReuseDirectionDot: 0.999,
    targetDistanceMax: 120,
    projectileThreatRange: 28,
});
const OBSERVATION_CONTEXT_CACHE_FLAG = '__observationContextV1';

function resetObservationTarget(target) {
    for (let i = 0; i < OBSERVATION_LENGTH_V1; i++) {
        target[i] = 0;
    }
    return target;
}

function getObservationTarget(target) {
    if (target && typeof target.length === 'number' && typeof target.fill === 'function') {
        return resetObservationTarget(target);
    }
    return new Array(OBSERVATION_LENGTH_V1).fill(0);
}

function buildBasisFromPlayer(player) {
    player.getDirection(TMP_FORWARD).normalize();
    buildPerceptionBasis(TMP_FORWARD, TMP_RIGHT, TMP_UP, WORLD_UP);
}

function sampleWallDistanceRatio(arena, origin, direction, radius, maxDistance, steps = 20) {
    const safeMaxDistance = Math.max(1, Number(maxDistance) || 1);
    const distance = sampleWallDistance(arena, origin, direction, radius, safeMaxDistance, steps, TMP_PROBE);
    return normalizeDistanceRatio(distance, safeMaxDistance, 0);
}

function resolveNowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

function createWallProbeState() {
    const ratios = new Float32Array(WALL_SAMPLE_COUNT);
    for (let i = 0; i < WALL_SAMPLE_COUNT; i++) {
        ratios[i] = -1;
    }
    return {
        position: new THREE.Vector3(),
        forward: new THREE.Vector3(),
        ratios,
        sampledAtMs: 0,
        valid: false,
    };
}

function getWallProbeState(player) {
    let state = WALL_PROBE_STATE_BY_PLAYER.get(player);
    if (!state) {
        state = createWallProbeState();
        WALL_PROBE_STATE_BY_PLAYER.set(player, state);
    }
    return state;
}

function canReuseWallProbeState(state, player, forward, runtimeContext, nowMs) {
    if (!state?.valid) return false;
    const cacheWindowMs = Math.max(0, Number(runtimeContext?.wallProbeCacheWindowMs) || 0);
    if (cacheWindowMs <= 0 || nowMs - state.sampledAtMs > cacheWindowMs) {
        return false;
    }

    const positionEps = Math.max(0, Number(runtimeContext?.wallProbeReusePositionEps) || 0);
    const positionEpsSq = positionEps * positionEps;
    if (state.position.distanceToSquared(player.position) > positionEpsSq) {
        return false;
    }

    const directionDotThreshold = clamp(
        Number(runtimeContext?.wallProbeReuseDirectionDot) || 0,
        -1,
        1
    );
    return state.forward.dot(forward) >= directionDotThreshold;
}

function resolveWallProbeSteps(runtimeContext, previousRatio) {
    return resolveAdaptiveWallProbeSteps(
        previousRatio,
        runtimeContext?.wallProbeMinSteps,
        runtimeContext?.wallProbeMaxSteps
    );
}

function sampleWallRatios(player, runtimeContext, radius) {
    const state = getWallProbeState(player);
    const nowMs = resolveNowMs();
    if (canReuseWallProbeState(state, player, TMP_FORWARD, runtimeContext, nowMs)) {
        return state.ratios;
    }

    const ratios = state.ratios;
    const wallProbeDistance = runtimeContext.wallProbeDistance;
    const arena = runtimeContext.arena;
    const previousFront = ratios[WALL_INDEX_FRONT];
    const previousLeft = ratios[WALL_INDEX_LEFT];
    const previousRight = ratios[WALL_INDEX_RIGHT];
    const previousUp = ratios[WALL_INDEX_UP];
    const previousDown = ratios[WALL_INDEX_DOWN];

    ratios[WALL_INDEX_FRONT] = sampleWallDistanceRatio(
        arena,
        player.position,
        TMP_FORWARD,
        radius,
        wallProbeDistance,
        resolveWallProbeSteps(runtimeContext, previousFront)
    );
    ratios[WALL_INDEX_LEFT] = sampleWallDistanceRatio(
        arena,
        player.position,
        TMP_RIGHT,
        radius,
        wallProbeDistance,
        resolveWallProbeSteps(runtimeContext, previousLeft)
    );
    ratios[WALL_INDEX_RIGHT] = sampleWallDistanceRatio(
        arena,
        player.position,
        TMP_LEFT.copy(TMP_RIGHT).multiplyScalar(-1),
        radius,
        wallProbeDistance,
        resolveWallProbeSteps(runtimeContext, previousRight)
    );
    ratios[WALL_INDEX_UP] = sampleWallDistanceRatio(
        arena,
        player.position,
        TMP_UP,
        radius,
        wallProbeDistance,
        resolveWallProbeSteps(runtimeContext, previousUp)
    );
    ratios[WALL_INDEX_DOWN] = sampleWallDistanceRatio(
        arena,
        player.position,
        TMP_DOWN.copy(TMP_UP).multiplyScalar(-1),
        radius,
        wallProbeDistance,
        resolveWallProbeSteps(runtimeContext, previousDown)
    );

    state.position.copy(player.position);
    state.forward.copy(TMP_FORWARD);
    state.sampledAtMs = nowMs;
    state.valid = true;
    return ratios;
}

function findNearestEnemy(player, players) {
    const sample = findNearestEnemySample(player, players, TMP_FORWARD, TMP_TO_TARGET);
    return {
        nearest: sample.nearest,
        distance: Number.isFinite(sample.distanceSq) ? Math.sqrt(sample.distanceSq) : Infinity,
        alignment: sample.alignment,
    };
}

function computeProjectileThreat(player, projectiles, threatRange) {
    return computeProjectileThreatFlag(player, projectiles, threatRange, {
        approachDot: PERCEPTION_THRESHOLDS.projectileApproachDot,
        toTarget: TMP_TO_TARGET,
        direction: TMP_DIRECTION,
    });
}

export function createObservationContext(input = {}, target = null) {
    const context = target && typeof target === 'object' ? target : {};
    const wallProbeMinSteps = Math.max(4, Math.trunc(Number(input.wallProbeMinSteps) || DEFAULT_CONTEXT.wallProbeMinSteps));
    const wallProbeMaxSteps = Math.max(
        wallProbeMinSteps,
        Math.trunc(Number(input.wallProbeMaxSteps) || DEFAULT_CONTEXT.wallProbeMaxSteps)
    );
    context.arena = input.arena || DEFAULT_CONTEXT.arena;
    context.players = Array.isArray(input.players) ? input.players : DEFAULT_CONTEXT.players;
    context.projectiles = Array.isArray(input.projectiles) ? input.projectiles : DEFAULT_CONTEXT.projectiles;
    context.mode = input.mode || DEFAULT_CONTEXT.mode;
    context.planarMode = !!input.planarMode;
    context.wallProbeDistance = Math.max(1, Number(input.wallProbeDistance) || DEFAULT_CONTEXT.wallProbeDistance);
    context.wallProbeMinSteps = wallProbeMinSteps;
    context.wallProbeMaxSteps = wallProbeMaxSteps;
    context.wallProbeCacheWindowMs = Math.max(0, Number(input.wallProbeCacheWindowMs) || DEFAULT_CONTEXT.wallProbeCacheWindowMs);
    context.wallProbeReusePositionEps = Math.max(0, Number(input.wallProbeReusePositionEps) || DEFAULT_CONTEXT.wallProbeReusePositionEps);
    context.wallProbeReuseDirectionDot = clamp(
        Number(input.wallProbeReuseDirectionDot) || DEFAULT_CONTEXT.wallProbeReuseDirectionDot,
        -1,
        1
    );
    context.targetDistanceMax = Math.max(1, Number(input.targetDistanceMax) || DEFAULT_CONTEXT.targetDistanceMax);
    context.projectileThreatRange = Math.max(1, Number(input.projectileThreatRange) || DEFAULT_CONTEXT.projectileThreatRange);
    context[OBSERVATION_CONTEXT_CACHE_FLAG] = true;
    return context;
}

export function buildObservation(player, context = {}, target = null) {
    const observation = getObservationTarget(target);
    if (!player || !player.position || !player.quaternion) {
        return observation;
    }

    const runtimeContext = context?.[OBSERVATION_CONTEXT_CACHE_FLAG]
        ? context
        : createObservationContext(context);
    const playerInventory = Array.isArray(player.inventory) ? player.inventory : [];
    const inventoryLength = playerInventory.length;
    const selectedItemIndex = inventoryLength > 0
        ? clamp(Number(player.selectedItemIndex) || 0, 0, ITEM_SLOT_COUNT - 1)
        : -1;
    const radius = Math.max(0.1, Number(player.hitboxRadius) || 0.8);

    buildBasisFromPlayer(player);
    const wallRatios = sampleWallRatios(player, runtimeContext, radius);
    const wallFront = wallRatios[WALL_INDEX_FRONT];
    const wallLeft = wallRatios[WALL_INDEX_LEFT];
    const wallRight = wallRatios[WALL_INDEX_RIGHT];
    const wallUp = wallRatios[WALL_INDEX_UP];
    const wallDown = wallRatios[WALL_INDEX_DOWN];

    const nearestEnemy = findNearestEnemy(player, runtimeContext.players);
    const projectileThreat = computeProjectileThreat(player, runtimeContext.projectiles, runtimeContext.projectileThreatRange);
    const targetDistanceRatio = normalizeDistanceRatio(
        nearestEnemy.distance,
        runtimeContext.targetDistanceMax,
        1
    );
    const openness = clamp01((wallFront + wallLeft + wallRight + wallUp + wallDown) / 5);
    const pressure = clamp01(
        (1 - wallFront) * 0.42
        + (1 - targetDistanceRatio) * 0.36
        + projectileThreat * 0.55
    );

    observation[SPEED_RATIO] = normalizeSpeedRatio(player.speed, player.baseSpeed);
    observation[HEALTH_RATIO] = normalizeHealthRatio(player.hp, player.maxHp);
    observation[SHIELD_RATIO] = normalizeShieldRatio(player.shieldHP, player.maxShieldHp);
    observation[WALL_DISTANCE_FRONT] = wallFront;
    observation[WALL_DISTANCE_LEFT] = wallLeft;
    observation[WALL_DISTANCE_RIGHT] = wallRight;
    observation[WALL_DISTANCE_UP] = wallUp;
    observation[WALL_DISTANCE_DOWN] = wallDown;
    observation[TARGET_DISTANCE_RATIO] = targetDistanceRatio;
    observation[TARGET_ALIGNMENT] = normalizeSigned(nearestEnemy.alignment, -1, 1, 0);
    observation[TARGET_IN_FRONT] = toBinaryFlag(nearestEnemy.alignment > PERCEPTION_THRESHOLDS.targetInFrontDot);
    observation[PRESSURE_LEVEL] = pressure;
    observation[PROJECTILE_THREAT] = projectileThreat;
    observation[LOCAL_OPENNESS_RATIO] = openness;
    observation[BOOST_ACTIVE] = toBinaryFlag(player.isBoosting);
    observation[INVENTORY_COUNT_RATIO] = normalizeRatio(inventoryLength, ITEM_SLOT_COUNT, 0);
    observation[SELECTED_ITEM_SLOT] = selectedItemIndex;
    observation[PLANAR_MODE_ACTIVE] = toBinaryFlag(runtimeContext.planarMode);
    observation[MODE_ID] = encodeModeId(runtimeContext.mode);
    observation[CONTEXT_RESERVED] = 0;

    encodeItemSlots(playerInventory, observation, ITEM_SLOT_00);
    return observation;
}

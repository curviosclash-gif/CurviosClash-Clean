// ============================================
// RuntimeNearObservationAdapter.js - lifts V1 observations into runtime-near V2 vectors with temporal memory
// ============================================

import {
    HEALTH_RATIO,
    INVENTORY_COUNT_RATIO,
    LOCAL_OPENNESS_RATIO,
    OBSERVATION_LENGTH_V1,
    PRESSURE_LEVEL,
    PROJECTILE_THREAT,
    SHIELD_RATIO,
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
    CLEARANCE_TREND,
    DEAD_END_RISK,
    EXIT_QUALITY,
    GATE_ALIGNMENT,
    GATE_RISK,
    INTENT_CHASE_PRIOR,
    INTENT_COMBAT_PRIOR,
    INTENT_EVADE_PRIOR,
    INTENT_ITEM_PRIOR,
    INTENT_PORTAL_PRIOR,
    ITEM_URGENCY,
    ITEM_VALUE,
    MEMORY_ESCAPE_BIAS,
    MEMORY_PURSUIT_BIAS,
    OBSERVATION_LENGTH_V2,
    OBSERVATION_SCHEMA_VERSION_V2,
    OBSERVATION_V2_BASE_LENGTH,
    OPPONENT_PRESSURE,
    PORTAL_ALIGNMENT,
    PORTAL_RISK,
    PRESSURE_TREND,
    RECOVERY_ACTIVE,
    RECOVERY_AGE_RATIO,
    SHIELD_BREAK_RISK,
    SHIELD_DEFICIT,
    TARGET_STABILITY,
    THREAT_HORIZON,
} from './ObservationSchemaV2.js';

export const RUNTIME_NEAR_OBSERVATION_CONTRACT_VERSION = 'v80-runtime-near-observation-v1';
export const TRAINING_ENVIRONMENT_PROFILES = Object.freeze([
    'runtime-near',
    'synthetic-smoke',
]);
export const DEFAULT_TRAINING_ENVIRONMENT_PROFILE = 'runtime-near';
export const DEFAULT_RUNTIME_NEAR_OBSERVATION_LENGTH = OBSERVATION_LENGTH_V2;

function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function clamp01(value, fallback = 0) {
    return clamp(toFiniteNumber(value, fallback), 0, 1);
}

function clampSigned(value, fallback = 0) {
    return clamp(toFiniteNumber(value, fallback), -1, 1);
}

function normalizeSignedToUnit(value, fallback = 0.5) {
    return clamp01((clampSigned(value, (fallback * 2) - 1) + 1) * 0.5, fallback);
}

function createBaseObservationVector(observation) {
    const vector = new Array(OBSERVATION_LENGTH_V1).fill(0);
    const source = Array.isArray(observation) ? observation : [];
    const limit = Math.min(OBSERVATION_LENGTH_V1, source.length);
    for (let index = 0; index < limit; index += 1) {
        vector[index] = toFiniteNumber(source[index], 0);
    }
    return vector;
}

function createLiftedVector(baseVector, expectedLength = OBSERVATION_LENGTH_V2) {
    const safeLength = Math.max(OBSERVATION_LENGTH_V1, Math.trunc(Number(expectedLength) || OBSERVATION_LENGTH_V2));
    const vector = new Array(safeLength).fill(0);
    const limit = Math.min(baseVector.length, safeLength);
    for (let index = 0; index < limit; index += 1) {
        vector[index] = toFiniteNumber(baseVector[index], 0);
    }
    return vector;
}

function normalizeMetadata(metadata = {}) {
    return /** @type {Record<string, any>} */ (metadata && typeof metadata === 'object' ? metadata : {});
}

function normalizeSection(metadata, key) {
    const section = metadata?.[key];
    return /** @type {Record<string, any>} */ (section && typeof section === 'object' ? section : {});
}

function normalizeIntent(intent, fallback = 'stabilize') {
    const normalized = typeof intent === 'string' ? intent.trim().toLowerCase() : '';
    if (normalized === 'recover') return 'recover';
    if (normalized === 'evade') return 'evade';
    if (normalized === 'portal' || normalized === 'take-portal') return 'portal';
    if (normalized === 'item-use' || normalized === 'use-item') return 'item-use';
    if (normalized === 'combat' || normalized === 'engage') return 'combat';
    if (normalized === 'chase' || normalized === 'reposition') return 'chase';
    return fallback;
}

export function normalizeTrainingEnvironmentProfile(value, fallback = DEFAULT_TRAINING_ENVIRONMENT_PROFILE) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (TRAINING_ENVIRONMENT_PROFILES.includes(normalized)) {
        return normalized;
    }
    return fallback;
}

function createTrackerState() {
    return {
        stepIndex: 0,
        pressureEma: 0,
        opennessEma: 1,
        frontClearanceEma: 1,
        lastTargetAlignment: 0,
        lastIntent: 'stabilize',
        lastRecoveryStep: null,
        escapeBias: 0.45,
        pursuitBias: 0.35,
        lastEnvironmentProfile: DEFAULT_TRAINING_ENVIRONMENT_PROFILE,
    };
}

function cloneTrackerState(state = createTrackerState()) {
    return {
        stepIndex: Number.isInteger(state.stepIndex) ? state.stepIndex : 0,
        pressureEma: clamp01(state.pressureEma, 0),
        opennessEma: clamp01(state.opennessEma, 1),
        frontClearanceEma: clamp01(state.frontClearanceEma, 1),
        lastTargetAlignment: clampSigned(state.lastTargetAlignment, 0),
        lastIntent: normalizeIntent(state.lastIntent, 'stabilize'),
        lastRecoveryStep: Number.isInteger(state.lastRecoveryStep) ? state.lastRecoveryStep : null,
        escapeBias: clamp01(state.escapeBias, 0.45),
        pursuitBias: clamp01(state.pursuitBias, 0.35),
        lastEnvironmentProfile: normalizeTrainingEnvironmentProfile(
            state.lastEnvironmentProfile,
            DEFAULT_TRAINING_ENVIRONMENT_PROFILE
        ),
    };
}

function resolveStepIndex(options, state) {
    if (Number.isInteger(options?.stepIndex)) return Math.max(0, options.stepIndex);
    return Math.max(0, state.stepIndex);
}

function resolveHealthRatio(baseVector, player = null) {
    const hp = Number(player?.hp);
    const maxHp = Number(player?.maxHp);
    if (Number.isFinite(hp) && Number.isFinite(maxHp) && maxHp > 0) {
        return clamp01(hp / maxHp, 1);
    }
    return clamp01(baseVector[HEALTH_RATIO], 1);
}

function resolveShieldRatio(baseVector, player = null) {
    const shieldHp = Number(player?.shieldHp ?? player?.shieldHP);
    const maxShieldHp = Number(player?.maxShieldHp);
    if (Number.isFinite(shieldHp) && Number.isFinite(maxShieldHp) && maxShieldHp > 0) {
        return clamp01(shieldHp / maxShieldHp, 0);
    }
    return clamp01(baseVector[SHIELD_RATIO], 0);
}

function resolvePortalContext(baseVector, metadata = {}) {
    const portal = normalizeSection(metadata, 'portal');
    const active = portal.active === true;
    return {
        active,
        alignment: active
            ? normalizeSignedToUnit(
                portal.alignment,
                clamp01(baseVector[TARGET_IN_FRONT], 0) >= 0.5 ? 0.65 : 0.35
            )
            : 0,
        risk: active
            ? clamp01(
                portal.risk,
                Math.max(
                    0,
                    (1 - clamp01(baseVector[WALL_DISTANCE_FRONT], 1)) * 0.55
                    + clamp01(baseVector[PRESSURE_LEVEL], 0) * 0.45
                )
            )
            : 0,
    };
}

function resolveGateContext(baseVector, metadata = {}) {
    const gate = normalizeSection(metadata, 'gate');
    const active = gate.active === true;
    return {
        active,
        alignment: active
            ? normalizeSignedToUnit(gate.alignment, clamp01(baseVector[LOCAL_OPENNESS_RATIO], 0.5))
            : 0,
        risk: active
            ? clamp01(
                gate.risk,
                Math.max(
                    0,
                    (1 - clamp01(baseVector[LOCAL_OPENNESS_RATIO], 1)) * 0.5
                    + clamp01(baseVector[PRESSURE_LEVEL], 0) * 0.35
                    + (1 - clamp01(baseVector[WALL_DISTANCE_FRONT], 1)) * 0.15
                )
            )
            : 0,
    };
}

function resolveItemContext(baseVector, metadata = {}, healthRatio = 1, shieldRatio = 0) {
    const item = normalizeSection(metadata, 'item');
    const inventoryRatio = clamp01(baseVector[INVENTORY_COUNT_RATIO], 0);
    const value = clamp01(
        item.value,
        clamp01(inventoryRatio * 0.72 + (1 - healthRatio) * 0.18 + (1 - shieldRatio) * 0.1)
    );
    const urgency = clamp01(
        item.urgency,
        clamp01(value * (0.45 + (1 - healthRatio) * 0.35 + (1 - shieldRatio) * 0.2))
    );
    return {
        value,
        urgency,
    };
}

function resolveRecoveryContext(metadata = {}, currentIntent = 'stabilize') {
    const recovery = normalizeSection(metadata, 'recovery');
    return {
        active: recovery.active === true || currentIntent === 'recover' || currentIntent === 'evade',
        severity: clamp01(recovery.severity, currentIntent === 'recover' ? 0.8 : (currentIntent === 'evade' ? 0.6 : 0)),
    };
}

function resolveOpponentPressure(baseVector, threatHorizon) {
    const targetInFront = clamp01(baseVector[TARGET_IN_FRONT], 0) >= 0.5;
    const targetDistanceRatio = clamp01(baseVector[TARGET_DISTANCE_RATIO], 1);
    const targetAlignment = clampSigned(baseVector[TARGET_ALIGNMENT], 0);
    const pressureLevel = clamp01(baseVector[PRESSURE_LEVEL], 0);
    const attackWindow = targetInFront
        ? clamp01((1 - targetDistanceRatio) * 0.72 + Math.max(0, targetAlignment) * 0.28)
        : 0;
    return clamp01(Math.max(attackWindow, pressureLevel * 0.25, threatHorizon * 0.2));
}

function resolveIntentPriors(input = {}) {
    const threatHorizon = clamp01(input.threatHorizon, 0);
    const deadEndRisk = clamp01(input.deadEndRisk, 0);
    const exitQuality = clamp01(input.exitQuality, 0);
    const opponentPressure = clamp01(input.opponentPressure, 0);
    const itemUrgency = clamp01(input.itemUrgency, 0);
    const portal = input.portal && typeof input.portal === 'object' ? input.portal : {};
    const state = input.state && typeof input.state === 'object' ? input.state : {};
    return {
        evade: clamp01(Math.max(threatHorizon, deadEndRisk, state.escapeBias || 0)),
        chase: clamp01(Math.max(opponentPressure * 0.82, (state.pursuitBias || 0) * 0.9, exitQuality * 0.2)),
        portal: portal.active
            ? clamp01(portal.alignment * (1 - portal.risk) * 0.92 + exitQuality * 0.08)
            : 0,
        item: clamp01(itemUrgency),
        combat: clamp01(Math.max(0, opponentPressure * 0.78 + (1 - threatHorizon) * 0.22)),
    };
}

function writeObservationV2Metrics(vector, metrics) {
    if (vector.length <= OBSERVATION_V2_BASE_LENGTH) {
        return vector;
    }
    vector[THREAT_HORIZON] = metrics.threatHorizon;
    vector[DEAD_END_RISK] = metrics.deadEndRisk;
    vector[EXIT_QUALITY] = metrics.exitQuality;
    vector[OPPONENT_PRESSURE] = metrics.opponentPressure;
    vector[RECOVERY_ACTIVE] = metrics.recovery.active ? 1 : 0;
    vector[RECOVERY_AGE_RATIO] = metrics.recoveryAgeRatio;
    vector[PORTAL_ALIGNMENT] = metrics.portal.alignment;
    vector[PORTAL_RISK] = metrics.portal.risk;
    vector[GATE_ALIGNMENT] = metrics.gate.alignment;
    vector[GATE_RISK] = metrics.gate.risk;
    vector[ITEM_VALUE] = metrics.item.value;
    vector[ITEM_URGENCY] = metrics.item.urgency;
    vector[SHIELD_DEFICIT] = metrics.shieldDeficit;
    vector[SHIELD_BREAK_RISK] = metrics.shieldBreakRisk;
    vector[PRESSURE_TREND] = metrics.pressureTrend;
    vector[CLEARANCE_TREND] = metrics.clearanceTrend;
    vector[TARGET_STABILITY] = metrics.targetStability;
    vector[MEMORY_ESCAPE_BIAS] = metrics.memory.escapeBias;
    vector[MEMORY_PURSUIT_BIAS] = metrics.memory.pursuitBias;
    vector[INTENT_EVADE_PRIOR] = metrics.intentPriors.evade;
    vector[INTENT_CHASE_PRIOR] = metrics.intentPriors.chase;
    vector[INTENT_PORTAL_PRIOR] = metrics.intentPriors.portal;
    vector[INTENT_ITEM_PRIOR] = metrics.intentPriors.item;
    vector[INTENT_COMBAT_PRIOR] = metrics.intentPriors.combat;
    return vector;
}

function updateTrackerState(state, metrics, environmentProfile, stepIndex, appliedIntent) {
    state.stepIndex = stepIndex + 1;
    state.pressureEma = clamp01(state.pressureEma * 0.72 + metrics.base.pressure * 0.28, metrics.base.pressure);
    state.opennessEma = clamp01(state.opennessEma * 0.72 + metrics.base.openness * 0.28, metrics.base.openness);
    state.frontClearanceEma = clamp01(
        state.frontClearanceEma * 0.68 + metrics.base.wallFront * 0.32,
        metrics.base.wallFront
    );
    state.lastTargetAlignment = clampSigned(metrics.base.targetAlignment, 0);
    state.lastEnvironmentProfile = environmentProfile;
    state.escapeBias = clamp01(
        state.escapeBias * 0.76 + Math.max(metrics.threatHorizon, metrics.deadEndRisk) * 0.24,
        metrics.threatHorizon
    );
    state.pursuitBias = clamp01(
        state.pursuitBias * 0.74
        + Math.max(metrics.opponentPressure * 0.78, metrics.exitQuality * 0.22) * 0.26,
        metrics.opponentPressure
    );
    if (metrics.recovery.active || appliedIntent === 'recover' || appliedIntent === 'evade') {
        state.lastRecoveryStep = stepIndex;
    }
    state.lastIntent = appliedIntent;
}

function buildDetails(vector, baseVector, metrics, environmentProfile, stepIndex, state) {
    return {
        contractVersion: RUNTIME_NEAR_OBSERVATION_CONTRACT_VERSION,
        schemaVersion: vector.length > OBSERVATION_V2_BASE_LENGTH
            ? OBSERVATION_SCHEMA_VERSION_V2
            : 'v1',
        baseSchemaVersion: 'v1',
        environmentProfile,
        runtimeNear: environmentProfile === 'runtime-near',
        observationLength: vector.length,
        baseObservationLength: baseVector.length,
        stepIndex,
        threatHorizon: metrics.threatHorizon,
        deadEndRisk: metrics.deadEndRisk,
        exitQuality: metrics.exitQuality,
        opponentPressure: metrics.opponentPressure,
        portal: metrics.portal,
        gate: metrics.gate,
        item: metrics.item,
        recovery: metrics.recovery,
        recoveryAgeRatio: metrics.recoveryAgeRatio,
        shieldDeficit: metrics.shieldDeficit,
        shieldBreakRisk: metrics.shieldBreakRisk,
        pressureTrend: metrics.pressureTrend,
        clearanceTrend: metrics.clearanceTrend,
        targetStability: metrics.targetStability,
        memory: {
            escapeBias: metrics.memory.escapeBias,
            pursuitBias: metrics.memory.pursuitBias,
            lastIntent: state.lastIntent,
            lastRecoveryStep: state.lastRecoveryStep,
        },
        intentPriors: metrics.intentPriors,
    };
}

export function liftObservationWithRuntimeNearContext(observation, options = {}) {
    const expectedLength = Math.max(
        OBSERVATION_LENGTH_V1,
        Math.trunc(Number(options.expectedLength) || DEFAULT_RUNTIME_NEAR_OBSERVATION_LENGTH)
    );
    const environmentProfile = normalizeTrainingEnvironmentProfile(
        options.environmentProfile,
        expectedLength > OBSERVATION_V2_BASE_LENGTH
            ? DEFAULT_TRAINING_ENVIRONMENT_PROFILE
            : 'synthetic-smoke'
    );
    const trackerState = options.trackerState && typeof options.trackerState === 'object'
        ? options.trackerState
        : createTrackerState();
    const state = cloneTrackerState(trackerState);
    const metadata = normalizeMetadata(options.metadata);
    const baseVector = createBaseObservationVector(observation);
    const vector = createLiftedVector(baseVector, expectedLength);
    const stepIndex = resolveStepIndex(options, state);
    const player = options?.player && typeof options.player === 'object'
        ? options.player
        : null;
    const healthRatio = resolveHealthRatio(baseVector, player);
    const shieldRatio = resolveShieldRatio(baseVector, player);
    const wallFront = clamp01(baseVector[WALL_DISTANCE_FRONT], 1);
    const wallLeft = clamp01(baseVector[WALL_DISTANCE_LEFT], 1);
    const wallRight = clamp01(baseVector[WALL_DISTANCE_RIGHT], 1);
    const wallUp = clamp01(baseVector[WALL_DISTANCE_UP], 1);
    const wallDown = clamp01(baseVector[WALL_DISTANCE_DOWN], 1);
    const pressure = clamp01(baseVector[PRESSURE_LEVEL], 0);
    const openness = clamp01(baseVector[LOCAL_OPENNESS_RATIO], 1);
    const projectileThreat = clamp01(baseVector[PROJECTILE_THREAT], 0) >= 0.5;
    const targetDistanceRatio = clamp01(baseVector[TARGET_DISTANCE_RATIO], 1);
    const targetAlignment = clampSigned(baseVector[TARGET_ALIGNMENT], 0);
    const targetInFront = clamp01(baseVector[TARGET_IN_FRONT], 0) >= 0.5;
    const deadEndRisk = clamp01(
        Math.max(
            1 - openness,
            Math.max(0, 0.3 - Math.max(wallLeft, wallRight)) * 1.8,
            wallFront <= 0.18 ? 1 : 0
        )
    );
    const exitQuality = clamp01(
        (Math.max(wallFront, Math.max(wallLeft, wallRight)) * 0.52)
        + openness * 0.33
        + Math.max(wallUp, wallDown) * 0.15
    );
    const opponentPressure = resolveOpponentPressure(baseVector, pressure);
    const shieldDeficit = clamp01(1 - shieldRatio, 0);
    const shieldBreakRisk = clamp01(Math.max(pressure * 0.55 + shieldDeficit * 0.45, projectileThreat ? 0.88 : 0));
    const threatHorizon = clamp01(
        Math.max(
            pressure,
            projectileThreat ? 0.96 : 0,
            1 - wallFront,
            deadEndRisk * 0.92,
            shieldDeficit * 0.18 + opponentPressure * 0.64
        )
    );
    const intentHint = normalizeIntent(options.intent || metadata.intent || state.lastIntent, state.lastIntent);
    const portal = resolvePortalContext(baseVector, metadata);
    const gate = resolveGateContext(baseVector, metadata);
    const item = resolveItemContext(baseVector, metadata, healthRatio, shieldRatio);
    const recovery = resolveRecoveryContext(metadata, intentHint);
    const recoveryAgeRatio = state.lastRecoveryStep == null
        ? 0
        : clamp01(1 - (Math.min(18, Math.max(0, stepIndex - state.lastRecoveryStep)) / 18));
    const pressureTrend = clampSigned(pressure - state.pressureEma, 0);
    const clearanceTrend = clampSigned(wallFront - state.frontClearanceEma, 0);
    const targetStability = targetInFront
        ? clamp01(1 - Math.abs(targetAlignment - state.lastTargetAlignment))
        : 0;
    const memory = {
        escapeBias: clamp01(state.escapeBias * 0.76 + Math.max(threatHorizon, deadEndRisk) * 0.24),
        pursuitBias: clamp01(
            state.pursuitBias * 0.74
            + Math.max(Math.max(0, targetAlignment) * 0.6, (1 - targetDistanceRatio) * 0.25, exitQuality * 0.15) * 0.26
        ),
    };
    const intentPriors = resolveIntentPriors({
        threatHorizon,
        deadEndRisk,
        exitQuality,
        opponentPressure: clamp01(Math.max(opponentPressure, Math.max(0, targetAlignment) * (1 - targetDistanceRatio))),
        itemUrgency: item.urgency,
        portal,
        state: {
            escapeBias: memory.escapeBias,
            pursuitBias: memory.pursuitBias,
        },
    });
    const metrics = {
        base: {
            healthRatio,
            shieldRatio,
            wallFront,
            wallLeft,
            wallRight,
            wallUp,
            wallDown,
            pressure,
            openness,
            projectileThreat,
            targetDistanceRatio,
            targetAlignment,
            targetInFront,
        },
        threatHorizon,
        deadEndRisk,
        exitQuality,
        opponentPressure,
        portal,
        gate,
        item,
        recovery,
        recoveryAgeRatio,
        shieldDeficit,
        shieldBreakRisk,
        pressureTrend,
        clearanceTrend,
        targetStability,
        memory,
        intentPriors,
    };
    writeObservationV2Metrics(vector, metrics);
    updateTrackerState(state, metrics, environmentProfile, stepIndex, intentHint);
    return {
        observation: vector,
        details: buildDetails(vector, baseVector, metrics, environmentProfile, stepIndex, state),
        trackerState: state,
    };
}

export class RuntimeNearObservationTracker {
    constructor(options = {}) {
        this.reset(options);
    }

    reset(_options = null) {
        this._state = createTrackerState();
        return this.getSnapshot();
    }

    getSnapshot() {
        return cloneTrackerState(this._state);
    }

    lift(observation, options = {}) {
        const result = liftObservationWithRuntimeNearContext(observation, {
            ...options,
            trackerState: this._state,
        });
        this._state = cloneTrackerState(result.trackerState);
        return result;
    }
}

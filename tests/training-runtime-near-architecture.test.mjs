import assert from 'node:assert/strict';
import test from 'node:test';

import {
    HEALTH_RATIO,
    LOCAL_OPENNESS_RATIO,
    OBSERVATION_LENGTH_V1,
    PRESSURE_LEVEL,
    PROJECTILE_THREAT,
    SHIELD_RATIO,
    TARGET_ALIGNMENT,
    TARGET_DISTANCE_RATIO,
    TARGET_IN_FRONT,
    WALL_DISTANCE_FRONT,
    WALL_DISTANCE_LEFT,
    WALL_DISTANCE_RIGHT,
} from '../src/entities/ai/observation/ObservationSchemaV1.js';
import {
    INTENT_EVADE_PRIOR,
    MEMORY_ESCAPE_BIAS,
    OBSERVATION_LENGTH_V2,
    OBSERVATION_SCHEMA_VERSION_V2,
    PORTAL_ALIGNMENT,
    PRESSURE_TREND,
    RECOVERY_ACTIVE,
    THREAT_HORIZON,
} from '../src/entities/ai/observation/ObservationSchemaV2.js';
import { RuntimeNearObservationTracker } from '../src/entities/ai/observation/RuntimeNearObservationAdapter.js';
import {
    HYBRID_INTENT_TYPES,
    resolveHybridDecision,
} from '../src/entities/ai/hybrid/HybridDecisionArchitecture.js';

function createObservationV1(overrides = {}) {
    const observation = new Array(OBSERVATION_LENGTH_V1).fill(0);
    observation[HEALTH_RATIO] = 0.7;
    observation[SHIELD_RATIO] = 0.45;
    observation[WALL_DISTANCE_FRONT] = 0.56;
    observation[WALL_DISTANCE_LEFT] = 0.64;
    observation[WALL_DISTANCE_RIGHT] = 0.51;
    observation[TARGET_DISTANCE_RATIO] = 0.38;
    observation[TARGET_ALIGNMENT] = 0.42;
    observation[TARGET_IN_FRONT] = 1;
    observation[PRESSURE_LEVEL] = 0.36;
    observation[PROJECTILE_THREAT] = 0;
    observation[LOCAL_OPENNESS_RATIO] = 0.62;
    for (const [index, value] of Object.entries(overrides)) {
        observation[Number(index)] = value;
    }
    return observation;
}

test('V80 runtime-near observation tracker lifts V1 observations into temporal V2 context', () => {
    const tracker = new RuntimeNearObservationTracker();

    const first = tracker.lift(createObservationV1({
        [HEALTH_RATIO]: 0.42,
        [SHIELD_RATIO]: 0.15,
        [WALL_DISTANCE_FRONT]: 0.34,
        [PRESSURE_LEVEL]: 0.58,
        [LOCAL_OPENNESS_RATIO]: 0.44,
    }), {
        stepIndex: 0,
        environmentProfile: 'runtime-near',
        metadata: {
            portal: { active: true, alignment: 0.78, risk: 0.24 },
            recovery: { active: true, severity: 0.86 },
            intent: 'portal',
        },
        player: {
            hp: 42,
            maxHp: 100,
            shieldHp: 15,
            maxShieldHp: 100,
        },
    });

    const second = tracker.lift(createObservationV1({
        [HEALTH_RATIO]: 0.28,
        [SHIELD_RATIO]: 0.08,
        [WALL_DISTANCE_FRONT]: 0.14,
        [WALL_DISTANCE_LEFT]: 0.78,
        [WALL_DISTANCE_RIGHT]: 0.12,
        [PRESSURE_LEVEL]: 0.92,
        [PROJECTILE_THREAT]: 1,
        [LOCAL_OPENNESS_RATIO]: 0.18,
        [TARGET_ALIGNMENT]: -0.22,
    }), {
        stepIndex: 1,
        environmentProfile: 'runtime-near',
        metadata: {
            item: { value: 0.76, urgency: 0.92 },
            gate: { active: true, alignment: 0.35, risk: 0.66 },
            intent: 'evade',
        },
        player: {
            hp: 28,
            maxHp: 100,
            shieldHp: 8,
            maxShieldHp: 100,
        },
    });

    assert.equal(first.observation.length, OBSERVATION_LENGTH_V2);
    assert.equal(first.details.schemaVersion, OBSERVATION_SCHEMA_VERSION_V2);
    assert.equal(first.details.runtimeNear, true);
    assert.equal(first.observation[RECOVERY_ACTIVE], 1);
    assert.equal(first.observation[PORTAL_ALIGNMENT] > 0, true);
    assert.equal(first.observation[THREAT_HORIZON] > 0.4, true);

    assert.equal(second.observation.length, OBSERVATION_LENGTH_V2);
    assert.equal(second.details.recoveryAgeRatio > 0, true);
    assert.equal(second.details.memory.lastRecoveryStep, 1);
    assert.equal(second.observation[PRESSURE_TREND] > 0, true);
    assert.equal(second.observation[MEMORY_ESCAPE_BIAS] >= first.observation[MEMORY_ESCAPE_BIAS], true);
    assert.equal(second.observation[INTENT_EVADE_PRIOR] > 0.8, true);
});

test('V80 hybrid decision architecture hard-vetoes risky portal and item actions', () => {
    const observation = new Array(OBSERVATION_LENGTH_V2).fill(0);
    observation[HEALTH_RATIO] = 0.22;
    observation[SHIELD_RATIO] = 0.06;
    observation[WALL_DISTANCE_FRONT] = 0.1;
    observation[WALL_DISTANCE_LEFT] = 0.82;
    observation[WALL_DISTANCE_RIGHT] = 0.12;
    observation[LOCAL_OPENNESS_RATIO] = 0.16;
    observation[PRESSURE_LEVEL] = 0.94;
    observation[PROJECTILE_THREAT] = 1;
    observation[TARGET_DISTANCE_RATIO] = 0.3;
    observation[TARGET_ALIGNMENT] = 0.18;
    observation[TARGET_IN_FRONT] = 1;
    observation[THREAT_HORIZON] = 0.97;
    observation[PORTAL_ALIGNMENT] = 0.74;
    observation[RECOVERY_ACTIVE] = 1;

    const result = resolveHybridDecision({
        yawRight: true,
        boost: true,
        shootMG: true,
        shootItem: true,
        shootItemIndex: 0,
        useItem: 0,
    }, {
        observation,
        planarMode: false,
        intent: HYBRID_INTENT_TYPES.PORTAL,
        observationDetails: {
            portal: { active: true, risk: 0.88 },
            item: { urgency: 0.9 },
        },
        player: {
            hp: 22,
            maxHp: 100,
            shieldHp: 6,
            maxShieldHp: 100,
        },
    });

    assert.equal(result.safety.vetoActive, true);
    assert.equal(result.intent.requested, HYBRID_INTENT_TYPES.PORTAL);
    assert.equal(result.intent.applied, HYBRID_INTENT_TYPES.RECOVER);
    assert.equal(result.action.yawLeft, true);
    assert.equal(result.action.yawRight, false);
    assert.equal(result.action.boost, false);
    assert.equal(result.action.shootMG, false);
    assert.equal(result.action.shootItem, false);
    assert.equal(result.action.shootItemIndex, -1);
    assert.equal(result.action.useItem, -1);
});

// ============================================
// ObservationSchemaV2.js - runtime-near observation indices for bridge/runtime V2
// ============================================

import { OBSERVATION_LENGTH_V1 } from './ObservationSchemaV1.js';

export const OBSERVATION_SCHEMA_VERSION_V2 = 'v2-runtime-near';
export const OBSERVATION_LENGTH_V2 = 64;
export const OBSERVATION_V2_BASE_LENGTH = OBSERVATION_LENGTH_V1;

export const THREAT_HORIZON = 40;
export const DEAD_END_RISK = 41;
export const EXIT_QUALITY = 42;
export const OPPONENT_PRESSURE = 43;
export const RECOVERY_ACTIVE = 44;
export const RECOVERY_AGE_RATIO = 45;
export const PORTAL_ALIGNMENT = 46;
export const PORTAL_RISK = 47;
export const GATE_ALIGNMENT = 48;
export const GATE_RISK = 49;
export const ITEM_VALUE = 50;
export const ITEM_URGENCY = 51;
export const SHIELD_DEFICIT = 52;
export const SHIELD_BREAK_RISK = 53;
export const PRESSURE_TREND = 54;
export const CLEARANCE_TREND = 55;
export const TARGET_STABILITY = 56;
export const MEMORY_ESCAPE_BIAS = 57;
export const MEMORY_PURSUIT_BIAS = 58;
export const INTENT_EVADE_PRIOR = 59;
export const INTENT_CHASE_PRIOR = 60;
export const INTENT_PORTAL_PRIOR = 61;
export const INTENT_ITEM_PRIOR = 62;
export const INTENT_COMBAT_PRIOR = 63;

export const OBSERVATION_V2_INDEX = Object.freeze({
    THREAT_HORIZON,
    DEAD_END_RISK,
    EXIT_QUALITY,
    OPPONENT_PRESSURE,
    RECOVERY_ACTIVE,
    RECOVERY_AGE_RATIO,
    PORTAL_ALIGNMENT,
    PORTAL_RISK,
    GATE_ALIGNMENT,
    GATE_RISK,
    ITEM_VALUE,
    ITEM_URGENCY,
    SHIELD_DEFICIT,
    SHIELD_BREAK_RISK,
    PRESSURE_TREND,
    CLEARANCE_TREND,
    TARGET_STABILITY,
    MEMORY_ESCAPE_BIAS,
    MEMORY_PURSUIT_BIAS,
    INTENT_EVADE_PRIOR,
    INTENT_CHASE_PRIOR,
    INTENT_PORTAL_PRIOR,
    INTENT_ITEM_PRIOR,
    INTENT_COMBAT_PRIOR,
});

export function getObservationV2IndexValues() {
    return Object.values(OBSERVATION_V2_INDEX);
}

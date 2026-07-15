import {
    LOCAL_OPENNESS_RATIO,
    PLANAR_MODE_ACTIVE,
    PRESSURE_LEVEL,
    WALL_DISTANCE_DOWN,
    WALL_DISTANCE_FRONT,
    WALL_DISTANCE_LEFT,
    WALL_DISTANCE_RIGHT,
    WALL_DISTANCE_UP,
} from './observation/ObservationSchemaV1.js';
import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import { clamp } from '../../utils/MathOps.js';
import { readObservationValue } from './HeuristicBotPolicyOps.js';

export function resolveBoostPressureCeiling(baseCeiling, profile) {
    const bias = Number(profile?.boostBias);
    const safeBias = Number.isFinite(bias) && bias > 0 ? bias : 1;
    return clamp(Number(baseCeiling) * safeBias, 0, 1);
}

export function applyHeuristicObstacleAvoidance(policy, input, player, observation) {
    const wallFront = clamp(readObservationValue(observation, WALL_DISTANCE_FRONT, 1), 0, 1);
    const wallLeft = clamp(readObservationValue(observation, WALL_DISTANCE_LEFT, 1), 0, 1);
    const wallRight = clamp(readObservationValue(observation, WALL_DISTANCE_RIGHT, 1), 0, 1);
    const wallUp = clamp(readObservationValue(observation, WALL_DISTANCE_UP, 1), 0, 1);
    const wallDown = clamp(readObservationValue(observation, WALL_DISTANCE_DOWN, 1), 0, 1);
    const pressureLevel = clamp(readObservationValue(observation, PRESSURE_LEVEL, 0), 0, 1);
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

    const boostPressureCeiling = resolveBoostPressureCeiling(0.64, policy.profile);
    input.boost = openness > 0.58
        && pressureLevel < boostPressureCeiling
        && wallFront > policy.profile.safetyDistance;
}

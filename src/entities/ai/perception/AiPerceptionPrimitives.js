import { clamp01 } from '../../../utils/MathOps.js';
import {
    AI_SENSOR_NORMALIZATION,
    AI_SENSOR_PRESSURE_WEIGHTS,
} from './AiPerceptionConfig.js';

export { clamp01 };

export function normalizeSigned(value) {
    return clamp01((Number(value) + AI_SENSOR_NORMALIZATION.signedOffset) * AI_SENSOR_NORMALIZATION.signedScale);
}

export function normalizeDistance(distance, maxDistance) {
    const safeMaxDistance = Math.max(1, Number(maxDistance) || 1);
    return clamp01((Number(distance) || 0) / safeMaxDistance);
}

export function normalizeRisk(risk) {
    return normalizeDistance(risk, AI_SENSOR_NORMALIZATION.riskMax);
}

export function normalizePressure(pressure) {
    return normalizeDistance(pressure, AI_SENSOR_NORMALIZATION.pressureMax);
}

export function normalizeTargetDistance(distanceSq, lookAhead) {
    if (!Number.isFinite(distanceSq)) return 1;
    const safeLookAhead = Math.max(1, Number(lookAhead) || 1);
    const denominator = Math.max(1, safeLookAhead * AI_SENSOR_NORMALIZATION.targetDistanceLookAheadMultiplier);
    return clamp01(Math.sqrt(Math.max(0, distanceSq)) / denominator);
}

export function computeTightSpacePressure(localOpenness, lookAhead) {
    const safeLookAhead = Math.max(1, Number(lookAhead) || 1);
    return 1 - clamp01((Number(localOpenness) || 0) / safeLookAhead);
}

export function composePressureLevel(nearestEnemyPressure, tightSpacePressure, bouncePressure = 0) {
    return Math.min(
        AI_SENSOR_NORMALIZATION.pressureMax,
        (Number(nearestEnemyPressure) || 0) * AI_SENSOR_PRESSURE_WEIGHTS.enemy
        + (Number(tightSpacePressure) || 0) * AI_SENSOR_PRESSURE_WEIGHTS.tightSpace
        + (Number(bouncePressure) || 0) * AI_SENSOR_PRESSURE_WEIGHTS.bounce
    );
}

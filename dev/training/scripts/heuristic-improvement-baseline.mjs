// Fixed pre-optimization profiles: benchmark opponents must not move when product defaults change.
const NEUTRAL_TACTICS = Object.freeze({
    escapeLateralBias: 0.5,
    attackCutoffBias: 0.5,
    finisherBias: 0.5,
    openingFanoutBias: 0.5,
    opportunistBias: 0.5,
    openingHookBias: 0.5,
    trafficAvoidanceBias: 0.5,
    predictiveSafetyBias: 0.5,
});

export const HEURISTIC_IMPROVEMENT_BASELINE = Object.freeze({
    defensive: Object.freeze({
        retreatVitality: 0.54, retreatPressure: 0.56, boostBias: 0.72,
        defensiveItemThresholdScale: 0.78, offensiveItemThresholdScale: 1.18,
        attackWindow: 0.58, safetyDistance: 0.44, preferredRange: 0.46,
        strafeDistance: 0.60, ...NEUTRAL_TACTICS,
    }),
    balanced: Object.freeze({
        retreatVitality: 0.38, retreatPressure: 0.74, boostBias: 1,
        defensiveItemThresholdScale: 1, offensiveItemThresholdScale: 1,
        attackWindow: 0.72, safetyDistance: 0.30, preferredRange: 0.34,
        strafeDistance: 0.50, ...NEUTRAL_TACTICS,
    }),
    aggressive: Object.freeze({
        retreatVitality: 0.20, retreatPressure: 0.90, boostBias: 1.32,
        defensiveItemThresholdScale: 1.14, offensiveItemThresholdScale: 0.82,
        attackWindow: 0.86, safetyDistance: 0.18, preferredRange: 0.20,
        strafeDistance: 0.38, ...NEUTRAL_TACTICS,
    }),
});

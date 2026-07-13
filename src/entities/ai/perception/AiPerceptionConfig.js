export const AI_SENSE_PHASE_WINDOW = 4;

export const AI_SENSOR_NORMALIZATION = Object.freeze({
    signedOffset: 1,
    signedScale: 0.5,
    riskMax: 3,
    pressureMax: 1.6,
    targetDistanceLookAheadMultiplier: 8,
});

export const AI_SENSOR_LOOKAHEAD = Object.freeze({
    minimumDistance: 8,
    defaultBaseDistance: 12,
    speedRatioWeight: 0.75,
    boostMultiplier: 1.2,
});

export const AI_SENSOR_SCAN_POLICY = Object.freeze({
    reducedProbeRiskThreshold: 0.25,
    reducedProbeOpennessRatio: 0.7,
    reducedProbeCount: 5,
    planarPitchEpsilon: 0.001,
    fallbackLocalOpennessRatio: 0.4,
    projectileSenseStride: 2,
    projectileSenseRiskThreshold: 0.42,
    spacingSenseStride: 3,
    spacingSenseRiskThreshold: 0.65,
    spacingDecay: 0.82,
    spacingDeadzone: 0.05,
});

export const AI_SENSOR_PROBE_POLICY = Object.freeze({
    lateralScanClearRatio: 0.92,
    immediateDangerStepMultiplier: 1.5,
    sharpTurnYawThreshold: 2.5,
    sharpTurnLookAheadScale: 0.4,
    mediumTurnYawThreshold: 1.2,
    mediumTurnLookAheadScale: 0.7,
    planarLateralStrength: 0.2,
    volumeLateralStrength: 0.24,
    lateralLookAheadScale: 0.9,
    speedFactorScale: 0.3,
    wallRiskBase: 1.1,
    trailRiskBase: 1.45,
    trailMapCautionScale: 0.5,
    trailSpeedFactorScale: 0.7,
    lateralBlockDistanceScale: 0.5,
    lateralBlockRiskPenalty: 0.28,
    immediateDangerRiskPenalty: 2.2,
    errorNoiseOffset: 0.2,
    errorNoiseScale: 0.65,
});

export const AI_SENSOR_THREAT_POLICY = Object.freeze({
    projectileThreatRange: 25,
    projectileApproachDot: 0.4,
    projectileMinDistance: 0.5,
    projectileMinSpeed: 1,
    projectileFarTimeToImpact: 999,
    projectileTimeToImpactBase: 0.8,
    projectileTimeToImpactAwarenessScale: 0.2,
    projectileAwarenessGuaranteedThreshold: 0.8,
    projectileVerticalEvadeThreshold: 0.2,
    spacingMinDistance: 12,
    spacingIgnoreDistance: 0.1,
    spacingRepulsionDeadzone: 0.05,
    pursuitForwardRiskCeiling: 0.3,
    pursuitYawDeadzone: 0.05,
    pursuitPitchDeadzone: 0.08,
});

export const AI_SENSOR_PRESSURE_WEIGHTS = Object.freeze({
    enemy: 0.8,
    tightSpace: 0.9,
    bounce: 0.2,
});

export const AI_SENSOR_TRAIL_COLLISION = Object.freeze({
    radiusMultiplier: 1.6,
    skipRecentSegments: 20,
});

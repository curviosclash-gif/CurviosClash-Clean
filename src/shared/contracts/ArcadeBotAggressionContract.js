const DEFAULT_ARCADE_BOT_AGGRESSIVENESS = 0.5;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function normalizeArcadeBotAggressiveness(value, fallback = DEFAULT_ARCADE_BOT_AGGRESSIVENESS) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return clamp(numeric, 0, 1);
    const fallbackNumeric = Number(fallback);
    return Number.isFinite(fallbackNumeric)
        ? clamp(fallbackNumeric, 0, 1)
        : DEFAULT_ARCADE_BOT_AGGRESSIVENESS;
}

export function applyArcadeBotAggressiveness(profile = {}, value) {
    const aggressiveness = normalizeArcadeBotAggressiveness(value);
    const offset = aggressiveness - DEFAULT_ARCADE_BOT_AGGRESSIVENESS;
    const baseAggression = Number(profile.aggression) || 0;
    const basePursuitRadius = Number(profile.pursuitRadius) || 0;
    const baseAimTolerance = Number(profile.pursuitAimTolerance) || 0.85;
    const baseRiskCeiling = Number(profile.pursuitRiskCeiling) || 0.2;
    const baseSurvivalCeiling = Number(profile.pursuitSurvivalCeiling) || 0.35;

    return {
        ...profile,
        aggression: clamp(baseAggression + (offset * 0.5), 0, 1),
        pursuitRadius: Math.max(0, basePursuitRadius * (0.8 + (aggressiveness * 0.4))),
        pursuitAimTolerance: clamp(baseAimTolerance - (offset * 0.2), 0.65, 0.98),
        pursuitRiskCeiling: clamp(baseRiskCeiling + (offset * 0.16), 0.12, 0.5),
        pursuitSurvivalCeiling: clamp(baseSurvivalCeiling + (offset * 0.18), 0.25, 0.75),
    };
}

export function resolveArcadeBridgeAggressionThresholds(value) {
    const aggressiveness = normalizeArcadeBotAggressiveness(value);
    const offset = aggressiveness - DEFAULT_ARCADE_BOT_AGGRESSIVENESS;
    return {
        shootAlignment: 0.55 - (offset * 0.14),
        shootDistance: 0.48 + (offset * 0.16),
        shootPressureCeiling: 0.9 + (offset * 0.16),
        boostDistance: 0.55 - (offset * 0.16),
        boostOpenness: 0.62 - (offset * 0.1),
        boostPressureCeiling: 0.55 + (offset * 0.16),
    };
}

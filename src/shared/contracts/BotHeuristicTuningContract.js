import { clamp } from '../utils/MathOps.js';

export const BOT_HEURISTIC_PROFILE_NAMES = Object.freeze([
    'defensive',
    'balanced',
    'aggressive',
]);

export const BOT_HEURISTIC_TUNING_LIMITS = Object.freeze({
    min: 0,
    max: 100,
    step: 1,
    integer: true,
});

export const BOT_HEURISTIC_TUNING_NEUTRAL_VALUE = 50;

function createNeutralProfileTuning() {
    return Object.freeze({
        aggression: BOT_HEURISTIC_TUNING_NEUTRAL_VALUE,
        survivalFocus: BOT_HEURISTIC_TUNING_NEUTRAL_VALUE,
    });
}

export const DEFAULT_BOT_HEURISTIC_TUNING = Object.freeze(Object.fromEntries(
    BOT_HEURISTIC_PROFILE_NAMES.map((profileName) => [profileName, createNeutralProfileTuning()])
));

function normalizeTuningValue(value, fallback = BOT_HEURISTIC_TUNING_NEUTRAL_VALUE) {
    const numeric = Number(value);
    const resolved = Number.isFinite(numeric) ? numeric : fallback;
    return Math.round(clamp(
        resolved,
        BOT_HEURISTIC_TUNING_LIMITS.min,
        BOT_HEURISTIC_TUNING_LIMITS.max
    ));
}

export function createBotHeuristicTuningSnapshot(source = null) {
    const result = {};
    for (const profileName of BOT_HEURISTIC_PROFILE_NAMES) {
        const profile = source?.[profileName];
        result[profileName] = {
            aggression: normalizeTuningValue(profile?.aggression),
            survivalFocus: normalizeTuningValue(profile?.survivalFocus),
        };
    }
    return result;
}

export function normalizeBotHeuristicProfileTuning(source = null) {
    return {
        aggression: normalizeTuningValue(source?.aggression),
        survivalFocus: normalizeTuningValue(source?.survivalFocus),
    };
}

export function isNeutralBotHeuristicProfileTuning(source = null) {
    const tuning = normalizeBotHeuristicProfileTuning(source);
    return tuning.aggression === BOT_HEURISTIC_TUNING_NEUTRAL_VALUE
        && tuning.survivalFocus === BOT_HEURISTIC_TUNING_NEUTRAL_VALUE;
}

export function toBotHeuristicTuningOffset(value) {
    return (normalizeTuningValue(value) - BOT_HEURISTIC_TUNING_NEUTRAL_VALUE)
        / BOT_HEURISTIC_TUNING_NEUTRAL_VALUE;
}

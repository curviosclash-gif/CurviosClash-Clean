export const BOT_VALIDATION_TARGETS = Object.freeze({
    ROUND: 'round',
    DUEL: 'duel',
    SURVIVAL: 'survival',
});

export function isSurvivalObservationScenario(scenario = {}) {
    return scenario.validationTarget === BOT_VALIDATION_TARGETS.SURVIVAL;
}

export function buildBotValidationOutcomeSemantics(scenario = {}, recordedRounds = [], stats = {}) {
    const sourceRounds = Array.isArray(recordedRounds) ? recordedRounds : [];
    const observationRuns = Math.max(0, Math.trunc(Number(stats.observationRuns) || 0));
    const completedObservations = Math.max(0, Math.trunc(Number(stats.completedObservations) || 0));
    if (isSurvivalObservationScenario(scenario)) {
        return {
            target: BOT_VALIDATION_TARGETS.SURVIVAL,
            rounds: [],
            outcomeRounds: 0,
            naturalOutcomeRounds: 0,
            forcedRounds: 0,
            unexpectedOutcomeRounds: sourceRounds.length,
            observationRuns,
            observationCompleted: observationRuns > 0 && completedObservations === observationRuns,
        };
    }

    const forcedRoundNumbers = new Set(Array.isArray(stats.forcedRoundNumbers) ? stats.forcedRoundNumbers : []);
    const rounds = sourceRounds.map((round, roundIndex) => ({
        ...round,
        forced: forcedRoundNumbers.has(roundIndex + 1),
    }));
    const forcedRounds = rounds.filter((round) => round.forced === true).length;
    return {
        target: scenario.validationTarget === BOT_VALIDATION_TARGETS.DUEL
            ? BOT_VALIDATION_TARGETS.DUEL
            : BOT_VALIDATION_TARGETS.ROUND,
        rounds,
        outcomeRounds: rounds.length,
        naturalOutcomeRounds: rounds.length - forcedRounds,
        forcedRounds,
        unexpectedOutcomeRounds: 0,
        observationRuns: 0,
        observationCompleted: false,
    };
}

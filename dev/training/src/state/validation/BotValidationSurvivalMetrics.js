function finiteSamples(values) {
    return (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0);
}

export function buildBotValidationSurvivalMetrics(rounds = [], observations = []) {
    const outcomeRounds = (Array.isArray(rounds) ? rounds : []).filter((round) => round?.forced !== true);
    const observationSamples = Array.isArray(observations) ? observations : [];
    const botSurvivalSeconds = [
        ...outcomeRounds.flatMap((round) => finiteSamples(
            Array.isArray(round?.botDeathSurvivalSeconds)
                ? round.botDeathSurvivalSeconds
                : round?.botSurvivalSeconds
        )),
        ...observationSamples.flatMap((observation) => finiteSamples(observation?.botDeathSurvivalSeconds)),
    ].sort((left, right) => left - right);
    const censoredBotSurvivalSeconds = observationSamples
        .flatMap((observation) => finiteSamples(observation?.censoredBotSurvivalSeconds))
        .sort((left, right) => left - right);
    return {
        botSurvivalSeconds,
        censoredBotSurvivalSeconds,
        aliveAtObservationEnd: observationSamples.reduce(
            (total, observation) => total + Math.max(0, Math.trunc(Number(observation?.aliveAtObservationEnd) || 0)),
            0
        ),
        survivedAtLeastSeconds: censoredBotSurvivalSeconds.length > 0
            ? censoredBotSurvivalSeconds[0]
            : null,
        censoredBotSurvivalSampleCount: censoredBotSurvivalSeconds.length,
        observationCompleted: observationSamples.length > 0
            ? observationSamples.every((observation) => observation?.observationCompleted === true)
            : null,
        observationSampleCount: observationSamples.length,
    };
}

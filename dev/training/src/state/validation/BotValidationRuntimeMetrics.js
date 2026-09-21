export function buildBotValidationRuntimeMetrics(runtimeSamples = [], totalDuration = 0) {
    const samples = Array.isArray(runtimeSamples) ? runtimeSamples : [];
    const decisionSnapshots = samples.flatMap((sample) => (
        Array.isArray(sample?.botDecisions)
            ? sample.botDecisions.map((entry) => entry?.snapshot).filter(Boolean)
            : []
    ));
    const intentCounts = {};
    const safetyStateCounts = {};
    const objectiveTypeCounts = {};
    const objectiveRoleCounts = {};
    for (const snapshot of decisionSnapshots) {
        const intent = String(snapshot?.intent || 'unknown');
        const safetyState = String(snapshot?.safetyState || 'unknown');
        intentCounts[intent] = (intentCounts[intent] || 0) + 1;
        safetyStateCounts[safetyState] = (safetyStateCounts[safetyState] || 0) + 1;
    }
    let objectiveBotSampleCount = 0;
    let objectiveBotExpectedSampleCount = 0;
    for (const sample of samples) {
        objectiveBotExpectedSampleCount += Math.max(0, Math.trunc(Number(sample?.botCount) || 0));
        const assignments = Array.isArray(sample?.botObjectiveAssignments)
            ? sample.botObjectiveAssignments
            : [];
        for (const assignment of assignments) {
            const objectiveType = String(assignment?.objectiveType || '').trim().toUpperCase();
            const objectiveRole = String(assignment?.objectiveRole || '').trim().toUpperCase();
            if (!objectiveType) continue;
            objectiveBotSampleCount += 1;
            objectiveTypeCounts[objectiveType] = (objectiveTypeCounts[objectiveType] || 0) + 1;
            if (objectiveRole) objectiveRoleCounts[objectiveRole] = (objectiveRoleCounts[objectiveRole] || 0) + 1;
        }
    }

    const startCounters = new Map();
    let steeringChanges = 0;
    let intentChanges = 0;
    let safetyRatioSum = 0;
    let safetyRatioSamples = 0;
    for (const sample of samples) {
        const decisions = Array.isArray(sample?.botDecisions) ? sample.botDecisions : [];
        for (const entry of decisions) {
            const snapshot = entry?.snapshot;
            if (!snapshot) continue;
            const key = `${sample.scenarioId || ''}:${sample.round}:${entry.playerIndex}`;
            if (sample.checkpoint === 'start') {
                startCounters.set(key, snapshot);
            } else if (sample.checkpoint === 'end') {
                const start = startCounters.get(key);
                steeringChanges += Math.max(0, Number(snapshot.steeringChanges) - Number(start?.steeringChanges || 0));
                intentChanges += Math.max(0, Number(snapshot.intentChanges) - Number(start?.intentChanges || 0));
                safetyRatioSum += Math.max(0, Math.min(1, Number(snapshot.safetyActiveRatio) || 0));
                safetyRatioSamples += 1;
            }
        }
    }

    const duration = Math.max(0, Number(totalDuration) || 0);
    return {
        decisionSampleCount: decisionSnapshots.length,
        intentCounts,
        safetyStateCounts,
        steeringChanges,
        intentChanges,
        steeringChangesPerSecond: duration > 0 ? steeringChanges / duration : 0,
        intentChangesPerSecond: duration > 0 ? intentChanges / duration : 0,
        averageSafetyActiveRatio: safetyRatioSamples > 0 ? safetyRatioSum / safetyRatioSamples : 0,
        objectiveBotSampleCount,
        objectiveBotExpectedSampleCount,
        objectiveParticipationRate: objectiveBotExpectedSampleCount > 0
            ? objectiveBotSampleCount / objectiveBotExpectedSampleCount
            : 0,
        objectiveTypeCounts,
        objectiveRoleCounts,
    };
}

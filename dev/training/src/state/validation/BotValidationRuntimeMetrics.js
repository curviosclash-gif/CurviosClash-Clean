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
        const expectedObjectiveType = sample?.runtimeTeamMode === true
            ? String(sample?.runtimeTeamObjective || '').trim().toUpperCase()
            : '';
        if (!['FLAGS', 'ESCORT'].includes(expectedObjectiveType)) continue;
        objectiveBotExpectedSampleCount += Math.max(0, Math.trunc(Number(sample?.botCount) || 0));
        const assignments = Array.isArray(sample?.botObjectiveAssignments)
            ? sample.botObjectiveAssignments
            : [];
        for (const assignment of assignments) {
            const objectiveType = String(assignment?.objectiveType || '').trim().toUpperCase();
            const objectiveRole = String(assignment?.objectiveRole || '').trim().toUpperCase();
            if (objectiveType !== expectedObjectiveType) continue;
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

function distance3d(first, second) {
    if (!first || !second) return null;
    const values = ['x', 'y', 'z'].map((axis) => Number(first[axis]) - Number(second[axis]));
    if (!values.every(Number.isFinite)) return null;
    return Math.hypot(...values);
}

function resolveObjectiveRole(bot) {
    const objectiveType = String(bot?.objectiveType || '').trim().toUpperCase();
    const role = objectiveType === 'FLAGS'
        ? (bot?.flagBotRole ?? bot?.objectiveRole)
        : objectiveType === 'ESCORT' ? (bot?.escortBotRole ?? bot?.objectiveRole) : '';
    return String(role || '').trim().toUpperCase();
}

function countFlagProgress(samples) {
    let targetApproachPairs = 0;
    let defenderApproachPairs = 0;
    let enemyFlagHpDamage = 0;
    let captures = 0;
    let alphaAttackerApproachPairs = 0;
    let bravoAttackerApproachPairs = 0;
    let alphaDefenderApproachPairs = 0;
    let bravoDefenderApproachPairs = 0;
    let alphaCaptures = 0;
    let bravoCaptures = 0;
    let unattributedCaptureEvents = 0;
    for (let index = 1; index < samples.length; index += 1) {
        const previous = samples[index - 1];
        const current = samples[index];
        const previousFlags = new Map((previous.flags || []).map((flag) => [flag.id, flag]));
        const currentFlags = new Map((current.flags || []).map((flag) => [flag.id, flag]));
        const previousBots = new Map((previous.bots || []).map((bot) => [bot.playerIndex, bot]));
        for (const bot of current.bots || []) {
            const priorBot = previousBots.get(bot.playerIndex);
            const targetId = String(bot.objectiveTargetId || '');
            if (String(bot.objectiveType || '').toUpperCase() !== 'FLAGS'
                || String(priorBot?.objectiveType || '').toUpperCase() !== 'FLAGS'
                || !priorBot || !targetId || targetId !== String(priorBot.objectiveTargetId || '')) continue;
            const target = currentFlags.get(targetId);
            const priorTarget = previousFlags.get(targetId);
            const beforeDistance = distance3d(priorBot.position, priorTarget?.position);
            const afterDistance = distance3d(bot.position, target?.position);
            if (beforeDistance === null || afterDistance === null || afterDistance >= beforeDistance) continue;
            const role = resolveObjectiveRole(bot);
            if (String(target.teamId).toUpperCase() === String(bot.teamId).toUpperCase()) {
                if (role === 'DEFENDER') {
                    defenderApproachPairs += 1;
                    if (String(bot.teamId).toUpperCase() === 'ALPHA') alphaDefenderApproachPairs += 1;
                    if (String(bot.teamId).toUpperCase() === 'BRAVO') bravoDefenderApproachPairs += 1;
                }
            } else if (['ATTACKER', 'FLEX'].includes(role)) {
                targetApproachPairs += 1;
                if (String(bot.teamId).toUpperCase() === 'ALPHA') alphaAttackerApproachPairs += 1;
                if (String(bot.teamId).toUpperCase() === 'BRAVO') bravoAttackerApproachPairs += 1;
            }
        }
        for (const [id, priorFlag] of previousFlags) {
            const flag = currentFlags.get(id);
            if (!flag) continue;
            const sameOwner = String(flag.teamId).toUpperCase() === String(priorFlag.teamId).toUpperCase();
            if (sameOwner
                && Number.isFinite(Number(priorFlag.hp)) && Number.isFinite(Number(flag.hp))) {
                enemyFlagHpDamage += Math.max(0, Number(priorFlag.hp) - Number(flag.hp));
            }
        }
        const previousCaptureId = Math.max(0, Math.trunc(Number(previous.flagCaptureEvent?.id) || 0));
        const captureId = Math.max(0, Math.trunc(Number(current.flagCaptureEvent?.id) || 0));
        if (captureId > previousCaptureId) {
            const capturePlayerIndex = Number(current.flagCaptureEvent?.playerIndex);
            const creditedBot = (current.bots || []).some((bot) => (
                bot.playerIndex === capturePlayerIndex
                && String(bot.objectiveType).toUpperCase() === 'FLAGS'
                && ['ATTACKER', 'FLEX'].includes(resolveObjectiveRole(bot))
            ));
            const missingEvents = Math.max(0, captureId - previousCaptureId - 1);
            unattributedCaptureEvents += missingEvents;
            if (creditedBot) {
                captures += 1;
                const bot = current.bots.find((entry) => entry.playerIndex === capturePlayerIndex);
                if (String(bot?.teamId).toUpperCase() === 'ALPHA') alphaCaptures += 1;
                if (String(bot?.teamId).toUpperCase() === 'BRAVO') bravoCaptures += 1;
            }
        }
    }
    return {
        targetApproachPairs,
        defenderApproachPairs,
        enemyFlagHpDamage,
        captures,
        alphaAttackerApproachPairs,
        bravoAttackerApproachPairs,
        alphaDefenderApproachPairs,
        bravoDefenderApproachPairs,
        alphaCaptures,
        bravoCaptures,
        unattributedCaptureEvents,
    };
}

function countEscortProgress(samples) {
    let progressDelta = 0;
    let checkpointsReached = 0;
    let alphaNearEscortSamples = 0;
    let alphaEscortSeconds = 0;
    let alphaCheckpointContributions = 0;
    let alphaRepairs = 0;
    let alphaRecoveries = 0;
    let alphaGuardKills = 0;
    let bravoTankDamage = 0;
    let bravoAttackKills = 0;
    let bravoTankDowns = 0;
    let bravoFinalDestructions = 0;
    for (const sample of samples) {
        const objectiveBots = (sample.bots || []).filter((bot) => (
            String(bot.objectiveType || '').trim().toUpperCase() === 'ESCORT'
        ));
        const assignmentsByPlayer = new Map(objectiveBots.map((bot) => [bot.playerIndex, bot]));
        const tank = sample.escort || null;
        const previousTank = sample._previousEscort || null;
        if (tank && previousTank) {
            progressDelta += Math.max(0, Number(tank.progress) - Number(previousTank.progress));
            checkpointsReached += Math.max(0,
                Number(tank.checkpointsReached) - Number(previousTank.checkpointsReached));
        }
        for (const bot of objectiveBots) {
            const role = resolveObjectiveRole(bot);
            if (['ESCORT', 'VANGUARD', 'GUARD'].includes(role) && bot.nearEscortTank === true) {
                alphaNearEscortSamples += 1;
            }
        }
        for (const row of sample.scoreboard || []) {
            const bot = assignmentsByPlayer.get(row.playerIndex);
            if (!bot) continue;
            const priorRow = sample._previousScoreboard?.get(row.playerIndex);
            if (!priorRow) continue;
            const role = resolveObjectiveRole(bot);
            if (['ESCORT', 'VANGUARD', 'GUARD'].includes(role)) {
                alphaEscortSeconds += Math.max(0, Number(row.escortSeconds) - Number(priorRow.escortSeconds));
                alphaCheckpointContributions += Math.max(0,
                    Number(row.escortCheckpointContributions) - Number(priorRow.escortCheckpointContributions));
                alphaRepairs += Math.max(0, Number(row.escortRepairHp) - Number(priorRow.escortRepairHp));
                alphaRecoveries += Math.max(0, Number(row.escortRecoveries) - Number(priorRow.escortRecoveries));
                alphaGuardKills += Math.max(0, Number(row.escortGuardKills) - Number(priorRow.escortGuardKills));
            }
            if (['HUNTER', 'INTERCEPTOR', 'FLANKER'].includes(role)) {
                bravoTankDamage += Math.max(0, Number(row.escortTankDamage) - Number(priorRow.escortTankDamage));
                bravoAttackKills += Math.max(0, Number(row.escortAttackKills) - Number(priorRow.escortAttackKills));
                bravoTankDowns += Math.max(0, Number(row.escortTankDowns) - Number(priorRow.escortTankDowns));
                bravoFinalDestructions += Math.max(0,
                    Number(row.escortFinalDestructions) - Number(priorRow.escortFinalDestructions));
            }
        }
    }
    return {
        progressDelta,
        checkpointsReached,
        alphaNearEscortSamples,
        alphaEscortSeconds,
        alphaCheckpointContributions,
        alphaRepairs,
        alphaRecoveries,
        alphaGuardKills,
        bravoTankDamage,
        bravoAttackKills,
        bravoTankDowns,
        bravoFinalDestructions,
    };
}

function withObjectiveBaselines(samples) {
    const previousScoreboard = new Map();
    let previousEscort = null;
    return samples.map((sample) => {
        const normalized = {
            ...sample,
            _previousEscort: previousEscort,
            _previousScoreboard: new Map(previousScoreboard),
        };
        previousEscort = sample.escort || null;
        previousScoreboard.clear();
        for (const row of sample.scoreboard || []) previousScoreboard.set(row.playerIndex, row);
        return normalized;
    });
}

export function buildBotValidationObjectiveMetrics(scenario = {}, observations = []) {
    const objectiveType = scenario?.teamMode === true
        ? String(scenario?.teamObjective || '').trim().toUpperCase()
        : '';
    if (!['FLAGS', 'ESCORT'].includes(objectiveType)) return null;
    const runs = (Array.isArray(observations) ? observations : [])
        .filter((observation) => Array.isArray(observation?.objectiveSnapshots));
    const snapshots = runs.flatMap((observation) => observation.objectiveSnapshots);
    const evidenceByRun = runs.map((run) => objectiveType === 'FLAGS'
        ? countFlagProgress(run.objectiveSnapshots)
        : countEscortProgress(withObjectiveBaselines(run.objectiveSnapshots)));
    const evidenceKeys = objectiveType === 'FLAGS'
        ? [
            'targetApproachPairs', 'defenderApproachPairs', 'enemyFlagHpDamage', 'captures',
            'alphaAttackerApproachPairs', 'bravoAttackerApproachPairs',
            'alphaDefenderApproachPairs', 'bravoDefenderApproachPairs',
            'alphaCaptures', 'bravoCaptures', 'unattributedCaptureEvents',
        ]
        : [
            'progressDelta', 'checkpointsReached', 'alphaNearEscortSamples', 'alphaEscortSeconds',
            'alphaCheckpointContributions', 'alphaRepairs', 'alphaRecoveries', 'alphaGuardKills',
            'bravoTankDamage', 'bravoAttackKills', 'bravoTankDowns', 'bravoFinalDestructions',
        ];
    const evidence = Object.fromEntries(evidenceKeys.map((key) => [
        key,
        evidenceByRun.reduce((total, row) => total + Number(row[key] || 0), 0),
    ]));
    const actionEvidenceCount = objectiveType === 'FLAGS'
        ? evidence.targetApproachPairs + evidence.defenderApproachPairs + evidence.captures
        : (evidence.alphaEscortSeconds > 0 ? 1 : 0)
            + evidence.alphaCheckpointContributions + (evidence.alphaRepairs > 0 ? 1 : 0)
            + evidence.alphaRecoveries + evidence.alphaGuardKills
            + (evidence.bravoTankDamage > 0 ? 1 : 0) + evidence.bravoAttackKills + evidence.bravoTankDowns
            + evidence.bravoFinalDestructions;
    const observationCompleted = runs.length > 0 && runs.every((run) => run.observationCompleted === true);
    const naturalOutcomeRuns = runs.filter((run) => run.naturalObjectiveOutcomeObserved === true).length;
    const progressStatus = snapshots.length < 2
        ? 'incomplete'
        : actionEvidenceCount > 0 ? 'evidence-observed' : 'insufficient';
    return {
        objectiveType,
        observationRunCount: runs.length,
        observationSampleCount: snapshots.length,
        observationCompleted,
        naturalOutcomeRuns,
        naturalOutcomeObserved: naturalOutcomeRuns > 0,
        progressStatus,
        objectiveProgressObserved: objectiveType === 'ESCORT'
            ? evidence.progressDelta > 0 || evidence.checkpointsReached > 0
            : evidence.enemyFlagHpDamage > 0 || evidence.captures > 0,
        actionEvidenceCount,
        evidence,
    };
}

import { buildArcadeRunSummary } from '../../state/arcade/ArcadeScoreOps.js';
import { mergeArcadeDailyRunRecords } from '../../state/arcade/ArcadeDailyState.js';
import { ARCADE_RUN_PHASES, createArcadeRunRecords } from '../../state/arcade/ArcadeRunState.js';
import { toSafeInt, toSafeNumber } from '../../shared/utils/ArcadeUtils.js';

export function recordArcadeDailyResult(runtime, nowMs = Date.now()) {
    if (!runtime._state?.isDailyChallenge || runtime._state.dailyResult) return;
    const summary = buildArcadeRunSummary(runtime._state, { endedAtMs: nowMs });
    const merged = mergeArcadeDailyRunRecords(runtime._records, summary);
    runtime._records = { ...runtime._records, daily: merged.records.daily };
    runtime._state.dailyResult = merged.dailyResult;
    runtime._scheduleRecordsSave(runtime._records);
    runtime.flushPersistenceSaves();
}

export function finalizeArcadeRun(runtime, nowMs = Date.now()) {
    if (!runtime._state) return null;
    if (runtime._state.persistedAtIso) {
        return runtime.getStateSnapshot();
    }
    if (runtime._state.finishedAtIso) {
        runtime.flushPersistenceSaves();
        return runtime.getStateSnapshot();
    }

    const replaySnapshot = runtime._stopReplayRecording();
    runtime._latestReplaySnapshot = replaySnapshot && typeof replaySnapshot === 'object'
        ? { ...replaySnapshot }
        : null;
    const replayId = typeof replaySnapshot?.matchId === 'string' ? replaySnapshot.matchId : '';
    const summary = buildArcadeRunSummary(runtime._state, {
        endedAtMs: nowMs,
        replayId,
    });
    if (!summary) return runtime.getStateSnapshot();

    runtime._recordDailyResult(nowMs);
    const { records } = mergeArcadeDailyRunRecords(runtime._records, { ...summary, isDailyChallenge: false });
    const dailyResult = runtime._state.dailyResult;
    runtime._records = records;
    const sectorHistory = Array.isArray(runtime._state.sectorHistory)
        ? runtime._state.sectorHistory.map((entry) => ({ ...entry }))
        : [];
    const missionsCompleted = sectorHistory.reduce((sum, entry) => sum + Math.max(0, toSafeInt(entry?.missionsCompleted, 0)), 0);
    const missionsTotal = sectorHistory.reduce((sum, entry) => sum + Math.max(0, toSafeInt(entry?.missionsTotal, 0)), 0);
    const missionCompletionRate = missionsTotal > 0 ? missionsCompleted / missionsTotal : 0;
    const xpEarned = runtime._state.xpEarned;
    const scorePerSector = sectorHistory.map((entry) => ({
        sectorIndex: Math.max(0, toSafeInt(entry?.sectorIndex, 0)),
        mapKey: String(entry?.mapKey || ''),
        modifierId: String(entry?.modifierId || ''),
        awardedPoints: Math.max(0, toSafeNumber(entry?.awardedPoints, 0)),
        comboAtSectorEnd: Math.max(0, toSafeInt(entry?.comboAtSectorEnd, 0)),
    }));
    const postRunSummary = {
        generatedAtIso: new Date(Math.max(0, toSafeNumber(nowMs, Date.now()))).toISOString(),
        runId: String(summary.runId || ''),
        isDailyChallenge: summary.isDailyChallenge === true,
        seed: Math.max(0, toSafeInt(summary.seed, 0)),
        score: Math.max(0, toSafeNumber(summary.score, 0)),
        peakMultiplier: Math.max(1, toSafeNumber(summary.peakMultiplier, 1)),
        bestCombo: Math.max(0, toSafeInt(summary.peakCombo, 0)),
        completedSectors: Math.max(0, toSafeInt(summary.completedSectors, 0)),
        missionCompletionRate,
        missionsCompleted,
        missionsTotal,
        xpEarned: Math.max(0, Math.round(xpEarned)),
        xpAnimation: {
            from: 0,
            to: Math.max(0, Math.round(xpEarned)),
            durationMs: 900,
        },
        scorePerSector,
        breakdown: summary.breakdown,
        sectorHistory,
        rewardHistory: Array.isArray(runtime._state.rewardHistory)
            ? runtime._state.rewardHistory.map((entry) => ({ ...entry }))
            : [],
        dailyResult,
        bonusScore: dailyResult ? Math.max(0, summary.score - dailyResult.score) : 0,
    };
    const replayState = runtime.getReplayState();
    runtime._state = {
        ...runtime._state,
        phase: ARCADE_RUN_PHASES.FINISHED,
        finishedAtIso: summary.finishedAtIso,
        persistedAtIso: '',
        updatedAtIso: summary.finishedAtIso,
        records: createArcadeRunRecords(runtime._records),
        postRunSummary,
        replay: {
            runReplayId: replayId,
            playbackEnabled: replayState.playbackEnabled,
            payloadAvailable: replayState.payloadAvailable,
        },
    };
    const finalizedRunId = String(summary.runId || '');
    runtime._scheduleRecordsSave(runtime._records, () => {
        if (String(runtime._state?.runId || '') !== finalizedRunId) return;
        runtime._state.persistedAtIso = summary.finishedAtIso;
        runtime._state.updatedAtIso = summary.finishedAtIso;
    });
    return runtime.getStateSnapshot();
}

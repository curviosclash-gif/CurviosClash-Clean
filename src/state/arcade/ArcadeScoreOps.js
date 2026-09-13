import { ARCADE_RUN_PHASES, createArcadeRunRecords, createArcadeRunState } from './ArcadeRunState.js';
import { toSafeNumber, clampInteger } from '../../shared/utils/ArcadeUtils.js';
import { CURRENT_ARCADE_SCORE_MODEL } from '../../shared/contracts/ArcadeRunSettingsContract.js';

const SURVIVAL_LATE_THRESHOLD_SEC = 30;
const SURVIVAL_MAX_DURATION_SEC = 180;
const SURVIVAL_LATE_BONUS_CAP = 2000;

/** Base score per sector template — harder templates reward more. */
const SECTOR_BASE_SCORES = Object.freeze({
    sector_intro: 180,
    sector_pressure: 250,
    sector_hazard: 320,
    sector_endurance: 400,
});

/** Points per kill, multiplied by the current multiplier. */
const KILL_SCORE_BASE = 35;
const PARCOURS_SCORE = Object.freeze({ completion: 500, checkpoint: 25, time: 1000, precision: 200, referenceMs: 60000 });

/** Fractional combo increments per in-game action (61.2.1). */
const COMBO_ACTION_INCREMENTS = Object.freeze({
    kill: 1,
    collect: 0.5,
});

function normalizeTelemetryPayload(payload = null) {
    const source = payload && typeof payload === 'object' ? payload : {};
    return {
        duration: Math.max(0, toSafeNumber(source.duration, 0)),
        selfCollisions: Math.max(0, clampInteger(source.selfCollisions, 0, 9999, 0)),
        itemUses: Math.max(0, clampInteger(source.itemUses, 0, 9999, 0)),
        stuckEvents: Math.max(0, clampInteger(source.stuckEvents, 0, 9999, 0)),
        kills: Math.max(0, clampInteger(source.kills, 0, 9999, 0)),
    };
}

function createScoreBreakdown(source = null) {
    const input = source && typeof source === 'object' ? source : {};
    const base = Math.max(0, toSafeNumber(input.base, 0));
    const survival = Math.max(0, toSafeNumber(input.survival, 0));
    const kills = Math.max(0, toSafeNumber(input.kills, 0));
    const cleanSector = Math.max(0, toSafeNumber(input.cleanSector, 0));
    const risk = Math.max(0, toSafeNumber(input.risk, 0));
    const penalty = Math.max(0, toSafeNumber(input.penalty, 0));
    const completion = Math.max(0, toSafeNumber(input.completion, 0));
    const checkpoints = Math.max(0, toSafeNumber(input.checkpoints, 0));
    const time = Math.max(0, toSafeNumber(input.time, 0));
    const precision = Math.max(0, toSafeNumber(input.precision, 0));
    const total = Math.max(0, toSafeNumber(input.total, base + survival + kills + cleanSector + risk - penalty + completion + checkpoints + time + precision));
    return {
        base,
        survival,
        kills,
        cleanSector,
        risk,
        penalty,
        completion, checkpoints, time, precision,
        total,
    };
}

function resolveMultiplierFromCombo(combo, maxMultiplier) {
    const normalizedCombo = Math.max(0, clampInteger(combo, 0, 99_999, 0));
    const normalizedMax = Math.max(1, clampInteger(maxMultiplier, 1, 99, 8));
    return Math.max(1, Math.min(normalizedMax, 1 + Math.floor(normalizedCombo / 2)));
}

function resolveMasteryPct(perks, key) {
    return Math.max(0, Math.min(100, toSafeNumber(perks?.[key], 0)));
}

export function applyArcadeComboDecay(scoreState = null, config = null, nowMs = Date.now(), masteryPerks = null) {
    const sourceScore = scoreState && typeof scoreState === 'object' ? scoreState : {};
    const sourceConfig = config && typeof config === 'object' ? config : {};
    const comboWindowMs = Math.max(800, toSafeNumber(sourceConfig.comboWindowMs, 5000));
    const comboDecayPerSecond = Math.max(0, toSafeNumber(sourceConfig.comboDecayPerSecond, 1));
    const maxMultiplier = Math.max(1, clampInteger(sourceConfig.maxMultiplier, 1, 99, 8));

    const currentCombo = Math.max(0, clampInteger(sourceScore.combo, 0, 99_999, 0));
    const lastComboAtMs = Math.max(0, toSafeNumber(sourceScore.lastComboAtMs, 0));
    const now = Math.max(0, toSafeNumber(nowMs, Date.now()));

    const rule = `${comboWindowMs}:${comboDecayPerSecond}:${resolveMasteryPct(masteryPerks, 'comboDecaySlowPct')}`;
    if (currentCombo <= 0 || comboDecayPerSecond <= 0) {
        return {
            ...sourceScore,
            combo: currentCombo,
            comboDecayRule: rule,
            multiplier: resolveMultiplierFromCombo(currentCombo, maxMultiplier),
        };
    }

    if (sourceScore.comboDecayRule && sourceScore.comboDecayRule !== rule) {
        return { ...sourceScore, lastComboAtMs: now, comboDecayApplied: 0, comboDecayRule: rule };
    }
    const elapsedMs = Math.max(0, now - lastComboAtMs);
    if (elapsedMs <= comboWindowMs) {
        return {
            ...sourceScore,
            combo: currentCombo,
            comboDecayRule: rule,
            multiplier: resolveMultiplierFromCombo(currentCombo, maxMultiplier),
        };
    }

    // 61.2.2 — Accelerating decay: slow first 2s, fast after 3s
    const decaySeconds = (elapsedMs - comboWindowMs) / 1000;
    let decayAmount;
    if (decaySeconds <= 2) {
        decayAmount = Math.floor(decaySeconds * comboDecayPerSecond * 0.5);
    } else if (decaySeconds <= 3) {
        const slowPart = Math.floor(2 * comboDecayPerSecond * 0.5);
        const fastPart = Math.floor((decaySeconds - 2) * comboDecayPerSecond * 2.5);
        decayAmount = slowPart + fastPart;
    } else {
        const slowPart = Math.floor(2 * comboDecayPerSecond * 0.5);
        const midPart = Math.floor(1 * comboDecayPerSecond * 2.5);
        const superFastPart = Math.floor((decaySeconds - 3) * comboDecayPerSecond * 2.5);
        decayAmount = slowPart + midPart + superFastPart;
    }
    const comboDecaySlowPct = resolveMasteryPct(masteryPerks, 'comboDecaySlowPct');
    const masteryAdjustedDecay = Math.floor(decayAmount * (1 - comboDecaySlowPct / 100));
    const decayedCombo = Math.max(0, currentCombo - Math.max(0, masteryAdjustedDecay - toSafeNumber(sourceScore.comboDecayApplied, 0)));
    return {
        ...sourceScore,
        combo: decayedCombo,
        comboDecayApplied: masteryAdjustedDecay,
        comboDecayRule: rule,
        multiplier: resolveMultiplierFromCombo(decayedCombo, maxMultiplier),
    };
}

/**
 * Increment combo based on an in-game action (kill or collect).
 * Uses fractional accumulation — partial increments add up over time.
 * 61.2.1
 */
export function reanchorArcadeCombo(state) {
    if (!state?.score) return;
    const now = Math.max(0, Number(state.gameplayTimeMs) || 0);
    const score = now < (state.comboFreezeUntilMs || 0) ? state.score
        : applyArcadeComboDecay(state.score, state.config, now, state.masteryPerks);
    state.score = { ...score, lastComboAtMs: now, comboDecayApplied: 0, comboDecayRule: null };
}

export function applyComboAction(scoreState = null, event = null, config = null) {
    const sourceScore = scoreState && typeof scoreState === 'object' ? scoreState : {};
    const sourceConfig = config && typeof config === 'object' ? config : {};
    const eventType = typeof event?.type === 'string' ? event.type : '';
    const increment = COMBO_ACTION_INCREMENTS[eventType] ?? 0;
    if (increment <= 0) return sourceScore;

    const maxMultiplier = Math.max(1, clampInteger(sourceConfig.maxMultiplier, 1, 99, 8));
    const currentCombo = Math.max(0, clampInteger(sourceScore.combo, 0, 99_999, 0));
    const currentAccum = Math.max(0, toSafeNumber(sourceScore.comboAccum, 0));
    const newAccum = currentAccum + increment;
    const comboGain = Math.floor(newAccum);
    const nextCombo = Math.min(99_999, currentCombo + comboGain);
    const nowMs = Math.max(0, toSafeNumber(event?.nowMs, Date.now()));

    return {
        ...sourceScore,
        combo: nextCombo,
        comboAccum: newAccum - comboGain,
        multiplier: resolveMultiplierFromCombo(nextCombo, maxMultiplier),
        lastComboAtMs: nowMs,
        comboDecayApplied: 0,
        comboDecayRule: null,
    };
}

export function computeArcadeSectorScoreBreakdown(payload = null, { sectorTemplateId = '', parcours = null } = {}) {
    if (sectorTemplateId === 'sector_parcours') {
        const timeMs = Number(parcours?.completionTimeMs);
        const referenceMs = Math.max(1, toSafeNumber(parcours?.referenceTimeMs, PARCOURS_SCORE.referenceMs));
        const completion = PARCOURS_SCORE.completion;
        const checkpoints = Math.max(0, Math.trunc(Number(parcours?.checkpointCount) || 0)) * PARCOURS_SCORE.checkpoint;
        const time = Number.isFinite(timeMs) && timeMs > 0
            ? Math.round(PARCOURS_SCORE.time * Math.max(0, 1 - timeMs / (2 * referenceMs))) : 0;
        const precision = parcours && ['wrongOrderCount', 'resetCount', 'checkpointRespawnsUsed']
            .every(key => Number(parcours[key] || 0) === 0) ? PARCOURS_SCORE.precision : 0;
        return createScoreBreakdown({ completion, checkpoints, time, precision,
            total: completion + checkpoints + time + precision });
    }
    const telemetry = normalizeTelemetryPayload(payload);

    // 61.1.1 — Dynamic base score per sector template
    const base = SECTOR_BASE_SCORES[sectorTemplateId] || SECTOR_BASE_SCORES.sector_intro;

    // Reward survival after 30 seconds with a capped quadratic bonus.
    const dur = Math.min(SURVIVAL_MAX_DURATION_SEC, telemetry.duration);
    const linearPart = dur * 10;
    const lateBonusSec = Math.max(0, dur - SURVIVAL_LATE_THRESHOLD_SEC);
    const lateBonus = Math.min(SURVIVAL_LATE_BONUS_CAP, Math.round(lateBonusSec * lateBonusSec * 0.8));
    const survival = Math.round(linearPart + lateBonus);

    // 61.1.2 — Kill-based scoring
    const kills = telemetry.kills * KILL_SCORE_BASE;

    const cleanSector = telemetry.selfCollisions === 0 ? 120 : 0;
    const risk = telemetry.itemUses === 0
        ? 90
        : Math.max(0, 60 - telemetry.itemUses * 12);
    const penalty = (telemetry.selfCollisions * 80) + (telemetry.stuckEvents * 60);
    const total = Math.max(0, base + survival + kills + cleanSector + risk - penalty);
    return {
        base,
        survival,
        kills,
        cleanSector,
        risk,
        penalty,
        completion: 0, checkpoints: 0, time: 0, precision: 0,
        total,
    };
}

export function applyArcadeSectorScore(runState, payload = null, {
    nowMs = Date.now(),
    masteryPerks = null,
} = {}) {
    if (!runState || typeof runState !== 'object' || runState.enabled !== true) {
        return runState;
    }

    const sectorResult = runState.lastCompletedSectorResult && typeof runState.lastCompletedSectorResult === 'object'
        ? runState.lastCompletedSectorResult
        : null;
    const completedSectors = Math.max(0, clampInteger(
        sectorResult?.sectorIndex ?? runState.completedSectors,
        0,
        99_999,
        0
    ));
    const sourceScore = runState.score && typeof runState.score === 'object'
        ? runState.score
        : createArcadeRunState().score;
    const lastScoredSector = Math.max(0, clampInteger(sourceScore.lastScoredSector, 0, 99_999, 0));
    if (completedSectors <= lastScoredSector) {
        return runState;
    }

    const now = Math.max(0, toSafeNumber(nowMs, Date.now()));
    const decayedScore = now <= (runState.comboFreezeUntilMs || 0) ? sourceScore
        : applyArcadeComboDecay(sourceScore, runState.config, now, masteryPerks);
    // 61.6.3: In SUDDEN_DEATH, combo increments by 2 per sector for faster multiplier growth
    const isSuddenDeath = sectorResult
        ? sectorResult.wasSuddenDeath === true
        : String(runState.phase || '') === ARCADE_RUN_PHASES.SUDDEN_DEATH;
    const comboStep = isSuddenDeath ? 2 : 1;
    const nextCombo = Math.max(1, clampInteger(decayedScore.combo + comboStep, 1, 99_999, 1));
    const nextMultiplier = resolveMultiplierFromCombo(nextCombo, runState?.config?.maxMultiplier);

    // Resolve sector template and modifier bonus (61.1.1, 61.4.2)
    const sectorSeq = Array.isArray(runState.encounterSequence) ? runState.encounterSequence : [];
    const sectorEntry = sectorSeq[Math.max(0, completedSectors - 1)] || null;
    const sectorTemplateId = String(sectorEntry?.templateId || '');
    const scoreBonus = Math.max(0, toSafeNumber(sectorEntry?.scoreBonus, 0));
    const breakdown = computeArcadeSectorScoreBreakdown(payload, { sectorTemplateId, parcours: sectorResult?.parcours });
    // 61.4.2: apply modifier scoreBonus as a multiplier on top of the sector total
    // 61.5.2: apply bossMultiplier for the final boss sector (doubles sector score)
    const bonusMultiplier = 1 + scoreBonus;
    const bossMultiplier = Math.max(1, toSafeNumber(sectorEntry?.bossMultiplier, 1));
    const objectiveState = runState.objectiveState && typeof runState.objectiveState === 'object'
        ? runState.objectiveState
        : null;
    const objectiveMultiplier = objectiveState?.completed === true
        && Math.max(0, clampInteger(objectiveState.sectorIndex, 0, 99_999, 0)) === completedSectors
        ? Math.max(1, toSafeNumber(objectiveState.scoreWeight, 1))
        : 1;
    const masteryScoreMultiplier = 1 + resolveMasteryPct(masteryPerks, 'scoreBonusPct') / 100;
    const sectorPoints = Math.round(
        Math.max(0, breakdown.total)
        * nextMultiplier
        * bonusMultiplier
        * bossMultiplier
        * objectiveMultiplier
        * masteryScoreMultiplier
    );

    const nextBreakdown = createScoreBreakdown({
        precision: toSafeNumber(sourceScore?.breakdown?.precision, 0) + breakdown.precision,
        time: toSafeNumber(sourceScore?.breakdown?.time, 0) + breakdown.time,
        checkpoints: toSafeNumber(sourceScore?.breakdown?.checkpoints, 0) + breakdown.checkpoints,
        completion: toSafeNumber(sourceScore?.breakdown?.completion, 0) + breakdown.completion,
        base: toSafeNumber(sourceScore?.breakdown?.base, 0) + breakdown.base,
        survival: toSafeNumber(sourceScore?.breakdown?.survival, 0) + breakdown.survival,
        kills: toSafeNumber(sourceScore?.breakdown?.kills, 0) + breakdown.kills,
        cleanSector: toSafeNumber(sourceScore?.breakdown?.cleanSector, 0) + breakdown.cleanSector,
        risk: toSafeNumber(sourceScore?.breakdown?.risk, 0) + breakdown.risk,
        penalty: toSafeNumber(sourceScore?.breakdown?.penalty, 0) + breakdown.penalty,
        total: toSafeNumber(sourceScore?.breakdown?.total, 0) + sectorPoints,
    });

    // 61.6.3: Track separate sudden death score for leaderboard
    const prevSuddenDeathScore = Math.max(0, toSafeNumber(sourceScore.suddenDeathScore, 0));
    const suddenDeathScore = isSuddenDeath ? prevSuddenDeathScore + sectorPoints : prevSuddenDeathScore;

    return {
        ...runState,
        score: {
            ...decayedScore,
            total: Math.max(0, toSafeNumber(sourceScore.total, 0) + sectorPoints),
            combo: nextCombo,
            multiplier: nextMultiplier,
            peakMultiplier: Math.max(
                Math.max(1, toSafeNumber(sourceScore.peakMultiplier, 1)),
                nextMultiplier
            ),
            peakCombo: Math.max(
                Math.max(0, clampInteger(sourceScore.peakCombo, 0, 99_999, 0)),
                nextCombo
            ),
            lastComboAtMs: now,
            comboDecayApplied: 0,
            comboDecayRule: null,
            lastScoredSector: completedSectors,
            lastSectorPoints: sectorPoints + (sourceScore.lastMissionBonus || 0),
            suddenDeathScore,
            breakdown: nextBreakdown,
        },
        lastSectorSummary: {
            sectorIndex: completedSectors,
            sectorPhase: String(sectorResult?.sectorPhase || runState.phase || ''),
            wasSuddenDeath: isSuddenDeath,
            encounterId: String(sectorResult?.encounterId || sectorEntry?.encounterId || sectorEntry?.id || sectorTemplateId),
            modifierId: String(sectorResult?.modifierId || sectorEntry?.modifierId || ''),
            awardedPoints: sectorPoints + (sourceScore.lastMissionBonus || 0),
            missionBonus: sourceScore.lastMissionBonus || 0,
            scoreFactor: nextMultiplier * bonusMultiplier * bossMultiplier * objectiveMultiplier * masteryScoreMultiplier,
            multiplierApplied: nextMultiplier,
            objectiveMultiplierApplied: objectiveMultiplier,
            comboAtSectorEnd: nextCombo,
            breakdown,
        },
    };
}

export function buildArcadeRunSummary(runState, { endedAtMs = Date.now(), replayId = '' } = {}) {
    if (!runState || typeof runState !== 'object') {
        return null;
    }
    const safeScore = runState.score && typeof runState.score === 'object'
        ? runState.score
        : createArcadeRunState().score;
    const endedAtIso = new Date(Math.max(0, toSafeNumber(endedAtMs, Date.now()))).toISOString();
    const summary = {
        scoreModel: CURRENT_ARCADE_SCORE_MODEL,
        succeeded: runState.completedSectors >= runState.config?.sectorCount,
        runId: String(runState.runId || ''),
        score: Math.max(0, toSafeNumber(safeScore.total, 0)),
        peakMultiplier: Math.max(1, toSafeNumber(safeScore.peakMultiplier, safeScore.multiplier || 1)),
        peakCombo: Math.max(0, clampInteger(safeScore.peakCombo, 0, 99_999, 0)),
        completedSectors: Math.max(0, clampInteger(runState.completedSectors, 0, 99_999, 0)),
        finishedAtIso: endedAtIso,
        replayId: String(replayId || ''),
        breakdown: createScoreBreakdown(safeScore.breakdown),
        suddenDeathScore: Math.max(0, toSafeNumber(safeScore.suddenDeathScore, 0)),
        isDailyChallenge: runState.isDailyChallenge === true || runState?.config?.dailyChallenge === true,
        seed: Math.max(0, clampInteger(runState?.config?.seed, 0, 2_147_483_647, 0)),
    };
    return summary;
}

export function mergeArcadeRunRecords(records, summary) {
    const baseRecords = createArcadeRunRecords(records);
    if (!summary || typeof summary !== 'object') {
        return baseRecords;
    }
    const summaryScoreModel = String(summary.scoreModel || CURRENT_ARCADE_SCORE_MODEL).trim();
    if (summaryScoreModel !== CURRENT_ARCADE_SCORE_MODEL) {
        return baseRecords;
    }

    const next = createArcadeRunRecords(baseRecords);
    const score = Math.max(0, toSafeNumber(summary.score, 0));
    const peakMultiplier = Math.max(1, toSafeNumber(summary.peakMultiplier, 1));
    const peakCombo = Math.max(0, clampInteger(summary.peakCombo, 0, 99_999, 0));
    const completedSectors = Math.max(0, clampInteger(summary.completedSectors, 0, 99_999, 0));
    const finishedAtIso = typeof summary.finishedAtIso === 'string' ? summary.finishedAtIso : '';
    const replayId = typeof summary.replayId === 'string' ? summary.replayId : '';
    const isBestScore = score >= next.bestScore;

    next.updatedAt = finishedAtIso || new Date().toISOString();
    next.runsPlayed = Math.max(0, next.runsPlayed + 1);
    next.lastScore = score;
    next.lastMultiplier = peakMultiplier;
    next.lastCombo = peakCombo;
    next.lastSector = completedSectors;
    next.lastRunAt = finishedAtIso;

    if (isBestScore) {
        next.bestScore = score;
        next.bestMultiplier = peakMultiplier;
        next.bestCombo = peakCombo;
        next.bestSector = completedSectors;
        next.bestRunAt = finishedAtIso;
        if (replayId) {
            next.replay.bestRunId = replayId;
        }
    } else {
        next.bestMultiplier = Math.max(next.bestMultiplier, peakMultiplier);
        next.bestCombo = Math.max(next.bestCombo, peakCombo);
        next.bestSector = Math.max(next.bestSector, completedSectors);
    }

    if (replayId) {
        next.replay.lastRunId = replayId;
    }

    const summaryBreakdown = createScoreBreakdown(summary.breakdown);
    next.breakdownTotals = createScoreBreakdown({
        precision: next.breakdownTotals.precision + summaryBreakdown.precision,
        time: next.breakdownTotals.time + summaryBreakdown.time,
        checkpoints: next.breakdownTotals.checkpoints + summaryBreakdown.checkpoints,
        completion: next.breakdownTotals.completion + summaryBreakdown.completion,
        base: next.breakdownTotals.base + summaryBreakdown.base,
        survival: next.breakdownTotals.survival + summaryBreakdown.survival,
        kills: next.breakdownTotals.kills + summaryBreakdown.kills,
        cleanSector: next.breakdownTotals.cleanSector + summaryBreakdown.cleanSector,
        risk: next.breakdownTotals.risk + summaryBreakdown.risk,
        penalty: next.breakdownTotals.penalty + summaryBreakdown.penalty,
        total: next.breakdownTotals.total + summaryBreakdown.total,
    });

    if (summary.isDailyChallenge === true && (!summary.runId || next.daily.lastRecordedRunId !== summary.runId)) {
        const dailySeed = Math.max(0, clampInteger(summary.seed, 0, 2_147_483_647, 0));
        const sameDailySeed = next.daily.seed === dailySeed;
        const previousBestScore = sameDailySeed ? next.daily.bestScore : 0;
        next.daily = {
            lastRecordedRunId: String(summary.runId || ''),
            lastSucceeded: summary.succeeded === true,
            lastCompletedSectors: completedSectors,
            seed: dailySeed,
            runsPlayed: sameDailySeed ? next.daily.runsPlayed + 1 : 1,
            bestScore: Math.max(previousBestScore, score),
            bestRunAt: score >= previousBestScore ? finishedAtIso : (sameDailySeed ? next.daily.bestRunAt : finishedAtIso),
            lastScore: score,
            lastRunAt: finishedAtIso,
        };
    }

    return next;
}

export function isArcadeRunFinished(runState) {
    return !!runState && runState.phase === ARCADE_RUN_PHASES.FINISHED;
}

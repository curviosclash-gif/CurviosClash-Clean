import { ARCADE_RUN_PHASES, createArcadeRunRecords, createArcadeRunState } from './ArcadeRunState.js';
import { toSafeNumber, clampNumber, clampInteger } from '../../shared/utils/ArcadeUtils.js';

/** Base score per sector template — harder templates reward more. */
const SECTOR_BASE_SCORES = Object.freeze({
    sector_intro: 180,
    sector_pressure: 250,
    sector_hazard: 320,
    sector_endurance: 400,
});

/** Points per kill, multiplied by the current multiplier. */
const KILL_SCORE_BASE = 35;

/** Fractional combo increments per in-game action (61.2.1). */
const COMBO_ACTION_INCREMENTS = Object.freeze({
    kill: 1,
    collect: 0.5,
    clean_dodge: 0.3,
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
    const total = Math.max(0, toSafeNumber(input.total, base + survival + kills + cleanSector + risk - penalty));
    return {
        base,
        survival,
        kills,
        cleanSector,
        risk,
        penalty,
        total,
    };
}

function resolveMultiplierFromCombo(combo, maxMultiplier) {
    const normalizedCombo = Math.max(0, clampInteger(combo, 0, 99_999, 0));
    const normalizedMax = Math.max(1, clampInteger(maxMultiplier, 1, 99, 8));
    return Math.max(1, Math.min(normalizedMax, 1 + Math.floor(normalizedCombo / 2)));
}

export function applyArcadeComboDecay(scoreState = null, config = null, nowMs = Date.now()) {
    const sourceScore = scoreState && typeof scoreState === 'object' ? scoreState : {};
    const sourceConfig = config && typeof config === 'object' ? config : {};
    const comboWindowMs = Math.max(800, toSafeNumber(sourceConfig.comboWindowMs, 5000));
    const comboDecayPerSecond = Math.max(0, toSafeNumber(sourceConfig.comboDecayPerSecond, 1));
    const maxMultiplier = Math.max(1, clampInteger(sourceConfig.maxMultiplier, 1, 99, 8));

    const currentCombo = Math.max(0, clampInteger(sourceScore.combo, 0, 99_999, 0));
    const lastComboAtMs = Math.max(0, toSafeNumber(sourceScore.lastComboAtMs, 0));
    const now = Math.max(0, toSafeNumber(nowMs, Date.now()));

    if (currentCombo <= 0 || lastComboAtMs <= 0 || comboDecayPerSecond <= 0) {
        return {
            ...sourceScore,
            combo: currentCombo,
            multiplier: resolveMultiplierFromCombo(currentCombo, maxMultiplier),
        };
    }

    const elapsedMs = Math.max(0, now - lastComboAtMs);
    if (elapsedMs <= comboWindowMs) {
        return {
            ...sourceScore,
            combo: currentCombo,
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
    const decayedCombo = Math.max(0, currentCombo - Math.max(0, decayAmount));
    return {
        ...sourceScore,
        combo: decayedCombo,
        multiplier: resolveMultiplierFromCombo(decayedCombo, maxMultiplier),
    };
}

/**
 * Increment combo based on an in-game action (kill, collect, clean_dodge).
 * Uses fractional accumulation — partial increments add up over time.
 * 61.2.1
 */
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
    };
}

export function computeArcadeSectorScoreBreakdown(payload = null, { sectorTemplateId = '' } = {}) {
    const telemetry = normalizeTelemetryPayload(payload);

    // 61.1.1 — Dynamic base score per sector template
    const base = SECTOR_BASE_SCORES[sectorTemplateId] || SECTOR_BASE_SCORES.sector_intro;

    // 61.1.3 — Non-linear survival scoring: exponential curve, last 10s are worth more
    const dur = telemetry.duration;
    const linearPart = dur * 10;
    const lateBonusSec = Math.max(0, dur - Math.max(0, dur - 10));
    const lateBonus = Math.round(lateBonusSec * lateBonusSec * 0.8);
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
        total,
    };
}

export function applyArcadeSectorScore(runState, payload = null, { nowMs = Date.now() } = {}) {
    if (!runState || typeof runState !== 'object' || runState.enabled !== true) {
        return runState;
    }

    const completedSectors = Math.max(0, clampInteger(runState.completedSectors, 0, 99_999, 0));
    const sourceScore = runState.score && typeof runState.score === 'object'
        ? runState.score
        : createArcadeRunState().score;
    const lastScoredSector = Math.max(0, clampInteger(sourceScore.lastScoredSector, 0, 99_999, 0));
    if (completedSectors <= lastScoredSector) {
        return runState;
    }

    const now = Math.max(0, toSafeNumber(nowMs, Date.now()));
    const decayedScore = applyArcadeComboDecay(sourceScore, runState.config, now);
    // 61.6.3: In SUDDEN_DEATH, combo increments by 2 per sector for faster multiplier growth
    const isSuddenDeath = String(runState.phase || '') === ARCADE_RUN_PHASES.SUDDEN_DEATH;
    const comboStep = isSuddenDeath ? 2 : 1;
    const nextCombo = Math.max(1, clampInteger(decayedScore.combo + comboStep, 1, 99_999, 1));
    const nextMultiplier = resolveMultiplierFromCombo(nextCombo, runState?.config?.maxMultiplier);

    // Resolve sector template and modifier bonus (61.1.1, 61.4.2)
    const sectorSeq = Array.isArray(runState.encounterSequence) ? runState.encounterSequence : [];
    const sectorEntry = sectorSeq[Math.max(0, completedSectors - 1)] || null;
    const sectorTemplateId = String(sectorEntry?.templateId || '');
    const scoreBonus = Math.max(0, toSafeNumber(sectorEntry?.scoreBonus, 0));
    const breakdown = computeArcadeSectorScoreBreakdown(payload, { sectorTemplateId });
    // 61.4.2: apply modifier scoreBonus as a multiplier on top of the sector total
    // 61.5.2: apply bossMultiplier for the final boss sector (doubles sector score)
    const bonusMultiplier = 1 + scoreBonus;
    const bossMultiplier = Math.max(1, toSafeNumber(sectorEntry?.bossMultiplier, 1));
    const sectorPoints = Math.round(Math.max(0, breakdown.total) * nextMultiplier * bonusMultiplier * bossMultiplier);

    const nextBreakdown = createScoreBreakdown({
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
            lastScoredSector: completedSectors,
            lastSectorPoints: sectorPoints,
            suddenDeathScore,
            breakdown: nextBreakdown,
        },
        lastSectorSummary: {
            sectorIndex: completedSectors,
            awardedPoints: sectorPoints,
            multiplierApplied: nextMultiplier,
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
        runId: String(runState.runId || ''),
        score: Math.max(0, toSafeNumber(safeScore.total, 0)),
        peakMultiplier: Math.max(1, toSafeNumber(safeScore.peakMultiplier, safeScore.multiplier || 1)),
        peakCombo: Math.max(0, clampInteger(safeScore.peakCombo, 0, 99_999, 0)),
        completedSectors: Math.max(0, clampInteger(runState.completedSectors, 0, 99_999, 0)),
        finishedAtIso: endedAtIso,
        replayId: String(replayId || ''),
        breakdown: createScoreBreakdown(safeScore.breakdown),
        suddenDeathScore: Math.max(0, toSafeNumber(safeScore.suddenDeathScore, 0)),
    };
    return summary;
}

export function mergeArcadeRunRecords(records, summary) {
    const baseRecords = createArcadeRunRecords(records);
    if (!summary || typeof summary !== 'object') {
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
        base: next.breakdownTotals.base + summaryBreakdown.base,
        survival: next.breakdownTotals.survival + summaryBreakdown.survival,
        cleanSector: next.breakdownTotals.cleanSector + summaryBreakdown.cleanSector,
        risk: next.breakdownTotals.risk + summaryBreakdown.risk,
        penalty: next.breakdownTotals.penalty + summaryBreakdown.penalty,
        total: next.breakdownTotals.total + summaryBreakdown.total,
    });

    return next;
}

export function isArcadeRunFinished(runState) {
    return !!runState && runState.phase === ARCADE_RUN_PHASES.FINISHED;
}

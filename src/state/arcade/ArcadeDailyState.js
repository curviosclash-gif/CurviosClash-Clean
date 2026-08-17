import { computeDailySeed } from '../../shared/utils/ArcadeUtils.js';
import { mergeArcadeRunRecords } from './ArcadeScoreOps.js';

function toNonNegativeInteger(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
}

function toNonNegativeNumber(value) {
    return Math.max(0, Number(value) || 0);
}

function normalizeDailyRecord(records = null) {
    const daily = records?.daily && typeof records.daily === 'object' ? records.daily : {};
    return {
        seed: toNonNegativeInteger(daily.seed),
        runsPlayed: toNonNegativeInteger(daily.runsPlayed),
        bestScore: toNonNegativeNumber(daily.bestScore),
        bestRunAt: typeof daily.bestRunAt === 'string' ? daily.bestRunAt : '',
        lastScore: toNonNegativeNumber(daily.lastScore),
        lastRunAt: typeof daily.lastRunAt === 'string' ? daily.lastRunAt : '',
    };
}

export function createArcadeDailyProjection(records = null, date = null) {
    const seed = computeDailySeed(date);
    const daily = normalizeDailyRecord(records);
    const playedToday = daily.seed === seed && daily.runsPlayed > 0;
    return {
        seed,
        status: playedToday ? 'played' : 'unplayed',
        playedToday,
        runsPlayed: playedToday ? daily.runsPlayed : 0,
        bestScore: playedToday ? daily.bestScore : 0,
        bestRunAt: playedToday ? daily.bestRunAt : '',
        lastScore: playedToday ? daily.lastScore : 0,
        lastRunAt: playedToday ? daily.lastRunAt : '',
    };
}

export function createArcadeDailyRunResult({
    previousRecords = null,
    completedRecords = null,
    summary = null,
} = {}) {
    if (summary?.isDailyChallenge !== true) return null;

    const seed = toNonNegativeInteger(summary.seed);
    const score = toNonNegativeNumber(summary.score);
    const previousDaily = normalizeDailyRecord(previousRecords);
    const completedDaily = normalizeDailyRecord(completedRecords);
    const hadPreviousAttempt = previousDaily.seed === seed && previousDaily.runsPlayed > 0;
    const previousBestScore = hadPreviousAttempt ? previousDaily.bestScore : 0;
    const completedForSeed = completedDaily.seed === seed;

    return {
        seed,
        attempt: completedForSeed ? completedDaily.runsPlayed : (hadPreviousAttempt ? previousDaily.runsPlayed + 1 : 1),
        score,
        previousBestScore,
        bestScore: completedForSeed ? completedDaily.bestScore : Math.max(previousBestScore, score),
        isNewBest: !hadPreviousAttempt || score > previousBestScore,
        tiedBest: hadPreviousAttempt && score === previousBestScore,
    };
}

export function mergeArcadeDailyRunRecords(previousRecords = null, summary = null) {
    const records = mergeArcadeRunRecords(previousRecords, summary);
    return {
        records,
        dailyResult: createArcadeDailyRunResult({ previousRecords, completedRecords: records, summary }),
    };
}

import { clampInteger, toSafeNumber } from '../../shared/utils/ArcadeUtils.js';

export function normalizeArcadeDailyRulesVersion(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizePartition(source = null) {
    const data = source && typeof source === 'object' && !Array.isArray(source) ? { ...source } : {};
    delete data.history;
    return {
        ...data,
        rulesVersion: normalizeArcadeDailyRulesVersion(data.rulesVersion),
        lastRecordedRunId: typeof data.lastRecordedRunId === 'string' ? data.lastRecordedRunId : '',
        lastSucceeded: data.lastSucceeded === true,
        lastCompletedSectors: Math.max(0, toSafeNumber(data.lastCompletedSectors, 0)),
        seed: clampInteger(data.seed, 0, 2_147_483_647, 0),
        runsPlayed: clampInteger(data.runsPlayed, 0, 999_999, 0),
        bestScore: Math.max(0, toSafeNumber(data.bestScore, 0)),
        bestRunAt: typeof data.bestRunAt === 'string' ? data.bestRunAt : '',
        lastScore: Math.max(0, toSafeNumber(data.lastScore, 0)),
        lastRunAt: typeof data.lastRunAt === 'string' ? data.lastRunAt : '',
    };
}

function samePartition(record, seed, rulesVersion) {
    return Number(record?.seed) === seed && normalizeArcadeDailyRulesVersion(record?.rulesVersion) === rulesVersion;
}

export function normalizeArcadeDailyRecord(source = null) {
    return {
        ...normalizePartition(source),
        history: Array.isArray(source?.history)
            ? source.history.map(normalizePartition).filter(record => record.seed > 0) : [],
    };
}

/** Missing versions are legacy data, never the current equipment rules. */
export function findArcadeDailyRecord(source, seed, rulesVersion) {
    const version = normalizeArcadeDailyRulesVersion(rulesVersion);
    const record = samePartition(source, seed, version) ? source
        : Array.isArray(source?.history) ? source.history.find(entry => samePartition(entry, seed, version)) : null;
    return record ? normalizePartition(record) : null;
}

/** Preserve displaced rules snapshots; ordinary day rollover keeps its previous single-day policy. */
export function mergeArcadeDailyRecord(source, summary) {
    const daily = normalizeArcadeDailyRecord(source);
    const seed = clampInteger(summary.seed, 0, 2_147_483_647, 0);
    const rulesVersion = normalizeArcadeDailyRulesVersion(summary.dailyRulesVersion);
    const previous = findArcadeDailyRecord(daily, seed, rulesVersion);
    const runId = String(summary.runId || '');
    if (runId && previous?.lastRecordedRunId === runId) return daily;
    let history = daily.history.filter(entry => !samePartition(entry, seed, rulesVersion));
    if (daily.seed > 0 && daily.rulesVersion !== rulesVersion) {
        history = history.filter(entry => !samePartition(entry, daily.seed, daily.rulesVersion));
        history.push(normalizePartition(daily));
    }
    const score = Math.max(0, toSafeNumber(summary.score, 0));
    const previousBestScore = previous?.bestScore || 0;
    const finishedAt = typeof summary.finishedAtIso === 'string' ? summary.finishedAtIso : '';
    return {
        ...(previous || {}), rulesVersion, seed, history,
        lastRecordedRunId: runId,
        lastSucceeded: summary.succeeded === true,
        lastCompletedSectors: Math.max(0, toSafeNumber(summary.completedSectors, 0)),
        runsPlayed: (previous?.runsPlayed || 0) + 1,
        bestScore: Math.max(previousBestScore, score),
        bestRunAt: score >= previousBestScore ? finishedAt : previous?.bestRunAt || finishedAt,
        lastScore: score, lastRunAt: finishedAt,
    };
}

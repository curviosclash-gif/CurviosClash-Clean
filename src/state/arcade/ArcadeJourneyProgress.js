import { emptyProgress, isRecord, safeRead, validateLeaderboardRequest, leaderboardKey, compareRows, validBoardRows } from '../../shared/contracts/ArcadeJourneyProgressContract.js';
export { loadArcadeJourneyProgress, getArcadeJourneyLeaderboard } from '../../shared/contracts/ArcadeJourneyProgressContract.js';
const TIERS = new Set(['normal', 'hard', 'nightmare']);
const STAGE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
import { ARCADE_JOURNEY_STORAGE_KEY } from '../../shared/contracts/ArcadeJourneyContract.js';
export { ARCADE_JOURNEY_STORAGE_KEY, ARCADE_JOURNEY_SCHEMA, getArcadeJourneyStageStars } from '../../shared/contracts/ArcadeJourneyContract.js';

function hasRunReceipt(progress, runId) {
    for (const stage of Object.values(progress.stages)) {
        if (!isRecord(stage) || !isRecord(stage.medals)) continue;
        for (const entry of Object.values(stage.medals)) {
            if (isRecord(entry) && entry.runId === runId) return true;
        }
    }
    if (isRecord(progress.boards)) {
        for (const rows of Object.values(progress.boards)) {
            if (!Array.isArray(rows)) continue;
            if (rows.some((entry) => isRecord(entry) && entry.runId === runId)) return true;
        }
    }
    return false;
}

function isSaveSuccess(result) {
    return result === true || result?.ok === true || result?.success === true;
}

function persistProgress(store, previous, next, extra = {}) {
    try {
        if (!isSaveSuccess(store?.saveJsonRecord?.(ARCADE_JOURNEY_STORAGE_KEY, next))) {
            return { status: 'unavailable', progress: previous, ...extra };
        }
        return { status: 'saved', progress: next, ...extra };
    } catch {
        return { status: 'unavailable', progress: previous, ...extra };
    }
}

function mergeMedal(progress, { stageId, tierId, medal, runId }) {
    const existingStage = progress.stages[stageId];
    if (existingStage !== undefined && !isRecord(existingStage)) return { status: 'unavailable' };
    const existingMedals = existingStage?.medals;
    if (existingMedals !== undefined && !isRecord(existingMedals)) return { status: 'unavailable' };
    const prior = existingMedals?.[tierId];
    if (prior !== undefined && (!isRecord(prior)
        || !Number.isInteger(prior.medal) || prior.medal < 1 || prior.medal > 3
        || typeof prior.runId !== 'string' || !prior.runId.trim())) {
        return { status: 'unavailable' };
    }
    if (hasRunReceipt(progress, runId) || (prior && medal <= prior.medal)) {
        return { status: 'unchanged', progress };
    }
    return {
        status: 'changed',
        progress: {
            ...progress,
            stages: {
                ...progress.stages,
                [stageId]: {
                    ...(existingStage || {}),
                    medals: {
                        ...(existingMedals || {}),
                        [tierId]: { ...(prior || {}), medal, runId },
                    },
                },
            },
        },
    };
}

function mergeBoard(progress, { stage, stageId, tierId, playerCount, value, medal, runId }) {
    if (progress.boards !== undefined && !isRecord(progress.boards)) return { status: 'unavailable' };
    const key = leaderboardKey(stageId, tierId, playerCount);
    const boards = progress.boards || {};
    const oldRows = boards[key];
    if (oldRows !== undefined && !validBoardRows(oldRows, playerCount, stage.metric)) return { status: 'unavailable' };
    const rows = oldRows || [];
    const existingRank = rows.findIndex((row) => row.runId === runId);
    if (existingRank >= 0) {
        return { status: 'unchanged', rows, rank: existingRank + 1, count: rows.length };
    }
    const candidate = { runId, value, medal, playerCount };
    const nextRows = [...rows, candidate].sort((left, right) => compareRows(stage.metric, left, right)).slice(0, 10);
    const rank = nextRows.findIndex((row) => row.runId === runId);
    if (rank < 0) return { status: 'unchanged', rows, rank: null, count: rows.length };
    return { status: 'changed', rows: nextRows, rank: rank + 1, count: nextRows.length };
}

/** @param {{stageId?: string, tierId?: string, medal?: number, runId?: string}} [award] */
export function recordArcadeJourneyMedal(store, award = {}) {
    const { stageId, tierId, medal, runId } = award;
    const id = String(stageId || '').trim();
    const tier = String(tierId || '').trim();
    const receipt = String(runId || '').trim();
    if (!STAGE_ID_PATTERN.test(id) || !TIERS.has(tier)
        || !Number.isInteger(medal) || medal < 1 || medal > 3
        || !receipt) {
        return { status: 'invalid', progress: emptyProgress() };
    }

    const loaded = safeRead(store);
    if (loaded.status === 'unavailable') return loaded;
    const previous = loaded.progress;
    const merged = mergeMedal(previous, { stageId: id, tierId: tier, medal, runId: receipt });
    if (merged.status === 'unavailable') return { status: 'unavailable', progress: previous };
    if (merged.status === 'unchanged') return { status: 'unchanged', progress: previous };
    return persistProgress(store, previous, merged.progress);
}

/** @param {{stageId?: string, tierId?: string, medal?: number, runId?: string, value?: number, playerCount?: number}} [result] */
export function recordArcadeJourneyResult(store, result = {}) {
    const { stageId, tierId, medal, runId, value, playerCount } = result;
    const id = String(stageId || '').trim();
    const tier = String(tierId || '').trim();
    const receipt = String(runId || '').trim();
    const request = validateLeaderboardRequest(id, tier, playerCount, value);
    if (!request || !Number.isInteger(medal) || medal < 0 || medal > 3 || !receipt) {
        return { status: 'invalid', progress: emptyProgress(), rank: null, count: 0 };
    }
    const loaded = safeRead(store);
    if (loaded.status === 'unavailable') return { ...loaded, rank: null, count: 0 };
    const previous = loaded.progress;
    const boards = previous.boards;
    if (boards !== undefined && !isRecord(boards)) {
        return { status: 'unavailable', progress: previous, rank: null, count: 0 };
    }
    if (hasRunReceipt(previous, receipt)) return { status: 'unchanged', progress: previous, rank: null, count: 0 };

    let next = previous;
    if (medal > 0) {
        const medalMerge = mergeMedal(previous, { stageId: id, tierId: tier, medal, runId: receipt });
        if (medalMerge.status === 'unavailable') {
            return { status: 'unavailable', progress: previous, rank: null, count: 0 };
        }
        next = medalMerge.progress;
    }
    const boardMerge = mergeBoard(next, { ...request, value, medal, runId: receipt });
    if (boardMerge.status === 'unavailable') {
        return { status: 'unavailable', progress: previous, rank: null, count: 0 };
    }
    if (boardMerge.status === 'changed') {
        next = {
            ...next,
            boards: { ...(next.boards || {}), [leaderboardKey(id, tier, playerCount)]: boardMerge.rows },
        };
    }
    if (next === previous) {
        return { status: 'unchanged', progress: previous, rank: boardMerge.rank, count: boardMerge.count };
    }
    return persistProgress(store, previous, next, { rank: boardMerge.rank, count: boardMerge.count });
}

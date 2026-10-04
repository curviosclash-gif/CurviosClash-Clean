import { resolveArcadeLevelRange } from './ArcadeHangarRulesContract.js';

export const ARCADE_RANKED_STORAGE_KEY = 'cuviosclash.arcade-ranked-leaderboard.v1';
export const ARCADE_RANKED_VERSION = 'arcade-ranked-leaderboard.v1';
const RUNS = new Set(['gauntlet', 'endless_parcours', 'arena_waves', 'five_portals']);

export function resolveArcadeRankKey(context) {
    if (!context?.ranked || !RUNS.has(context.runType)) return '';
    const range = resolveArcadeLevelRange(context.vehicleLevel);
    return `${context.runType}:${context.tierId}:${range.min}-${range.max}`;
}

export function resolveArcadeParcoursRankKey(routeId, context) {
    const route = String(routeId || '').trim();
    if (!context?.ranked) return route;
    const range = resolveArcadeLevelRange(context.vehicleLevel);
    return `${route}:level:${range.min}-${range.max}`;
}

export function normalizeArcadeRankedLeaderboard(value) {
    const input = value?.schemaVersion === ARCADE_RANKED_VERSION ? value : {};
    const boards = Object.create(null);
    for (const [key, rows] of Object.entries(input.boards || {})) {
        if (!Array.isArray(rows)) continue;
        boards[key] = rows.filter((row) => row && typeof row.runId === 'string' && row.runId
            && Number.isFinite(row.score) && row.score >= 0 && Number.isFinite(row.vehicleLevel) && row.vehicleLevel >= 1)
            .slice(0, 10).map((row) => ({ ...row }));
    }
    return { schemaVersion: ARCADE_RANKED_VERSION, boards };
}

export function insertArcadeRankedResult(leaderboard, context, result, nowMs = Date.now()) {
    const current = normalizeArcadeRankedLeaderboard(leaderboard);
    const key = resolveArcadeRankKey(context);
    if (!key || !context.runId || result?.aborted === true) return { leaderboard: current, rank: null, key };
    const score = Number(context.runType === 'five_portals' ? result?.totalMs : result?.score?.total ?? result?.score ?? result?.total);
    if (!Number.isFinite(score) || score < 0 || (context.runType === 'five_portals' && !(result?.succeeded === true && score > 0))) {
        return { leaderboard: current, rank: null, key };
    }
    const entry = { runId: context.runId, vehicleId: context.vehicleId, vehicleLevel: context.vehicleLevel,
        tierId: context.tierId, score, completedWaves: Number(result?.lastCompletedWave) || 0,
        completedSectors: Number(result?.completedSectors) || 0, date: new Date(nowMs).toISOString() };
    const rows = (current.boards[key] || []).filter((row) => row.runId !== entry.runId);
    rows.push(entry);
    const direction = context.runType === 'five_portals' ? 1 : -1;
    rows.sort((a, b) => direction * (a.score - b.score) || a.date.localeCompare(b.date));
    const kept = rows.slice(0, 10);
    const position = kept.findIndex((row) => row.runId === entry.runId);
    return { leaderboard: { ...current, boards: { ...current.boards, [key]: kept } }, key, rank: position < 0 ? null : position + 1 };
}

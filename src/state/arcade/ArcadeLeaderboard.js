// ─── Arcade Parcours Leaderboard: Top-10 per Route, Segment Splits ───

export const LEADERBOARD_STORAGE_KEY = 'cuviosclash.parcours-leaderboard.v1';
const MAX_ENTRIES_PER_ROUTE = 10;

function isPersistenceSuccess(result) {
    return result === undefined || result === true || result?.success === true;
}

function warnPersistenceFailure(contextLabel, result) {
    if (isPersistenceSuccess(result)) return;
    if (typeof console === 'undefined' || typeof console.warn !== 'function') return;
    console.warn(`[ArcadeLeaderboard] ${String(contextLabel || 'save')} failed`, {
        reason: String(result?.reason || ''),
        metadata: result?.metadata && typeof result.metadata === 'object'
            ? { ...result.metadata }
            : null,
    });
}

function toSafeMs(value) {
    const n = Math.round(Number(value) || 0);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function createLeaderboardEntry({
    totalTimeMs = 0,
    penaltyTimeMs = 0,
    segmentSplitsMs = [],
    vehicleId = '',
    date = '',
    ghostClip = null,
} = {}) {
    return {
        totalTimeMs: toSafeMs(totalTimeMs),
        penaltyTimeMs: toSafeMs(penaltyTimeMs),
        segmentSplitsMs: Array.isArray(segmentSplitsMs) ? segmentSplitsMs.map(toSafeMs) : [],
        vehicleId: String(vehicleId || ''),
        date: typeof date === 'string' && date ? date : new Date().toISOString(),
        ghostClip: ghostClip && typeof ghostClip === 'object' ? ghostClip : null,
    };
}

function normalizeLeaderboard(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const result = {};
    for (const routeId of Object.keys(raw)) {
        const entries = raw[routeId];
        if (!Array.isArray(entries)) continue;
        result[routeId] = entries.slice(0, MAX_ENTRIES_PER_ROUTE).map((e) => createLeaderboardEntry(e));
    }
    return result;
}

export function loadLeaderboard(store) {
    if (!store || typeof store.loadJsonRecord !== 'function') return {};
    const raw = store.loadJsonRecord(LEADERBOARD_STORAGE_KEY, {});
    return normalizeLeaderboard(raw);
}

export function saveLeaderboard(store, lb) {
    if (!store || typeof store.saveJsonRecord !== 'function') return;
    const saveResult = store.saveJsonRecord(LEADERBOARD_STORAGE_KEY, lb || {});
    warnPersistenceFailure('saveLeaderboard', saveResult);
}

export function insertLeaderboardEntry(lb, routeId, entry) {
    if (!routeId || typeof routeId !== 'string') return lb || {};
    const safe = createLeaderboardEntry(entry);
    const existing = Array.isArray((lb || {})[routeId]) ? [...lb[routeId]] : [];
    existing.push(safe);
    existing.sort((a, b) => a.totalTimeMs - b.totalTimeMs);
    return {
        ...(lb || {}),
        [routeId]: existing.slice(0, MAX_ENTRIES_PER_ROUTE),
    };
}

export function getBestEntry(lb, routeId) {
    if (!lb || !routeId) return null;
    const entries = lb[routeId];
    return Array.isArray(entries) && entries.length > 0 ? entries[0] : null;
}

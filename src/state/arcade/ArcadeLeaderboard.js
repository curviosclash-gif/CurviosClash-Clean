// ─── Arcade Parcours Leaderboard: Top-10 per Route, Segment Splits ───

export const LEADERBOARD_STORAGE_KEY = 'cuviosclash.parcours-leaderboard.v1';
const MAX_ENTRIES_PER_ROUTE = 10;
const MAX_SEGMENT_SPLITS = 256;

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

function toNonNegativeMs(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : 0;
}

function toPositiveMs(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0;
}

function normalizeDate(value, fallbackToNow = true) {
    if (typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value))) {
        return value;
    }
    return fallbackToNow ? new Date().toISOString() : '';
}

function compareLeaderboardEntries(left, right) {
    const timeDelta = left.totalTimeMs - right.totalTimeMs;
    if (timeDelta !== 0) return timeDelta;
    const leftDate = Date.parse(left.date);
    const rightDate = Date.parse(right.date);
    return Number.isFinite(leftDate) && Number.isFinite(rightDate) ? leftDate - rightDate : 0;
}

export function createLeaderboardEntry(source = {}, { fallbackDate = true } = {}) {
    const input = source && typeof source === 'object' ? source : {};
    const {
        totalTimeMs = 0,
        penaltyTimeMs = 0,
        segmentSplitsMs = [],
        vehicleId = '',
        date = '',
        ghostClip = null,
    } = input;
    const normalizedTotalTimeMs = toPositiveMs(totalTimeMs);
    if (normalizedTotalTimeMs <= 0) return null;
    return {
        totalTimeMs: normalizedTotalTimeMs,
        penaltyTimeMs: toNonNegativeMs(penaltyTimeMs),
        segmentSplitsMs: Array.isArray(segmentSplitsMs)
            ? segmentSplitsMs.slice(0, MAX_SEGMENT_SPLITS).map(toNonNegativeMs)
            : [],
        vehicleId: String(vehicleId || ''),
        date: normalizeDate(date, fallbackDate),
        ghostClip: ghostClip && typeof ghostClip === 'object' ? ghostClip : null,
    };
}

function normalizeLeaderboard(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const result = {};
    for (const routeId of Object.keys(raw)) {
        const entries = raw[routeId];
        if (!Array.isArray(entries)) continue;
        const normalizedRouteId = String(routeId || '').trim();
        if (!normalizedRouteId) continue;
        result[normalizedRouteId] = entries
            .map((entry) => createLeaderboardEntry(entry, { fallbackDate: false }))
            .filter(Boolean)
            .sort(compareLeaderboardEntries)
            .slice(0, MAX_ENTRIES_PER_ROUTE);
    }
    return result;
}

export function loadLeaderboard(store) {
    if (!store || typeof store.loadJsonRecord !== 'function') return {};
    const raw = store.loadJsonRecord(LEADERBOARD_STORAGE_KEY, {});
    return normalizeLeaderboard(raw);
}

export function saveLeaderboard(store, lb) {
    if (!store || typeof store.saveJsonRecord !== 'function') return false;
    const saveResult = store.saveJsonRecord(LEADERBOARD_STORAGE_KEY, normalizeLeaderboard(lb));
    warnPersistenceFailure('saveLeaderboard', saveResult);
    return saveResult;
}

export function insertLeaderboardEntry(lb, routeId, entry) {
    const normalizedRouteId = typeof routeId === 'string' ? routeId.trim() : '';
    if (!normalizedRouteId) return lb || {};
    const safe = createLeaderboardEntry(entry);
    if (!safe) return lb || {};
    const existing = Array.isArray((lb || {})[normalizedRouteId])
        ? (lb[normalizedRouteId].map((candidate) => createLeaderboardEntry(candidate, { fallbackDate: false })).filter(Boolean))
        : [];
    existing.push(safe);
    existing.sort(compareLeaderboardEntries);
    return {
        ...(lb || {}),
        [normalizedRouteId]: existing.slice(0, MAX_ENTRIES_PER_ROUTE),
    };
}

export function getBestEntry(lb, routeId) {
    if (!lb || !routeId) return null;
    const entries = lb[routeId];
    return Array.isArray(entries) && entries.length > 0 ? entries[0] : null;
}

export function createLeaderboardProjection(lb) {
    const normalized = normalizeLeaderboard(lb);
    return Object.fromEntries(Object.entries(normalized).map(([routeId, entries]) => [
        routeId,
        entries.map(({ ghostClip: _ghostClip, ...entry }) => ({ ...entry })),
    ]));
}

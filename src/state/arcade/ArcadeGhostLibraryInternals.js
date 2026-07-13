import { validateGhostClip } from '../../shared/contracts/GhostClipContract.js';

export const ARCADE_GHOST_LIBRARY_STORAGE_KEY = 'cuviosclash.arcade-ghost-library.v1';
export const ARCADE_GHOST_LIBRARY_SCHEMA_VERSION = 'arcade-ghost-library.v2';
export const GHOST_LIBRARY_UPDATED_AT_FALLBACK_ISO = '1970-01-01T00:00:00.000Z';
const GHOST_LIBRARY_META_ALIAS_INDEX = '__ghostAliasIndex';
const GHOST_LIBRARY_META_LAST_TOUCH_SEQ = '__ghostLastTouchSeq';
const GHOST_LIBRARY_META_SCHEMA_VERSION = '__ghostSchemaVersion';

export const DEFAULT_GHOST_LIBRARY_BUDGET = Object.freeze({
    maxRoutes: 64,
    maxFramesPerRoute: 0,
    maxBytes: 0,
    canonicalizeAliases: true,
});

export function isPersistenceSuccess(result) {
    return result === undefined || result === true || result?.success === true;
}

export function warnPersistenceFailure(contextLabel, result) {
    if (isPersistenceSuccess(result)) return;
    if (typeof console === 'undefined' || typeof console.warn !== 'function') return;
    console.warn(`[ArcadeGhostLibrary] ${String(contextLabel || 'save')} failed`, {
        reason: String(result?.reason || ''),
        metadata: result?.metadata && typeof result.metadata === 'object'
            ? { ...result.metadata }
            : null,
    });
}

export function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

export function toSafeDurationMs(value) {
    const numeric = Math.round(Number(value));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function cloneObject(value) {
    return JSON.parse(JSON.stringify(value));
}

export function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function toSafePositiveInteger(value, fallback = 0) {
    const numeric = Math.trunc(Number(value));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function toSafeNonNegativeInteger(value, fallback = 0) {
    const numeric = Math.trunc(Number(value));
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

export function deriveDurationMsFromGhostClip(ghostClip) {
    const sourceDurationMs = toSafeDurationMs(Number(ghostClip?.sourceDuration) * 1000);
    if (sourceDurationMs > 0) return sourceDurationMs;
    const displayDurationMs = toSafeDurationMs(Number(ghostClip?.displayDuration) * 1000);
    if (displayDurationMs > 0) return displayDurationMs;
    return 0;
}

export function normalizeGhostLibraryBudgetOptions(options = null) {
    const input = isPlainObject(options) ? options : {};
    return {
        maxRoutes: toSafePositiveInteger(input.maxRoutes, DEFAULT_GHOST_LIBRARY_BUDGET.maxRoutes),
        maxFramesPerRoute: toSafePositiveInteger(input.maxFramesPerRoute, 0),
        maxBytes: toSafePositiveInteger(input.maxBytes, 0),
        canonicalizeAliases: input.canonicalizeAliases !== false,
    };
}

export function resolveGhostClipNormalizationOptions(budgetOptions) {
    return budgetOptions.maxFramesPerRoute > 0
        ? { maxFrames: budgetOptions.maxFramesPerRoute }
        : {};
}

export function normalizeUpdatedAtIso(value, fallbackIso = GHOST_LIBRARY_UPDATED_AT_FALLBACK_ISO) {
    const raw = normalizeString(value);
    if (!raw) return fallbackIso;
    const parsedMs = Date.parse(raw);
    return Number.isFinite(parsedMs) ? new Date(parsedMs).toISOString() : fallbackIso;
}

export function toUpdatedAtMs(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

export function compareByEvictionPriority(left, right) {
    const byUpdatedAt = left.updatedAtMs - right.updatedAtMs;
    if (byUpdatedAt !== 0) return byUpdatedAt;
    const byLastTouchSeq = left.lastTouchSeq - right.lastTouchSeq;
    if (byLastTouchSeq !== 0) return byLastTouchSeq;
    return left.routeId.localeCompare(right.routeId);
}

export function compareCanonicalWinner(left, right) {
    const leftDuration = toSafeDurationMs(left?.durationMs);
    const rightDuration = toSafeDurationMs(right?.durationMs);
    if (leftDuration !== rightDuration) return rightDuration - leftDuration;
    const byUpdatedAt = toUpdatedAtMs(right?.updatedAt) - toUpdatedAtMs(left?.updatedAt);
    if (byUpdatedAt !== 0) return byUpdatedAt;
    const bySeq = toSafeNonNegativeInteger(right?.lastTouchSeq) - toSafeNonNegativeInteger(left?.lastTouchSeq);
    if (bySeq !== 0) return bySeq;
    return String(left?.canonicalRouteId || left?.routeId || '').localeCompare(
        String(right?.canonicalRouteId || right?.routeId || '')
    );
}

export function estimateSerializedSize(value) {
    try {
        return JSON.stringify(value).length;
    } catch {
        return Number.POSITIVE_INFINITY;
    }
}

export function createTelemetryDelta() {
    return {
        evictedRoutes: 0,
        trimmedFrames: 0,
        migrationWrites: 0,
        droppedByByteBudget: 0,
    };
}

export function mergeTelemetryDelta(intoDelta, delta) {
    if (!isPlainObject(intoDelta) || !isPlainObject(delta)) return intoDelta;
    intoDelta.evictedRoutes += toSafeNonNegativeInteger(delta.evictedRoutes, 0);
    intoDelta.trimmedFrames += toSafeNonNegativeInteger(delta.trimmedFrames, 0);
    intoDelta.migrationWrites += toSafeNonNegativeInteger(delta.migrationWrites, 0);
    intoDelta.droppedByByteBudget += toSafeNonNegativeInteger(delta.droppedByByteBudget, 0);
    return intoDelta;
}

export function normalizeRouteAliases(routeAliases, canonicalRouteId) {
    if (!Array.isArray(routeAliases)) return [];
    const safeCanonicalRouteId = normalizeString(canonicalRouteId);
    const seen = new Set();
    const normalized = [];
    for (let i = 0; i < routeAliases.length; i += 1) {
        const alias = normalizeString(routeAliases[i]);
        if (!alias || alias === safeCanonicalRouteId || seen.has(alias)) continue;
        seen.add(alias);
        normalized.push(alias);
    }
    return normalized;
}

export function cloneAliasIndex(aliasIndex) {
    const safeAliasIndex = isPlainObject(aliasIndex) ? aliasIndex : {};
    return { ...safeAliasIndex };
}

export function attachGhostLibraryMeta(ghostLibrary, {
    schemaVersion = ARCADE_GHOST_LIBRARY_SCHEMA_VERSION,
    lastTouchSeq = 0,
    aliasIndex = null,
} = {}) {
    if (!isPlainObject(ghostLibrary)) return {};
    Object.defineProperty(ghostLibrary, GHOST_LIBRARY_META_SCHEMA_VERSION, {
        value: normalizeString(schemaVersion, ARCADE_GHOST_LIBRARY_SCHEMA_VERSION),
        writable: true,
        enumerable: false,
        configurable: true,
    });
    Object.defineProperty(ghostLibrary, GHOST_LIBRARY_META_LAST_TOUCH_SEQ, {
        value: toSafeNonNegativeInteger(lastTouchSeq, 0),
        writable: true,
        enumerable: false,
        configurable: true,
    });
    Object.defineProperty(ghostLibrary, GHOST_LIBRARY_META_ALIAS_INDEX, {
        value: cloneAliasIndex(aliasIndex),
        writable: true,
        enumerable: false,
        configurable: true,
    });
    return ghostLibrary;
}

export function createEmptyGhostLibrary() {
    return attachGhostLibraryMeta({}, {
        schemaVersion: ARCADE_GHOST_LIBRARY_SCHEMA_VERSION,
        lastTouchSeq: 0,
        aliasIndex: {},
    });
}

export function getGhostLibraryMeta(ghostLibrary) {
    const safeLibrary = isPlainObject(ghostLibrary) ? ghostLibrary : {};
    return {
        schemaVersion: normalizeString(
            safeLibrary[GHOST_LIBRARY_META_SCHEMA_VERSION],
            ARCADE_GHOST_LIBRARY_SCHEMA_VERSION
        ),
        lastTouchSeq: toSafeNonNegativeInteger(safeLibrary[GHOST_LIBRARY_META_LAST_TOUCH_SEQ], 0),
        aliasIndex: cloneAliasIndex(safeLibrary[GHOST_LIBRARY_META_ALIAS_INDEX]),
    };
}

export function cloneGhostLibraryContainer(ghostLibrary) {
    const safeLibrary = isPlainObject(ghostLibrary) ? ghostLibrary : {};
    const copy = { ...safeLibrary };
    return attachGhostLibraryMeta(copy, getGhostLibraryMeta(safeLibrary));
}

export function resolveCanonicalRouteId(ghostLibrary, routeId, budgetOptions = DEFAULT_GHOST_LIBRARY_BUDGET) {
    const safeRouteId = normalizeString(routeId);
    if (!safeRouteId) return '';
    const safeLibrary = isPlainObject(ghostLibrary) ? ghostLibrary : {};
    if (budgetOptions.canonicalizeAliases !== false) {
        const aliasIndex = getGhostLibraryMeta(safeLibrary).aliasIndex;
        const aliasedCanonical = normalizeString(aliasIndex[safeRouteId]);
        if (aliasedCanonical && isPlainObject(safeLibrary[aliasedCanonical])) {
            return aliasedCanonical;
        }
    }
    return isPlainObject(safeLibrary[safeRouteId]) ? safeRouteId : '';
}

export function clearAliasMappingForCanonical(aliasIndex, canonicalRouteId) {
    const safeCanonical = normalizeString(canonicalRouteId);
    if (!safeCanonical) return;
    const keys = Object.keys(aliasIndex);
    for (let i = 0; i < keys.length; i += 1) {
        if (normalizeString(aliasIndex[keys[i]]) === safeCanonical) {
            delete aliasIndex[keys[i]];
        }
    }
}

export function writeAliasMappings(aliasIndex, canonicalRouteId, aliases) {
    const safeCanonical = normalizeString(canonicalRouteId);
    if (!safeCanonical) return;
    aliasIndex[safeCanonical] = safeCanonical;
    for (let i = 0; i < aliases.length; i += 1) {
        aliasIndex[aliases[i]] = safeCanonical;
    }
}

export function serializeGhostLibraryForStorage(ghostLibrary, budgetOptions = DEFAULT_GHOST_LIBRARY_BUDGET) {
    const safeLibrary = isPlainObject(ghostLibrary) ? ghostLibrary : {};
    const meta = getGhostLibraryMeta(safeLibrary);
    const safeAliasIndex = {};
    if (budgetOptions.canonicalizeAliases !== false) {
        const aliases = Object.keys(meta.aliasIndex);
        for (let i = 0; i < aliases.length; i += 1) {
            const alias = normalizeString(aliases[i]);
            const canonical = normalizeString(meta.aliasIndex[alias]);
            if (!alias || !canonical || !isPlainObject(safeLibrary[canonical])) continue;
            safeAliasIndex[alias] = canonical;
        }
    }
    return {
        schemaVersion: ARCADE_GHOST_LIBRARY_SCHEMA_VERSION,
        lastTouchSeq: toSafeNonNegativeInteger(meta.lastTouchSeq, 0),
        aliasIndex: safeAliasIndex,
        routes: { ...safeLibrary },
    };
}

export function createGhostLibraryEntry(
    canonicalRouteId,
    source = null,
    budgetOptions = DEFAULT_GHOST_LIBRARY_BUDGET,
    { defaultLastTouchSeq = 0, forcedRouteAliases = null } = {}
) {
    const safeCanonicalRouteId = normalizeString(canonicalRouteId);
    if (!safeCanonicalRouteId) return { entry: null, telemetryDelta: createTelemetryDelta() };
    const input = isPlainObject(source) ? source : {};
    const clipValidation = validateGhostClip(
        input.longestGhostClip ?? input.ghostClip ?? null,
        resolveGhostClipNormalizationOptions(budgetOptions)
    );
    if (!clipValidation.valid || !clipValidation.clip) {
        return { entry: null, telemetryDelta: createTelemetryDelta() };
    }
    const explicitDurationMs = toSafeDurationMs(input.durationMs);
    const derivedDurationMs = deriveDurationMsFromGhostClip(clipValidation.clip);
    const durationMs = Math.max(explicitDurationMs, derivedDurationMs);
    if (durationMs <= 0) {
        return { entry: null, telemetryDelta: createTelemetryDelta() };
    }
    const entry = {
        routeId: safeCanonicalRouteId,
        canonicalRouteId: safeCanonicalRouteId,
        routeAliases: normalizeRouteAliases(
            forcedRouteAliases || input.routeAliases,
            safeCanonicalRouteId
        ),
        longestGhostClip: clipValidation.clip,
        durationMs,
        updatedAt: normalizeUpdatedAtIso(input.updatedAt),
        lastTouchSeq: toSafeNonNegativeInteger(input.lastTouchSeq, defaultLastTouchSeq),
    };
    const telemetryDelta = createTelemetryDelta();
    telemetryDelta.trimmedFrames = toSafeNonNegativeInteger(clipValidation?.stats?.trimmedFrames, 0);
    return { entry, telemetryDelta };
}

export function applyGlobalBudget(ghostLibrary, budgetOptions) {
    const routeIds = Object.keys(ghostLibrary);
    if (routeIds.length <= budgetOptions.maxRoutes && budgetOptions.maxBytes <= 0) {
        return {
            ghostLibrary,
            telemetryDelta: createTelemetryDelta(),
        };
    }
    const sortable = routeIds.map((routeId) => ({
        routeId,
        updatedAtMs: toUpdatedAtMs(ghostLibrary[routeId]?.updatedAt),
        lastTouchSeq: toSafeNonNegativeInteger(ghostLibrary[routeId]?.lastTouchSeq, 0),
    }));
    sortable.sort(compareByEvictionPriority);
    const nextLibrary = cloneGhostLibraryContainer(ghostLibrary);
    const nextMeta = getGhostLibraryMeta(nextLibrary);
    let activeRouteCount = routeIds.length;
    let serializedSize = budgetOptions.maxBytes > 0
        ? estimateSerializedSize(serializeGhostLibraryForStorage(nextLibrary, budgetOptions))
        : 0;
    const telemetryDelta = createTelemetryDelta();
    let cursor = 0;
    while (
        cursor < sortable.length
        && (
            activeRouteCount > budgetOptions.maxRoutes
            || (budgetOptions.maxBytes > 0 && serializedSize > budgetOptions.maxBytes)
        )
    ) {
        const wasOverByteBudget = budgetOptions.maxBytes > 0 && serializedSize > budgetOptions.maxBytes;
        const evictRouteId = sortable[cursor].routeId;
        delete nextLibrary[evictRouteId];
        clearAliasMappingForCanonical(nextMeta.aliasIndex, evictRouteId);
        activeRouteCount -= 1;
        cursor += 1;
        telemetryDelta.evictedRoutes += 1;
        if (wasOverByteBudget) {
            telemetryDelta.droppedByByteBudget += 1;
        }
        if (budgetOptions.maxBytes > 0) {
            serializedSize = estimateSerializedSize(serializeGhostLibraryForStorage(nextLibrary, budgetOptions));
        }
    }
    attachGhostLibraryMeta(nextLibrary, nextMeta);
    return { ghostLibrary: nextLibrary, telemetryDelta };
}

export function normalizeLeaderboard(bestByRoute) {
    if (!isPlainObject(bestByRoute)) return {};
    return bestByRoute;
}

export function resolveLeaderboardBestEntryForRoute(leaderboard, routeId) {
    const entries = Array.isArray(leaderboard?.[routeId]) ? leaderboard[routeId] : [];
    return entries.length > 0 && isPlainObject(entries[0]) ? entries[0] : null;
}

export function isRootSchemaV2(value) {
    return isPlainObject(value)
        && normalizeString(value.schemaVersion) === ARCADE_GHOST_LIBRARY_SCHEMA_VERSION
        && isPlainObject(value.routes);
}

export function buildAliasSeedFromRoot(rawRoot) {
    const aliasesByCanonical = new Map();
    const rawAliasIndex = isPlainObject(rawRoot?.aliasIndex) ? rawRoot.aliasIndex : {};
    const aliases = Object.keys(rawAliasIndex);
    for (let i = 0; i < aliases.length; i += 1) {
        const alias = normalizeString(aliases[i]);
        const canonical = normalizeString(rawAliasIndex[alias]);
        if (!alias || !canonical) continue;
        const list = aliasesByCanonical.get(canonical) || [];
        list.push(alias);
        aliasesByCanonical.set(canonical, list);
    }
    return aliasesByCanonical;
}

export function resolveCanonicalCandidates(library, routeId, routeAliases = []) {
    const relatedCanonicalIds = new Set();
    const safeLibrary = isPlainObject(library) ? library : {};
    const meta = getGhostLibraryMeta(safeLibrary);
    const collectFromRoute = (candidate) => {
        const safeCandidate = normalizeString(candidate);
        if (!safeCandidate) return;
        if (isPlainObject(safeLibrary[safeCandidate])) {
            relatedCanonicalIds.add(safeCandidate);
        }
        const aliasedCanonical = normalizeString(meta.aliasIndex[safeCandidate]);
        if (aliasedCanonical && isPlainObject(safeLibrary[aliasedCanonical])) {
            relatedCanonicalIds.add(aliasedCanonical);
        }
    };
    collectFromRoute(routeId);
    for (let i = 0; i < routeAliases.length; i += 1) {
        collectFromRoute(routeAliases[i]);
    }
    return [...relatedCanonicalIds.values()];
}

export function selectCanonicalWinner(library, relatedCanonicalIds, fallbackRouteId) {
    if (!Array.isArray(relatedCanonicalIds) || relatedCanonicalIds.length <= 0) {
        return normalizeString(fallbackRouteId);
    }
    const sortable = [];
    for (let i = 0; i < relatedCanonicalIds.length; i += 1) {
        const canonicalRouteId = normalizeString(relatedCanonicalIds[i]);
        const entry = library[canonicalRouteId];
        if (!canonicalRouteId || !isPlainObject(entry)) continue;
        sortable.push({
            canonicalRouteId,
            durationMs: toSafeDurationMs(entry.durationMs),
            updatedAt: entry.updatedAt,
            lastTouchSeq: toSafeNonNegativeInteger(entry.lastTouchSeq, 0),
        });
    }
    if (sortable.length <= 0) return normalizeString(fallbackRouteId);
    sortable.sort(compareCanonicalWinner);
    return sortable[0].canonicalRouteId;
}

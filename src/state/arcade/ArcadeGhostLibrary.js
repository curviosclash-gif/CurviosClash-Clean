import { validateGhostClip } from '../../shared/contracts/GhostClipContract.js';
import {
    applyGlobalBudget,
    ARCADE_GHOST_LIBRARY_SCHEMA_VERSION,
    ARCADE_GHOST_LIBRARY_STORAGE_KEY,
    attachGhostLibraryMeta,
    buildAliasSeedFromRoot,
    cloneGhostLibraryContainer,
    cloneObject,
    createEmptyGhostLibrary,
    createGhostLibraryEntry,
    createTelemetryDelta,
    DEFAULT_GHOST_LIBRARY_BUDGET,
    deriveDurationMsFromGhostClip,
    estimateSerializedSize,
    getGhostLibraryMeta,
    isPlainObject,
    isRootSchemaV2,
    isPersistenceSuccess,
    mergeTelemetryDelta,
    normalizeGhostLibraryBudgetOptions,
    normalizeLeaderboard,
    normalizeRouteAliases,
    normalizeString,
    normalizeUpdatedAtIso,
    resolveCanonicalCandidates,
    resolveCanonicalRouteId,
    resolveGhostClipNormalizationOptions,
    resolveLeaderboardBestEntryForRoute,
    selectCanonicalWinner,
    serializeGhostLibraryForStorage,
    toSafeDurationMs,
    toSafeNonNegativeInteger,
    warnPersistenceFailure,
    clearAliasMappingForCanonical,
    writeAliasMappings,
} from './ArcadeGhostLibraryInternals.js';

const ROOT_SCHEMA_V2_RESERVED_KEYS = new Set([
    'schemaVersion',
    'lastTouchSeq',
    'aliasIndex',
    'routes',
]);

function collectLegacyRouteEntriesFromSchemaV2Root(rawLibrary) {
    if (!isPlainObject(rawLibrary)) return [];
    const routeEntries = [];
    const keys = Object.keys(rawLibrary);
    for (let i = 0; i < keys.length; i += 1) {
        const routeId = normalizeString(keys[i]);
        if (!routeId || ROOT_SCHEMA_V2_RESERVED_KEYS.has(routeId)) continue;
        const routeEntry = rawLibrary[routeId];
        if (!isPlainObject(routeEntry)) continue;
        routeEntries.push([routeId, routeEntry]);
    }
    return routeEntries;
}

function normalizeGhostLibrary(
    rawLibrary,
    budgetOptions = DEFAULT_GHOST_LIBRARY_BUDGET,
    { seedLastTouchSeq = 0 } = {}
) {
    let nextLibrary = createEmptyGhostLibrary();
    const telemetryDelta = createTelemetryDelta();
    let workingLastTouchSeq = Math.max(0, toSafeNonNegativeInteger(seedLastTouchSeq, 0));

    if (isRootSchemaV2(rawLibrary)) {
        const aliasSeedByCanonical = buildAliasSeedFromRoot(rawLibrary);
        // Some persisted desktops already carry a v2 root plus pre-migration top-level route entries.
        // We ingest both shapes here so ghost playback survives mixed-format localStorage until write-back.
        const routeEntries = [
            ...Object.entries(rawLibrary.routes || {}),
            ...collectLegacyRouteEntriesFromSchemaV2Root(rawLibrary),
        ];
        for (let i = 0; i < routeEntries.length; i += 1) {
            const [rawRouteId, routeEntry] = routeEntries[i];
            const canonicalRouteId = normalizeString(rawRouteId);
            if (!canonicalRouteId) continue;
            const mergedAliases = [
                ...normalizeRouteAliases(routeEntry?.routeAliases, canonicalRouteId),
                ...(aliasSeedByCanonical.get(canonicalRouteId) || []),
            ];
            const upsertResult = upsertLongestGhostByRoute(
                nextLibrary,
                canonicalRouteId,
                routeEntry?.longestGhostClip ?? routeEntry?.ghostClip ?? null,
                routeEntry?.durationMs,
                {
                    updatedAt: routeEntry?.updatedAt,
                    lastTouchSeq: routeEntry?.lastTouchSeq,
                    routeAliases: mergedAliases,
                    canonicalRouteId,
                    budgetOptions,
                    assumeNormalizedLibrary: true,
                }
            );
            nextLibrary = upsertResult.ghostLibrary;
            mergeTelemetryDelta(telemetryDelta, upsertResult.telemetryDelta);
            workingLastTouchSeq = Math.max(
                workingLastTouchSeq,
                toSafeNonNegativeInteger(routeEntry?.lastTouchSeq, 0)
            );
        }
        const finalMeta = getGhostLibraryMeta(nextLibrary);
        attachGhostLibraryMeta(nextLibrary, {
            ...finalMeta,
            lastTouchSeq: Math.max(
                toSafeNonNegativeInteger(rawLibrary.lastTouchSeq, 0),
                workingLastTouchSeq,
                finalMeta.lastTouchSeq
            ),
        });
        return { ghostLibrary: nextLibrary, telemetryDelta };
    }

    if (!isPlainObject(rawLibrary)) {
        return { ghostLibrary: nextLibrary, telemetryDelta };
    }

    const routeIds = Object.keys(rawLibrary);
    for (let i = 0; i < routeIds.length; i += 1) {
        const routeId = normalizeString(routeIds[i]);
        if (!routeId) continue;
        const sourceEntry = rawLibrary[routeId];
        const canonicalRouteId = normalizeString(sourceEntry?.canonicalRouteId, routeId);
        const upsertResult = upsertLongestGhostByRoute(
            nextLibrary,
            routeId,
            sourceEntry?.longestGhostClip ?? sourceEntry?.ghostClip ?? null,
            sourceEntry?.durationMs,
            {
                updatedAt: sourceEntry?.updatedAt,
                lastTouchSeq: sourceEntry?.lastTouchSeq,
                routeAliases: sourceEntry?.routeAliases,
                canonicalRouteId,
                budgetOptions,
                assumeNormalizedLibrary: true,
            }
        );
        nextLibrary = upsertResult.ghostLibrary;
        mergeTelemetryDelta(telemetryDelta, upsertResult.telemetryDelta);
        workingLastTouchSeq = Math.max(
            workingLastTouchSeq,
            toSafeNonNegativeInteger(sourceEntry?.lastTouchSeq, 0)
        );
    }

    const finalMeta = getGhostLibraryMeta(nextLibrary);
    attachGhostLibraryMeta(nextLibrary, {
        ...finalMeta,
        lastTouchSeq: Math.max(finalMeta.lastTouchSeq, workingLastTouchSeq),
    });
    return { ghostLibrary: nextLibrary, telemetryDelta };
}

export { ARCADE_GHOST_LIBRARY_STORAGE_KEY };
export { ARCADE_GHOST_LIBRARY_SCHEMA_VERSION };
export { DEFAULT_GHOST_LIBRARY_BUDGET as ARCADE_GHOST_LIBRARY_DEFAULT_BUDGET };

export function loadGhostLibrary(store, budgetOptions = null, options = null) {
    const resolvedBudget = normalizeGhostLibraryBudgetOptions(budgetOptions);
    const safeOptions = isPlainObject(options) ? options : {};
    const onMigrationWrite = typeof safeOptions.onMigrationWrite === 'function'
        ? safeOptions.onMigrationWrite
        : null;

    if (!store || typeof store.loadJsonRecord !== 'function') {
        return createEmptyGhostLibrary();
    }

    const raw = store.loadJsonRecord(ARCADE_GHOST_LIBRARY_STORAGE_KEY, {});
    const normalization = normalizeGhostLibrary(raw, resolvedBudget, {
        seedLastTouchSeq: toSafeNonNegativeInteger(raw?.lastTouchSeq, 0),
    });
    const normalized = normalization.ghostLibrary;
    if (typeof store.saveJsonRecord === 'function') {
        const rawSerialized = JSON.stringify(raw);
        const normalizedSerialized = JSON.stringify(serializeGhostLibraryForStorage(normalized, resolvedBudget));
        if (rawSerialized !== normalizedSerialized) {
            const saveResult = store.saveJsonRecord(
                ARCADE_GHOST_LIBRARY_STORAGE_KEY,
                serializeGhostLibraryForStorage(normalized, resolvedBudget)
            );
            warnPersistenceFailure('canonical write-back', saveResult);
            if (isPersistenceSuccess(saveResult)) {
                normalization.telemetryDelta.migrationWrites += 1;
                if (onMigrationWrite) {
                    onMigrationWrite({
                        key: ARCADE_GHOST_LIBRARY_STORAGE_KEY,
                        telemetryDelta: cloneObject(normalization.telemetryDelta),
                    });
                }
            }
        }
    }
    return normalized;
}

export function saveGhostLibrary(store, ghostLibrary, budgetOptions = null) {
    if (!store || typeof store.saveJsonRecord !== 'function') return;
    const resolvedBudget = normalizeGhostLibraryBudgetOptions(budgetOptions);
    const normalized = normalizeGhostLibrary(ghostLibrary, resolvedBudget).ghostLibrary;
    const saveResult = store.saveJsonRecord(
        ARCADE_GHOST_LIBRARY_STORAGE_KEY,
        serializeGhostLibraryForStorage(normalized, resolvedBudget)
    );
    warnPersistenceFailure('saveGhostLibrary', saveResult);
}

export function getLongestGhostByRoute(ghostLibrary, routeId, budgetOptions = null) {
    const safeRouteId = normalizeString(routeId);
    if (!safeRouteId) return null;
    if (!isPlainObject(ghostLibrary)) return null;
    const resolvedBudget = normalizeGhostLibraryBudgetOptions(budgetOptions);
    const canonicalRouteId = resolveCanonicalRouteId(ghostLibrary, safeRouteId, resolvedBudget);
    if (!canonicalRouteId) return null;
    const entry = createGhostLibraryEntry(
        canonicalRouteId,
        ghostLibrary[canonicalRouteId],
        resolvedBudget,
        {
            forcedRouteAliases: ghostLibrary[canonicalRouteId]?.routeAliases,
            defaultLastTouchSeq: toSafeNonNegativeInteger(ghostLibrary[canonicalRouteId]?.lastTouchSeq, 0),
        }
    ).entry;
    return entry ? cloneObject(entry) : null;
}

export function upsertLongestGhostByRoute(
    ghostLibrary,
    routeId,
    ghostClip,
    durationMs,
    {
        updatedAt = null,
        lastTouchSeq = null,
        canonicalRouteId = null,
        routeAliases = null,
        budgetOptions = null,
        assumeNormalizedLibrary = false,
    } = {}
) {
    const resolvedBudget = normalizeGhostLibraryBudgetOptions(budgetOptions);
    const telemetryDelta = createTelemetryDelta();
    const baseLibrary = assumeNormalizedLibrary
        ? cloneGhostLibraryContainer(ghostLibrary)
        : normalizeGhostLibrary(ghostLibrary, resolvedBudget).ghostLibrary;

    const safeRouteId = normalizeString(routeId);
    if (!safeRouteId) {
        return {
            ghostLibrary: baseLibrary,
            changed: false,
            reason: 'invalid_route',
            telemetryDelta,
        };
    }

    const clipValidation = validateGhostClip(
        ghostClip,
        resolveGhostClipNormalizationOptions(resolvedBudget)
    );
    if (!clipValidation.valid || !clipValidation.clip) {
        return {
            ghostLibrary: baseLibrary,
            changed: false,
            reason: clipValidation.reason === 'invalid_duration' ? 'invalid_duration' : 'invalid_clip',
            telemetryDelta,
        };
    }

    const explicitDurationMs = toSafeDurationMs(durationMs);
    const derivedDurationMs = deriveDurationMsFromGhostClip(clipValidation.clip);
    const safeDurationMs = Math.max(explicitDurationMs, derivedDurationMs);
    if (safeDurationMs <= 0) {
        return {
            ghostLibrary: baseLibrary,
            changed: false,
            reason: 'invalid_duration',
            telemetryDelta,
        };
    }

    const safeRouteAliases = normalizeRouteAliases(routeAliases, safeRouteId);
    const relatedCanonicalIds = resolvedBudget.canonicalizeAliases
        ? resolveCanonicalCandidates(baseLibrary, safeRouteId, safeRouteAliases)
        : [];
    const preferredCanonicalFromOption = normalizeString(canonicalRouteId);
    const canonicalWinner = resolvedBudget.canonicalizeAliases
        ? (
            preferredCanonicalFromOption
            || selectCanonicalWinner(baseLibrary, relatedCanonicalIds, safeRouteId)
            || safeRouteId
        )
        : safeRouteId;

    const previousEntryRaw = isPlainObject(baseLibrary[canonicalWinner]) ? baseLibrary[canonicalWinner] : null;
    const previousEntry = createGhostLibraryEntry(
        canonicalWinner,
        previousEntryRaw,
        resolvedBudget,
        {
            forcedRouteAliases: previousEntryRaw?.routeAliases,
            defaultLastTouchSeq: toSafeNonNegativeInteger(previousEntryRaw?.lastTouchSeq, 0),
        }
    ).entry;
    const shouldReplace = !previousEntry || previousEntry.durationMs < safeDurationMs;

    const nextLibrary = cloneGhostLibraryContainer(baseLibrary);
    const nextMeta = getGhostLibraryMeta(nextLibrary);
    const allMergedAliases = new Set();
    const pushAlias = (value) => {
        const safeAlias = normalizeString(value);
        if (!safeAlias || safeAlias === canonicalWinner) return;
        allMergedAliases.add(safeAlias);
    };
    pushAlias(safeRouteId);
    for (let i = 0; i < safeRouteAliases.length; i += 1) {
        pushAlias(safeRouteAliases[i]);
    }

    if (resolvedBudget.canonicalizeAliases) {
        for (let i = 0; i < relatedCanonicalIds.length; i += 1) {
            const relatedId = normalizeString(relatedCanonicalIds[i]);
            if (!relatedId || !isPlainObject(nextLibrary[relatedId])) continue;
            const relatedAliases = normalizeRouteAliases(nextLibrary[relatedId]?.routeAliases, relatedId);
            for (let j = 0; j < relatedAliases.length; j += 1) {
                pushAlias(relatedAliases[j]);
            }
            if (relatedId !== canonicalWinner) {
                delete nextLibrary[relatedId];
                clearAliasMappingForCanonical(nextMeta.aliasIndex, relatedId);
            }
        }
        const existingWinnerAliases = normalizeRouteAliases(nextLibrary[canonicalWinner]?.routeAliases, canonicalWinner);
        for (let i = 0; i < existingWinnerAliases.length; i += 1) {
            pushAlias(existingWinnerAliases[i]);
        }
    }

    const mergedAliases = [...allMergedAliases.values()];
    if (shouldReplace) {
        const nextSeq = lastTouchSeq == null
            ? nextMeta.lastTouchSeq + 1
            : Math.max(nextMeta.lastTouchSeq + 1, toSafeNonNegativeInteger(lastTouchSeq, nextMeta.lastTouchSeq + 1));
        const nextEntryResult = createGhostLibraryEntry(
            canonicalWinner,
            {
                longestGhostClip: clipValidation.clip,
                durationMs: safeDurationMs,
                updatedAt: normalizeUpdatedAtIso(updatedAt, '1970-01-01T00:00:00.000Z'),
                lastTouchSeq: nextSeq,
                routeAliases: resolvedBudget.canonicalizeAliases ? mergedAliases : [],
            },
            resolvedBudget,
            {
                defaultLastTouchSeq: nextSeq,
                forcedRouteAliases: resolvedBudget.canonicalizeAliases ? mergedAliases : [],
            }
        );
        if (!nextEntryResult.entry) {
            return {
                ghostLibrary: baseLibrary,
                changed: false,
                reason: 'invalid_clip',
                telemetryDelta,
            };
        }
        nextLibrary[canonicalWinner] = nextEntryResult.entry;
        nextMeta.lastTouchSeq = Math.max(nextMeta.lastTouchSeq, nextSeq);
        telemetryDelta.trimmedFrames = toSafeNonNegativeInteger(clipValidation?.stats?.trimmedFrames, 0);
    } else if (resolvedBudget.canonicalizeAliases && isPlainObject(nextLibrary[canonicalWinner])) {
        nextLibrary[canonicalWinner] = {
            ...nextLibrary[canonicalWinner],
            routeAliases: mergedAliases,
        };
    }

    if (resolvedBudget.canonicalizeAliases) {
        clearAliasMappingForCanonical(nextMeta.aliasIndex, canonicalWinner);
        writeAliasMappings(nextMeta.aliasIndex, canonicalWinner, mergedAliases);
    } else {
        nextMeta.aliasIndex = {};
    }
    attachGhostLibraryMeta(nextLibrary, nextMeta);

    const budgeted = applyGlobalBudget(nextLibrary, resolvedBudget);
    mergeTelemetryDelta(telemetryDelta, budgeted.telemetryDelta);
    const finalLibrary = budgeted.ghostLibrary;
    const previousSerialized = JSON.stringify(serializeGhostLibraryForStorage(baseLibrary, resolvedBudget));
    const nextSerialized = JSON.stringify(serializeGhostLibraryForStorage(finalLibrary, resolvedBudget));
    const changed = previousSerialized !== nextSerialized;

    const resolvedCanonical = resolveCanonicalRouteId(finalLibrary, canonicalWinner, resolvedBudget) || canonicalWinner;
    const resolvedEntry = isPlainObject(finalLibrary[resolvedCanonical])
        ? cloneObject(finalLibrary[resolvedCanonical])
        : null;
    let reason = 'not_longer';
    if (shouldReplace) {
        reason = previousEntry ? 'replaced_longest' : 'created';
    } else if (changed) {
        reason = 'merged_aliases';
    }

    return {
        ghostLibrary: finalLibrary,
        changed,
        reason,
        entry: resolvedEntry,
        telemetryDelta,
    };
}

export function bootstrapGhostLibraryFromLeaderboard(
    ghostLibrary,
    leaderboardByRoute,
    { force = false, budgetOptions = null } = {}
) {
    const resolvedBudget = normalizeGhostLibraryBudgetOptions(budgetOptions);
    const normalizedLibrary = normalizeGhostLibrary(ghostLibrary, resolvedBudget).ghostLibrary;
    const telemetryDelta = createTelemetryDelta();
    const leaderboard = normalizeLeaderboard(leaderboardByRoute);
    let nextLibrary = normalizedLibrary;
    let changed = false;

    for (const routeId of Object.keys(leaderboard)) {
        if (!force && getLongestGhostByRoute(nextLibrary, routeId, resolvedBudget)) {
            continue;
        }
        const bestEntry = resolveLeaderboardBestEntryForRoute(leaderboard, routeId);
        if (!bestEntry) continue;
        const upsertResult = upsertLongestGhostByRoute(
            nextLibrary,
            routeId,
            bestEntry.ghostClip,
            bestEntry.ghostDurationMs,
            {
                updatedAt: bestEntry.date,
                budgetOptions: resolvedBudget,
                assumeNormalizedLibrary: true,
            }
        );
        mergeTelemetryDelta(telemetryDelta, upsertResult.telemetryDelta);
        if (!upsertResult.changed) continue;
        nextLibrary = upsertResult.ghostLibrary;
        changed = true;
    }

    return {
        ghostLibrary: nextLibrary,
        changed,
        telemetryDelta,
    };
}

export function getGhostLibraryDebugSnapshot(ghostLibrary, budgetOptions = null) {
    const resolvedBudget = normalizeGhostLibraryBudgetOptions(budgetOptions);
    const normalized = normalizeGhostLibrary(ghostLibrary, resolvedBudget).ghostLibrary;
    const meta = getGhostLibraryMeta(normalized);
    return {
        schemaVersion: ARCADE_GHOST_LIBRARY_SCHEMA_VERSION,
        routeCount: Object.keys(normalized).length,
        aliasCount: Object.keys(meta.aliasIndex).length,
        lastTouchSeq: meta.lastTouchSeq,
        serializedBytes: estimateSerializedSize(serializeGhostLibraryForStorage(normalized, resolvedBudget)),
        budget: {
            maxRoutes: resolvedBudget.maxRoutes,
            maxFramesPerRoute: resolvedBudget.maxFramesPerRoute,
            maxBytes: resolvedBudget.maxBytes,
            canonicalizeAliases: resolvedBudget.canonicalizeAliases,
        },
    };
}

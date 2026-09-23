import { createLeaderboardEntry, getBestEntry, insertLeaderboardEntry } from '../../state/arcade/ArcadeLeaderboard.js';
import {
    getLongestGhostByRoute,
    upsertLongestGhostByRoute,
} from '../../state/arcade/ArcadeGhostLibrary.js';
import { isArcadeGhostDuelPlaybackEnabled } from '../../shared/contracts/ArcadeGhostDuelContract.js';

function normalizeRouteCandidates(routeId, routeAliases = null) {
    const candidates = [];
    const seen = new Set();
    const pushCandidate = (value) => {
        const normalized = String(value || '').trim();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        candidates.push(normalized);
    };
    pushCandidate(routeId);
    if (Array.isArray(routeAliases)) {
        for (let i = 0; i < routeAliases.length; i += 1) pushCandidate(routeAliases[i]);
    }
    return candidates;
}

function boundedGhost(clip, budget) {
    if (!clip) return null;
    const result = upsertLongestGhostByRoute({}, 'best', clip, 0, { budgetOptions: budget });
    return getLongestGhostByRoute(result.ghostLibrary, 'best', budget)?.longestGhostClip || null;
}

function resolveGhostStart(runtime, data, routeCandidates, ghostLibraryBudget) {
    if (routeCandidates.length === 0) {
        return { started: false, reason: 'invalid_route', routeCandidates };
    }
    if (!isArcadeGhostDuelPlaybackEnabled(runtime._config?.ghostDuelMode)) {
        return { started: false, reason: 'ghost_mode_disabled', routeCandidates };
    }
    let clipToPlay = null;
    let selectedRouteId = '';
    const bestTimeMode = runtime._config?.ghostDuelMode === 'self_best_time_ghost';
    if (bestTimeMode) {
        const bestRouteCandidates = new Set(routeCandidates);
        for (const routeId of routeCandidates) {
            const route = getLongestGhostByRoute(runtime._ghostLibrary, routeId, ghostLibraryBudget);
            if (route?.routeId) bestRouteCandidates.add(route.routeId);
            for (const alias of route?.routeAliases || []) bestRouteCandidates.add(alias);
        }
        const best = [...bestRouteCandidates].map(routeId => ({ routeId, entry: getBestEntry(runtime._leaderboard, routeId) }))
            .filter(candidate => candidate.entry).sort((a, b) => a.entry.totalTimeMs - b.entry.totalTimeMs)[0];
        selectedRouteId = best?.routeId || '';
        clipToPlay = boundedGhost(best?.entry?.ghostClip, ghostLibraryBudget);
    }
    for (let i = 0; !bestTimeMode && i < routeCandidates.length; i += 1) {
        const longestGhost = getLongestGhostByRoute(
            runtime._ghostLibrary,
            routeCandidates[i],
            ghostLibraryBudget
        );
        if (!longestGhost?.longestGhostClip) continue;
        clipToPlay = longestGhost.longestGhostClip;
        selectedRouteId = String(longestGhost.routeId || routeCandidates[i] || '').trim();
        break;
    }
    if (!clipToPlay) {
        runtime._enqueueHudEvent?.('ghost_status', { message: bestTimeMode ? 'Zur Bestzeit ist kein Ghost gespeichert.' : 'Noch kein Ghost gespeichert.' });
        return { started: false, reason: bestTimeMode ? 'best_ghost_not_found' : 'ghost_not_found', routeCandidates };
    }
    runtime._enqueueHudEvent?.('ghost_status', { message: bestTimeMode ? 'Ghost: persönliche Bestzeit' : 'Ghost: längste Spur' });

    const source = String(data?.source || '').trim().toLowerCase();
    if (
        source === 'parcours_checkpoint_start'
        && selectedRouteId
        && selectedRouteId === runtime._lastGhostPlaybackRouteId
    ) {
        return {
            started: false,
            reason: 'duplicate_checkpoint_start',
            routeId: selectedRouteId,
            routeCandidates,
        };
    }
    if (!runtime._onGhostPlayback) {
        return {
            started: false,
            reason: 'playback_handler_missing',
            routeId: selectedRouteId,
            routeCandidates,
        };
    }
    try {
        runtime._onGhostPlayback(clipToPlay);
        runtime._lastGhostPlaybackRouteId = selectedRouteId;
        return { started: true, reason: 'ok', routeId: selectedRouteId, routeCandidates };
    } catch {
        return {
            started: false,
            reason: 'playback_handler_error',
            routeId: selectedRouteId,
            routeCandidates,
        };
    }
}

function resolveCheckpoint(runtime, data, primaryRouteId) {
    if (!runtime._enabled || !runtime._leaderboard || !primaryRouteId) return null;
    const best = getBestEntry(runtime._leaderboard, primaryRouteId);
    if (!best || !Array.isArray(best.segmentSplitsMs)) return null;
    const bestSplitMs = best.segmentSplitsMs[data.checkpointIndex];
    if (typeof bestSplitMs !== 'number') return null;
    const deltaMs = data.currentSplitMs - bestSplitMs;
    if (runtime._state) {
        runtime._state.lastParcoursSegmentSplit = runtime._enqueueHudEvent('parcours_split', {
            checkpointIndex: data.checkpointIndex,
            deltaMs,
            isBetter: deltaMs < 0,
        });
    }
    return { deltaMs, isBetter: deltaMs < 0 };
}

function resolveWrongOrder(runtime, data) {
    if (!runtime._enabled) return null;
    const penaltyMs = Math.max(0, Math.trunc(Number(data.penaltyMs) || 0));
    if (penaltyMs <= 0) return null;
    const totalPenaltyMs = Math.max(penaltyMs, Math.trunc(Number(data.totalPenaltyMs) || penaltyMs));
    if (runtime._state) {
        runtime._state.lastParcoursPenalty = runtime._enqueueHudEvent('parcours_penalty', {
            penaltyMs,
            totalPenaltyMs,
        });
    }
    return { penaltyMs, totalPenaltyMs };
}

function resolveFinish(runtime, data, routeCandidates, primaryRouteId, ghostLibraryBudget) {
    if (!primaryRouteId) return null;
    const persistLibraryOnly = data.persistLibraryOnly === true || runtime._enabled !== true;
    const store = runtime._resolveSettingsRecordStore();
    const vehicleId = runtime._activeVehicleId || '';
    const recordedAtIso = new Date().toISOString();
    const ghostDurationMs = Math.max(0, Math.trunc(Number(data.ghostDurationMs) || 0));
    let isBestTime = false;
    let inserted = false;
    let presentationResult = null;

    if (!persistLibraryOnly) {
        const entry = createLeaderboardEntry({
            totalTimeMs: data.totalTimeMs,
            penaltyTimeMs: data.penaltyTimeMs,
            segmentSplitsMs: data.segmentSplitsMs,
            vehicleId,
            date: recordedAtIso,
        });
        if (!entry) {
            return {
                inserted: false,
                isBestTime: false,
                persistLibraryOnly,
                reason: 'invalid_total_time',
                ghostRouteIds: routeCandidates,
                longestGhostUpdated: false,
                longestGhostReason: 'invalid_total_time',
            };
        }
        const best = getBestEntry(runtime._leaderboard, primaryRouteId);
        const previousBestTimeMs = Math.max(0, Number(best?.totalTimeMs) || 0);
        const safeClip = boundedGhost(data.ghostClip, ghostLibraryBudget);
        if (best && entry.totalTimeMs === best.totalTimeMs && !best.ghostClip && safeClip) {
            runtime._leaderboard = { ...runtime._leaderboard, [primaryRouteId]: runtime._leaderboard[primaryRouteId]
                .map((entry, index) => index === 0 ? { ...entry, ghostClip: safeClip } : entry) };
        }
        isBestTime = !best || entry.totalTimeMs < best.totalTimeMs;
        runtime._leaderboard = insertLeaderboardEntry(runtime._leaderboard, primaryRouteId, {
            ...entry,
            ghostClip: isBestTime ? safeClip : null,
        });
        const updatedEntries = Array.isArray(runtime._leaderboard?.[primaryRouteId])
            ? runtime._leaderboard[primaryRouteId]
            : [];
        const storedIndex = updatedEntries.findIndex((candidate) => (
            candidate?.date === entry.date
            && candidate?.totalTimeMs === entry.totalTimeMs
            && candidate?.vehicleId === entry.vehicleId
        ));
        const bestTimeMs = Math.max(0, Number(updatedEntries[0]?.totalTimeMs) || entry.totalTimeMs);
        const rank = storedIndex >= 0
            ? updatedEntries.findIndex((candidate) => candidate?.totalTimeMs === entry.totalTimeMs) + 1
            : null;
        runtime._scheduleLeaderboardSave();
        inserted = true;

        presentationResult = {
            routeId: primaryRouteId,
            totalTimeMs: entry.totalTimeMs,
            penaltyTimeMs: entry.penaltyTimeMs,
            vehicleId: entry.vehicleId,
            recordedAtIso: entry.date,
            previousBestTimeMs,
            bestTimeMs,
            deltaToBestMs: Math.max(0, entry.totalTimeMs - bestTimeMs),
            improvementMs: previousBestTimeMs > 0 ? Math.max(0, previousBestTimeMs - entry.totalTimeMs) : 0,
            rank,
            qualified: rank !== null,
            status: previousBestTimeMs <= 0
                ? 'first_time'
                : (isBestTime ? 'new_best' : (rank === null ? 'not_ranked' : 'ranked')),
        };
        runtime._lastParcoursResult = { ...presentationResult };
    }

    const upsert = upsertLongestGhostByRoute(
        runtime._ghostLibrary,
        primaryRouteId,
        data.ghostClip,
        ghostDurationMs > 0 ? ghostDurationMs : 0,
        {
            updatedAt: recordedAtIso,
            routeAliases: routeCandidates.slice(1),
            canonicalRouteId: primaryRouteId,
            budgetOptions: ghostLibraryBudget,
            assumeNormalizedLibrary: false,
        }
    );
    runtime._mergeGhostLibraryTelemetryDelta(upsert.telemetryDelta);
    runtime._ghostLibrary = upsert.ghostLibrary;
    runtime._lastGhostPlaybackRouteId = '';
    if (upsert.changed) runtime._scheduleGhostLibrarySave(store, ghostLibraryBudget);
    if (!persistLibraryOnly && isBestTime && data.awardBestXp !== false) {
        runtime.applyParcoursXpEvent('new_best_time', data.playerIndex || 0);
    }
    return {
        inserted,
        isBestTime,
        persistLibraryOnly,
        ...(presentationResult || {}),
        ghostRouteIds: routeCandidates,
        longestGhostUpdated: upsert.changed,
        longestGhostReason: upsert.reason,
    };
}

export function applyParcoursLeaderboardEvent(runtime, data) {
    if (!data || typeof data !== 'object') return null;
    const routeCandidates = normalizeRouteCandidates(data.routeId, data.routeAliases);
    const primaryRouteId = routeCandidates[0] || '';
    const ghostLibraryBudget = runtime._resolveGhostLibraryBudgetOptions();

    if (data.type === 'checkpoint') return resolveCheckpoint(runtime, data, primaryRouteId);
    if (data.type === 'ghost_start') {
        return resolveGhostStart(runtime, data, routeCandidates, ghostLibraryBudget);
    }
    if (data.type === 'wrong_order') return resolveWrongOrder(runtime, data);
    if (data.type === 'finish') {
        return resolveFinish(runtime, data, routeCandidates, primaryRouteId, ghostLibraryBudget);
    }
    return null;
}

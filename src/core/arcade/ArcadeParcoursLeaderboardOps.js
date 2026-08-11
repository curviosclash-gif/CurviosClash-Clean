import { getBestEntry, insertLeaderboardEntry } from '../../state/arcade/ArcadeLeaderboard.js';
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

function resolveGhostStart(runtime, data, routeCandidates, ghostLibraryBudget) {
    if (routeCandidates.length === 0) {
        return { started: false, reason: 'invalid_route', routeCandidates };
    }
    if (!isArcadeGhostDuelPlaybackEnabled(runtime._config?.ghostDuelMode)) {
        return { started: false, reason: 'ghost_mode_disabled', routeCandidates };
    }
    let clipToPlay = null;
    let selectedRouteId = '';
    for (let i = 0; i < routeCandidates.length; i += 1) {
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
    if (!clipToPlay) return { started: false, reason: 'ghost_not_found', routeCandidates };

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

    if (!persistLibraryOnly) {
        const best = getBestEntry(runtime._leaderboard, primaryRouteId);
        isBestTime = !best || data.totalTimeMs < best.totalTimeMs;
        runtime._leaderboard = insertLeaderboardEntry(runtime._leaderboard, primaryRouteId, {
            totalTimeMs: data.totalTimeMs,
            penaltyTimeMs: data.penaltyTimeMs,
            segmentSplitsMs: data.segmentSplitsMs,
            vehicleId,
            date: recordedAtIso,
            ghostClip: isBestTime ? (data.ghostClip || null) : null,
        });
        runtime._scheduleLeaderboardSave();
        inserted = true;
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
    if (!persistLibraryOnly && isBestTime) {
        runtime.applyParcoursXpEvent('new_best_time', data.playerIndex || 0);
    }
    return {
        inserted,
        isBestTime,
        persistLibraryOnly,
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

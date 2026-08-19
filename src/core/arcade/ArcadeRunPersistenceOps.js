import { createArcadeRunRecords } from '../../state/arcade/ArcadeRunState.js';
import { saveGhostLibrary } from '../../state/arcade/ArcadeGhostLibrary.js';
import { ARCADE_RUN_PROFILE_STORAGE_KEY } from '../../shared/contracts/ArcadeRunSettingsContract.js';

function toSafeInt(value, fallback = 0) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveArcadeSettingsRecordStore(runtime) {
    return runtime.settingsManager?.getPlayerRecordStorePort?.()
        || runtime.settingsManager?.getSettingsRecordStorePort?.()
        || null;
}

export function scheduleArcadeVehicleProfilesSave(runtime) {
    const store = resolveArcadeSettingsRecordStore(runtime);
    return runtime._persistenceScheduler?.scheduleVehicleProfiles?.(store, runtime._vehicleProfiles) === true;
}

export function scheduleArcadeLeaderboardSave(runtime) {
    const store = resolveArcadeSettingsRecordStore(runtime);
    return runtime._persistenceScheduler?.scheduleLeaderboard?.(store, runtime._leaderboard) === true;
}

export function readArcadeRecordsFromStorage(runtime) {
    const store = resolveArcadeSettingsRecordStore(runtime);
    if (!store || typeof store.loadJsonRecord !== 'function') {
        return createArcadeRunRecords(runtime._records);
    }
    return createArcadeRunRecords(store.loadJsonRecord(ARCADE_RUN_PROFILE_STORAGE_KEY, null));
}

export function scheduleArcadeRecordsSave(runtime, records = runtime._records, onPersisted = null) {
    const store = resolveArcadeSettingsRecordStore(runtime);
    if (!store || typeof store.saveJsonRecord !== 'function') return false;
    return runtime._persistenceScheduler?.scheduleRunRecords?.(
        store,
        ARCADE_RUN_PROFILE_STORAGE_KEY,
        records,
        createArcadeRunRecords,
        onPersisted
    ) === true;
}

export function mergeGhostLibraryTelemetryDelta(runtime, delta) {
    if (!delta || typeof delta !== 'object') return;
    runtime._ghostLibraryDebugCounters.evictedRoutes += Math.max(0, toSafeInt(delta.evictedRoutes, 0));
    runtime._ghostLibraryDebugCounters.trimmedFrames += Math.max(0, toSafeInt(delta.trimmedFrames, 0));
    runtime._ghostLibraryDebugCounters.migrationWrites += Math.max(0, toSafeInt(delta.migrationWrites, 0));
    runtime._ghostLibraryDebugCounters.droppedByByteBudget += Math.max(0, toSafeInt(delta.droppedByByteBudget, 0));
}

export function clearGhostLibrarySaveTimer(runtime) {
    if (runtime._ghostLibrarySaveTimer == null) return;
    clearTimeout(runtime._ghostLibrarySaveTimer);
    runtime._ghostLibrarySaveTimer = null;
}

export function flushPendingGhostLibrarySave(runtime) {
    clearGhostLibrarySaveTimer(runtime);
    const pending = runtime._pendingGhostLibrarySave;
    if (!pending) return false;
    try {
        const saveResult = saveGhostLibrary(pending.store, pending.ghostLibrary, pending.budgetOptions);
        if (saveResult !== undefined && saveResult !== true && saveResult?.success !== true) {
            return false;
        }
        runtime._pendingGhostLibrarySave = null;
        return true;
    } catch (error) {
        runtime.logger?.warn?.('[ArcadeRunPersistenceOps] ghost library save failed:', error);
        return false;
    }
}

export function flushArcadePersistenceSaves(runtime) {
    const flushedArcadeSaves = runtime._persistenceScheduler?.flushAll?.() === true;
    const flushedGhostSaves = flushPendingGhostLibrarySave(runtime);
    return flushedArcadeSaves || flushedGhostSaves;
}

export function flushArcadePersistenceSavesResult(runtime) {
    const scheduled = runtime._persistenceScheduler?.flushAllResult?.()
        || { ok: true, hadPending: false, failures: [] };
    const hadGhostPending = !!runtime._pendingGhostLibrarySave;
    const ghostOk = hadGhostPending ? flushPendingGhostLibrarySave(runtime) : true;
    return {
        ok: scheduled.ok === true && ghostOk,
        hadPending: scheduled.hadPending === true || hadGhostPending,
        failures: [
            ...(Array.isArray(scheduled.failures) ? scheduled.failures : []),
            ...(!ghostOk ? ['ghostLibrary'] : []),
        ],
    };
}

export function scheduleGhostLibrarySave(runtime, store, budgetOptions) {
    if (!store || typeof store.saveJsonRecord !== 'function') return;
    runtime._pendingGhostLibrarySave = {
        store,
        budgetOptions,
        ghostLibrary: runtime._ghostLibrary,
    };
    if (runtime._ghostLibrarySaveThrottleMs <= 0) {
        flushPendingGhostLibrarySave(runtime);
        return;
    }
    if (runtime._ghostLibrarySaveTimer != null) return;
    runtime._ghostLibrarySaveTimer = setTimeout(
        () => flushPendingGhostLibrarySave(runtime),
        runtime._ghostLibrarySaveThrottleMs
    );
}

import { createArcadeRunRecords } from '../../state/arcade/ArcadeRunState.js';
import { saveGhostLibrary } from '../../state/arcade/ArcadeGhostLibrary.js';

const ARCADE_PROFILE_STORAGE_KEY = 'cuviosclash.arcade-run-profile.v1';

function toSafeInt(value, fallback = 0) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveArcadeSettingsRecordStore(runtime) {
    return runtime.settingsManager?.getSettingsRecordStorePort?.() || null;
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
    return createArcadeRunRecords(store.loadJsonRecord(ARCADE_PROFILE_STORAGE_KEY, null));
}

export function scheduleArcadeRecordsSave(runtime, records = runtime._records) {
    const store = resolveArcadeSettingsRecordStore(runtime);
    if (!store || typeof store.saveJsonRecord !== 'function') return false;
    return runtime._persistenceScheduler?.scheduleRunRecords?.(
        store,
        ARCADE_PROFILE_STORAGE_KEY,
        records,
        createArcadeRunRecords
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
    runtime._pendingGhostLibrarySave = null;
    saveGhostLibrary(pending.store, pending.ghostLibrary, pending.budgetOptions);
    return true;
}

export function flushArcadePersistenceSaves(runtime) {
    const flushedArcadeSaves = runtime._persistenceScheduler?.flushAll?.() === true;
    const flushedGhostSaves = flushPendingGhostLibrarySave(runtime);
    return flushedArcadeSaves || flushedGhostSaves;
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

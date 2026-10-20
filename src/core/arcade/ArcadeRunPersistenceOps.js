import { createArcadeRunRecords } from '../../state/arcade/ArcadeRunState.js';
import { saveGhostLibrary } from '../../state/arcade/ArcadeGhostLibrary.js';
import { ARCADE_RUN_PROFILE_STORAGE_KEY, GAUNTLET_FREE_RUN_PROFILE_STORAGE_KEY } from '../../shared/contracts/ArcadeRunSettingsContract.js';
import { loadArcadeVehicleProfileRecord } from '../../shared/contracts/ArcadeVehicleProfileContract.js';

const DAMAGED_RECORD_STATUSES = new Set(['invalid', 'not_object']);

/**
 * A save that can never succeed: the stored vehicle profile record is damaged, or a vehicle the run
 * flew is held back as a preserved record (unreadable or newer schema), and those saves are refused so
 * nothing overwrites it. A failed read or a full storage may still recover and is not this.
 */
export function isArcadeSaveBlockedByDamagedRecord(kind, store, lastFailure = null) {
    if (String(kind || '').split(':')[0] !== 'vehicleProfiles' || !store) return false;
    if (lastFailure?.reason === 'preserved_target') return true;
    const record = loadArcadeVehicleProfileRecord(store);
    return record.canPersist === false && DAMAGED_RECORD_STATUSES.has(record.unreadableRecord?.status);
}

/**
 * Whether a failed save must block the next run. Saves blocked by a damaged record are dropped first:
 * the run then plays without saving and the result screen says why (saveBlockedKinds).
 */
export function hasBlockingArcadePersistenceFailures(runtime) {
    runtime?._persistenceScheduler?.releaseFailedKinds?.(isArcadeSaveBlockedByDamagedRecord);
    return Boolean(runtime?._persistenceScheduler?.getFailedKinds?.().length || runtime?._ghostLibrarySaveFailed);
}

export function resolveArcadeRunProfileStorageKey(config) {
    return config?.runType === 'gauntlet' && config.dailyChallenge !== true && !config.journeyStageId
        ? GAUNTLET_FREE_RUN_PROFILE_STORAGE_KEY : ARCADE_RUN_PROFILE_STORAGE_KEY;
}

function toSafeInt(value, fallback = 0) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveArcadeSettingsRecordStore(runtime) {
    if (runtime._primaryRecordStore !== undefined) return runtime._primaryRecordStore;
    return runtime.settingsManager?.getPlayerRecordStorePort?.()
        || runtime.settingsManager?.getSettingsRecordStorePort?.()
        || null;
}

/**
 * Mirrors the saves the store rejected (full storage, quota) onto the post-run summary, so the
 * result screen can say that progress was not stored. A later successful retry clears it again.
 * @returns {string[]} kinds whose last save failed
 */
export function syncArcadePersistenceFailures(runtime) {
    const failures = [
        ...(runtime?._persistenceScheduler?.getFailedKinds?.() || []),
        ...(runtime?._ghostLibrarySaveFailed === true ? ['ghostLibrary'] : []),
    ];
    const summary = runtime?._state?.postRunSummary;
    if (summary && typeof summary === 'object') {
        if (failures.length > 0) summary.saveFailures = failures;
        else delete summary.saveFailures;
        const scheduler = runtime._persistenceScheduler;
        const blocked = failures.filter((kind) => isArcadeSaveBlockedByDamagedRecord(kind,
            scheduler?.getPendingStore?.(kind), scheduler?.getLastFailure?.(kind)));
        if (blocked.length > 0) summary.saveBlockedKinds = blocked;
        else delete summary.saveBlockedKinds;
    }
    return failures;
}

function watchArcadePersistenceFailures(runtime) {
    // Also covers throttled timer flushes, which no caller here sees.
    runtime?._persistenceScheduler?.setFlushResultListener?.(() => syncArcadePersistenceFailures(runtime));
}

export function scheduleArcadeVehicleProfilesSave(runtime) {
    watchArcadePersistenceFailures(runtime);
    const store = resolveArcadeSettingsRecordStore(runtime);
    return runtime._persistenceScheduler?.scheduleVehicleProfiles?.(store, runtime._vehicleProfiles) === true;
}

export function scheduleArcadeLeaderboardSave(runtime) {
    watchArcadePersistenceFailures(runtime);
    const store = resolveArcadeSettingsRecordStore(runtime);
    return runtime._persistenceScheduler?.scheduleLeaderboard?.(store, runtime._leaderboard) === true;
}

export function readArcadeRecordsFromStorage(runtime, config = runtime._config) {
    const store = resolveArcadeSettingsRecordStore(runtime);
    if (!store || typeof store.loadJsonRecord !== 'function') {
        return createArcadeRunRecords(runtime._records);
    }
    return createArcadeRunRecords(store.loadJsonRecord(resolveArcadeRunProfileStorageKey(config), null));
}

export function scheduleArcadeRecordsSave(runtime, records = runtime._records, onPersisted = null) {
    watchArcadePersistenceFailures(runtime);
    const store = resolveArcadeSettingsRecordStore(runtime);
    if (!store || typeof store.saveJsonRecord !== 'function') return false;
    return runtime._persistenceScheduler?.scheduleRunRecords?.(
        store,
        resolveArcadeRunProfileStorageKey(runtime._state?.config || runtime._config),
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
    let saved = false;
    try {
        const saveResult = saveGhostLibrary(pending.store, pending.ghostLibrary, pending.budgetOptions);
        saved = saveResult === undefined || saveResult === true || saveResult?.success === true;
        if (saved) runtime._pendingGhostLibrarySave = null;
    } catch (error) {
        runtime.logger?.warn?.('[ArcadeRunPersistenceOps] ghost library save failed:', error);
    }
    runtime._ghostLibrarySaveFailed = !saved;
    syncArcadePersistenceFailures(runtime);
    return saved;
}

export function flushArcadePersistenceSaves(runtime) {
    watchArcadePersistenceFailures(runtime);
    const flushedArcadeSaves = runtime._persistenceScheduler?.flushAll?.() === true;
    const flushedGhostSaves = flushPendingGhostLibrarySave(runtime);
    return flushedArcadeSaves || flushedGhostSaves;
}

export function flushArcadePersistenceSavesResult(runtime) {
    watchArcadePersistenceFailures(runtime);
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

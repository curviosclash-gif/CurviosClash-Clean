import { saveLeaderboard } from '../../state/arcade/ArcadeLeaderboard.js';
import { saveVehicleProfiles } from '../../state/arcade/ArcadeVehicleProfile.js';
import { shareArcadeVehicleProfileBase } from '../../state/arcade/ArcadeVehicleProfileMerge.js';

const SAVE_KINDS = Object.freeze({
    LEADERBOARD: 'leaderboard',
    RUN_RECORDS: 'runRecords',
    VEHICLE_PROFILES: 'vehicleProfiles',
});

function normalizeThrottleMs(value, fallback = 0) {
    const numeric = Math.trunc(Number(value));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function clonePlainSnapshot(value) {
    if (!value || typeof value !== 'object') return value;
    try {
        const snapshot = JSON.parse(JSON.stringify(value));
        // A vehicle profile snapshot shares the live map's merge base, so a deferred save applies
        // only this run's own changes and advances the base the live map sees.
        shareArcadeVehicleProfileBase(snapshot, value);
        return snapshot;
    } catch {
        return value;
    }
}

function isPersisted(saveResult) {
    return saveResult === undefined || saveResult === true || saveResult?.success === true || saveResult?.ok === true;
}

export class ArcadeRunPersistenceScheduler {
    constructor(options = {}) {
        this.saveThrottleMs = normalizeThrottleMs(options.saveThrottleMs, 0);
        this.logger = options.logger || console;
        this._setTimeout = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout.bind(globalThis);
        this._clearTimeout = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout.bind(globalThis);
        this._pendingSaves = new Map();
        this._timers = new Map();
        this._failedKinds = new Set();
        this._pendingStores = new Map();
        this._lastFailures = new Map();
        this._onFlushResult = typeof options.onFlushResult === 'function' ? options.onFlushResult : null;
    }

    _clearTimer(kind) {
        const timer = this._timers.get(kind);
        if (timer == null) return;
        this._clearTimeout(timer);
        this._timers.delete(kind);
    }

    /** Kinds whose last save the store rejected; they stay pending and retry on the next flush. */
    getFailedKinds() {
        return Array.from(this._failedKinds);
    }

    /** Called after every flush attempt with { kind, ok }, also for throttled timer flushes. */
    setFlushResultListener(listener) {
        this._onFlushResult = typeof listener === 'function' ? listener : null;
    }

    _schedule(kind, task, store = null) {
        if (!kind || typeof task !== 'function') return false;
        this._pendingSaves.set(kind, task);
        if (store) this._pendingStores.set(kind, store);
        if (this.saveThrottleMs <= 0) {
            return this.flush(kind);
        }
        if (this._timers.has(kind)) {
            return true;
        }
        const timer = this._setTimeout(() => {
            this._timers.delete(kind);
            this.flush(kind);
        }, this.saveThrottleMs);
        this._timers.set(kind, timer);
        return true;
    }

    flush(kind) {
        this._clearTimer(kind);
        const task = this._pendingSaves.get(kind);
        if (typeof task !== 'function') return false;
        let saved = false;
        let result = null;
        try {
            result = task();
            saved = isPersisted(result);
            if (!saved) this.logger?.warn?.('[ArcadeRunPersistenceScheduler] save was not acknowledged', { kind });
        } catch (error) {
            this.logger?.warn?.('[ArcadeRunPersistenceScheduler] save failed:', error);
        }
        if (saved) {
            this._pendingSaves.delete(kind);
            this._pendingStores.delete(kind);
            this._lastFailures.delete(kind);
            this._failedKinds.delete(kind);
        } else {
            this._failedKinds.add(kind);
            this._lastFailures.set(kind, result);
        }
        this._onFlushResult?.({ kind, ok: saved });
        return saved;
    }

    flushAll() {
        const pendingKinds = Array.from(this._pendingSaves.keys());
        if (pendingKinds.length === 0) return false;
        let allFlushed = true;
        for (const kind of pendingKinds) {
            allFlushed = this.flush(kind) && allFlushed;
        }
        return allFlushed;
    }

    flushAllResult() {
        const pendingKinds = Array.from(this._pendingSaves.keys());
        const failures = [];
        for (const kind of pendingKinds) {
            if (!this.flush(kind)) failures.push(kind);
        }
        return {
            ok: failures.length === 0,
            hadPending: pendingKinds.length > 0,
            failures,
        };
    }

    dispose() {
        for (const kind of Array.from(this._timers.keys())) {
            this._clearTimer(kind);
        }
        this._pendingSaves.clear();
        this._pendingStores.clear();
        this._lastFailures.clear();
    }

    /** The store a pending save of kind writes to, when the schedule call named one. */
    getPendingStore(kind) {
        return this._pendingStores.get(kind) || null;
    }

    /** The result the store returned for the last failed save of kind (null when it threw). */
    getLastFailure(kind) {
        return this._lastFailures.get(kind) ?? null;
    }

    /**
     * Drops failed saves that can never succeed (isPermanent(kind, store, lastFailure)), so they stop blocking the
     * next run; the store keeps refusing them, so nothing it holds is overwritten. Returns their kinds.
     */
    releaseFailedKinds(isPermanent) {
        if (typeof isPermanent !== 'function') return [];
        const released = [];
        for (const kind of Array.from(this._failedKinds)) {
            if (!isPermanent(kind, this.getPendingStore(kind), this.getLastFailure(kind))) continue;
            this._clearTimer(kind);
            this._pendingSaves.delete(kind);
            this._pendingStores.delete(kind);
            this._lastFailures.delete(kind);
            this._failedKinds.delete(kind);
            released.push(kind);
        }
        return released;
    }

    // slot: own pending save per store, so a split-screen partner's profiles never replace player one's.
    scheduleVehicleProfiles(store, profiles, slot = '') {
        if (!store || typeof store.saveJsonRecord !== 'function') return false;
        const snapshot = clonePlainSnapshot(profiles);
        const kind = slot ? `${SAVE_KINDS.VEHICLE_PROFILES}:${slot}` : SAVE_KINDS.VEHICLE_PROFILES;
        // XP that another writer (hangar, weapon-race prize) stored meanwhile is kept by the
        // three-way merge in saveVehicleProfiles; adding it here as well would count it twice.
        return this._schedule(kind, () => {
            return saveVehicleProfiles(store, snapshot);
        }, store);
    }

    scheduleLeaderboard(store, leaderboard) {
        if (!store || typeof store.saveJsonRecord !== 'function') return false;
        const snapshot = clonePlainSnapshot(leaderboard);
        return this._schedule(SAVE_KINDS.LEADERBOARD, () => {
            return saveLeaderboard(store, snapshot);
        });
    }

    scheduleRunRecords(store, storageKey, records, normalizeRecords = null, onPersisted = null) {
        if (!store || typeof store.saveJsonRecord !== 'function') return false;
        const key = String(storageKey || '').trim();
        if (!key) return false;
        const snapshot = clonePlainSnapshot(
            typeof normalizeRecords === 'function' ? normalizeRecords(records) : records
        );
        return this._schedule(SAVE_KINDS.RUN_RECORDS, () => {
            const saveResult = store.saveJsonRecord(key, clonePlainSnapshot(snapshot));
            if (isPersisted(saveResult)) {
                onPersisted?.();
                return saveResult;
            }
            this.logger?.warn?.('[ArcadeRunPersistenceScheduler] run records save failed', {
                reason: String(saveResult?.reason || ''),
                metadata: saveResult?.metadata && typeof saveResult.metadata === 'object'
                    ? { ...saveResult.metadata }
                    : null,
            });
            return saveResult;
        });
    }
}

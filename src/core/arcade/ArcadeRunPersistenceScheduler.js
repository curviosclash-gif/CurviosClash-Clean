import { saveLeaderboard } from '../../state/arcade/ArcadeLeaderboard.js';
import { saveVehicleProfiles } from '../../state/arcade/ArcadeVehicleProfile.js';

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
        return JSON.parse(JSON.stringify(value));
    } catch {
        return value;
    }
}

function isPersisted(saveResult) {
    return saveResult === undefined || saveResult === true || saveResult?.success === true;
}

export class ArcadeRunPersistenceScheduler {
    constructor(options = {}) {
        this.saveThrottleMs = normalizeThrottleMs(options.saveThrottleMs, 0);
        this.logger = options.logger || console;
        this._setTimeout = typeof options.setTimeout === 'function' ? options.setTimeout : setTimeout.bind(globalThis);
        this._clearTimeout = typeof options.clearTimeout === 'function' ? options.clearTimeout : clearTimeout.bind(globalThis);
        this._pendingSaves = new Map();
        this._timers = new Map();
    }

    _clearTimer(kind) {
        const timer = this._timers.get(kind);
        if (timer == null) return;
        this._clearTimeout(timer);
        this._timers.delete(kind);
    }

    _schedule(kind, task) {
        if (!kind || typeof task !== 'function') return false;
        this._pendingSaves.set(kind, task);
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
        this._pendingSaves.delete(kind);
        try {
            task();
            return true;
        } catch (error) {
            this.logger?.warn?.('[ArcadeRunPersistenceScheduler] save failed:', error);
            return false;
        }
    }

    flushAll() {
        let flushed = false;
        for (const kind of Array.from(this._pendingSaves.keys())) {
            flushed = this.flush(kind) || flushed;
        }
        return flushed;
    }

    dispose() {
        for (const kind of Array.from(this._timers.keys())) {
            this._clearTimer(kind);
        }
        this._pendingSaves.clear();
    }

    scheduleVehicleProfiles(store, profiles) {
        if (!store || typeof store.saveJsonRecord !== 'function') return false;
        const snapshot = clonePlainSnapshot(profiles);
        return this._schedule(SAVE_KINDS.VEHICLE_PROFILES, () => {
            saveVehicleProfiles(store, snapshot);
        });
    }

    scheduleLeaderboard(store, leaderboard) {
        if (!store || typeof store.saveJsonRecord !== 'function') return false;
        const snapshot = clonePlainSnapshot(leaderboard);
        return this._schedule(SAVE_KINDS.LEADERBOARD, () => {
            saveLeaderboard(store, snapshot);
        });
    }

    scheduleRunRecords(store, storageKey, records, normalizeRecords = null) {
        if (!store || typeof store.saveJsonRecord !== 'function') return false;
        const key = String(storageKey || '').trim();
        if (!key) return false;
        const snapshot = clonePlainSnapshot(
            typeof normalizeRecords === 'function' ? normalizeRecords(records) : records
        );
        return this._schedule(SAVE_KINDS.RUN_RECORDS, () => {
            const saveResult = store.saveJsonRecord(key, clonePlainSnapshot(snapshot));
            if (isPersisted(saveResult)) return;
            this.logger?.warn?.('[ArcadeRunPersistenceScheduler] run records save failed', {
                reason: String(saveResult?.reason || ''),
                metadata: saveResult?.metadata && typeof saveResult.metadata === 'object'
                    ? { ...saveResult.metadata }
                    : null,
            });
        });
    }
}

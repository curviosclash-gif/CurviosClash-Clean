import {
    AUTHORING_TELEMETRY_MAX_RECENT_SESSIONS,
    AUTHORING_TELEMETRY_STORAGE_KEY,
    createAuthoringTelemetryState,
    normalizeAuthoringTelemetryDelta,
    normalizeAuthoringTelemetrySession,
    normalizeAuthoringTelemetryState,
    normalizeAuthoringTelemetryTool,
} from '../shared/contracts/AuthoringTelemetryContract.js';
import { createDefaultStoragePlatform } from '../shared/storage/StoragePlatform.js';

function mergeCounts(target, delta) {
    Object.entries(delta || {}).forEach(([key, value]) => {
        target[key] = Math.max(0, Number(target[key]) || 0) + Math.max(0, Number(value) || 0);
    });
}

export class AuthoringTelemetryStore {
    constructor(options = {}) {
        this.storageKey = String(options.storageKey || AUTHORING_TELEMETRY_STORAGE_KEY);
        this.storagePlatform = options.storagePlatform || createDefaultStoragePlatform({
            storage: options.storage,
            runtimeGlobal: options.runtimeGlobal || globalThis,
        });
    }

    getSnapshot() {
        const stored = this.storagePlatform.readJson(this.storageKey, [], null);
        return stored ? normalizeAuthoringTelemetryState(stored) : createAuthoringTelemetryState();
    }

    _save(state) {
        const normalized = normalizeAuthoringTelemetryState(state);
        normalized.updatedAt = new Date().toISOString();
        return this.storagePlatform.writeJson(this.storageKey, normalized).ok === true;
    }

    recordDelta(toolValue, deltaValue = null) {
        const tool = normalizeAuthoringTelemetryTool(toolValue);
        if (!tool) return false;
        const delta = normalizeAuthoringTelemetryDelta(deltaValue);
        const state = this.getSnapshot();
        const summary = state.tools[tool];
        summary.activeDurationMs += delta.durationActiveMs;
        mergeCounts(summary.counters, delta.counters);
        mergeCounts(summary.outcomes, delta.outcomes);
        mergeCounts(summary.errors, delta.errors);
        summary.lastSeenAt = new Date().toISOString();
        return this._save(state);
    }

    recordSession(sessionValue = null) {
        const session = normalizeAuthoringTelemetrySession(sessionValue);
        if (!session) return false;
        const state = this.getSnapshot();
        const summary = state.tools[session.tool];
        summary.sessions += 1;
        if (session.completed) summary.completedSessions += 1;
        summary.lastSeenAt = session.endedAt || new Date().toISOString();
        state.recentSessions.push(session);
        if (state.recentSessions.length > AUTHORING_TELEMETRY_MAX_RECENT_SESSIONS) {
            state.recentSessions = state.recentSessions.slice(-AUTHORING_TELEMETRY_MAX_RECENT_SESSIONS);
        }
        return this._save(state);
    }

    clear() {
        return this._save(createAuthoringTelemetryState());
    }
}

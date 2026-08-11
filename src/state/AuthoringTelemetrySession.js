import {
    AUTHORING_TELEMETRY_COUNTERS,
    AUTHORING_TELEMETRY_ERRORS,
    AUTHORING_TELEMETRY_OUTCOMES,
    normalizeAuthoringTelemetryTool,
} from '../shared/contracts/AuthoringTelemetryContract.js';
import { AuthoringTelemetryStore } from './AuthoringTelemetryStore.js';

const COUNTERS = new Set(AUTHORING_TELEMETRY_COUNTERS);
const OUTCOMES = new Set(AUTHORING_TELEMETRY_OUTCOMES);
const ERRORS = new Set(AUTHORING_TELEMETRY_ERRORS);
const COMPLETION_OUTCOMES = new Set(['save_succeeded', 'export_succeeded', 'publish_succeeded']);

function increment(target, key, count) {
    const parsed = Number(count);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    target[key] = (target[key] || 0) + Math.floor(parsed);
}

function cloneCounts(source) {
    return { ...source };
}

function resolvePlatform(runtimeGlobal) {
    const userAgent = String(runtimeGlobal?.navigator?.userAgent || '');
    return /electron/i.test(userAgent) || runtimeGlobal?.electronAPI ? 'desktop' : 'browser';
}

export class AuthoringTelemetrySession {
    constructor(options = {}) {
        this.tool = normalizeAuthoringTelemetryTool(options.tool);
        this.store = options.store || new AuthoringTelemetryStore({ runtimeGlobal: options.runtimeGlobal });
        this.runtimeGlobal = options.runtimeGlobal || globalThis;
        this.documentRef = options.documentRef || this.runtimeGlobal?.document || null;
        this.now = typeof options.now === 'function' ? options.now : () => Date.now();
        this.startedAtMs = this.now();
        this.activeStartedAtMs = this.documentRef?.visibilityState === 'hidden' ? null : this.startedAtMs;
        this.activeDurationMs = 0;
        this.pendingDurationMs = 0;
        this.counters = {};
        this.outcomes = {};
        this.errors = {};
        this.pendingCounters = {};
        this.pendingOutcomes = {};
        this.pendingErrors = {};
        this.ended = false;
        this.platform = options.platform || resolvePlatform(this.runtimeGlobal);
        this._onVisibilityChange = () => this._handleVisibilityChange();
        this._onPageHide = () => this.end({ completed: this.outcomes.completed === true });
        this.documentRef?.addEventListener?.('visibilitychange', this._onVisibilityChange);
        this.runtimeGlobal?.addEventListener?.('pagehide', this._onPageHide, { once: true });
    }

    _captureActiveDuration() {
        if (this.activeStartedAtMs === null) return;
        const elapsed = Math.max(0, this.now() - this.activeStartedAtMs);
        this.activeDurationMs += elapsed;
        this.pendingDurationMs += elapsed;
        this.activeStartedAtMs = this.now();
    }

    _handleVisibilityChange() {
        if (this.ended) return;
        if (this.documentRef?.visibilityState === 'hidden') {
            this._captureActiveDuration();
            this.activeStartedAtMs = null;
            this.flush();
            return;
        }
        if (this.activeStartedAtMs === null) this.activeStartedAtMs = this.now();
    }

    recordCounter(code, count = 1) {
        if (this.ended || !COUNTERS.has(code)) return false;
        increment(this.counters, code, count);
        increment(this.pendingCounters, code, count);
        return true;
    }

    recordOutcome(code, passed = true, { flush = false } = {}) {
        if (this.ended || !OUTCOMES.has(code)) return false;
        this.outcomes[code] = passed === true;
        increment(this.pendingOutcomes, code, passed === true ? 1 : 0);
        if (passed === true && COMPLETION_OUTCOMES.has(code) && this.outcomes.completed !== true) {
            this.outcomes.completed = true;
            increment(this.pendingOutcomes, 'completed', 1);
        }
        if (flush) this.flush();
        return true;
    }

    recordError(code, count = 1, { flush = true } = {}) {
        if (this.ended || !ERRORS.has(code)) return false;
        increment(this.errors, code, count);
        increment(this.pendingErrors, code, count);
        if (flush) this.flush();
        return true;
    }

    flush() {
        if (this.ended || !this.tool) return false;
        this._captureActiveDuration();
        const delta = {
            durationActiveMs: this.pendingDurationMs,
            counters: cloneCounts(this.pendingCounters),
            outcomes: cloneCounts(this.pendingOutcomes),
            errors: cloneCounts(this.pendingErrors),
        };
        const hasDelta = delta.durationActiveMs > 0
            || Object.keys(delta.counters).length > 0
            || Object.keys(delta.outcomes).length > 0
            || Object.keys(delta.errors).length > 0;
        if (!hasDelta) return true;
        const saved = this.store.recordDelta(this.tool, delta);
        if (saved) {
            this.pendingDurationMs = 0;
            this.pendingCounters = {};
            this.pendingOutcomes = {};
            this.pendingErrors = {};
        }
        return saved;
    }

    end({ completed = false } = {}) {
        if (this.ended || !this.tool) return false;
        if (completed && this.outcomes.completed !== true) this.recordOutcome('completed', true);
        this._captureActiveDuration();
        this.flush();
        this.ended = true;
        this.documentRef?.removeEventListener?.('visibilitychange', this._onVisibilityChange);
        this.runtimeGlobal?.removeEventListener?.('pagehide', this._onPageHide);
        return this.store.recordSession({
            tool: this.tool,
            platform: this.platform,
            startedAt: new Date(this.startedAtMs).toISOString(),
            endedAt: new Date(this.now()).toISOString(),
            durationActiveMs: this.activeDurationMs,
            completed: completed || this.outcomes.completed === true,
            counters: this.counters,
            outcomes: this.outcomes,
            errors: this.errors,
        });
    }
}

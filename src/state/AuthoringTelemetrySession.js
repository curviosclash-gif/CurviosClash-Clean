import {
    AUTHORING_TELEMETRY_COUNTERS,
    AUTHORING_TELEMETRY_ERRORS,
    AUTHORING_TELEMETRY_OUTCOMES,
    normalizeAuthoringTelemetryDelta,
    normalizeAuthoringTelemetrySession,
    normalizeAuthoringTelemetryTool,
} from '../shared/contracts/AuthoringTelemetryContract.js';
import { AuthoringTelemetryStore } from './AuthoringTelemetryStore.js';

const COUNTERS = new Set(AUTHORING_TELEMETRY_COUNTERS);
const OUTCOMES = new Set(AUTHORING_TELEMETRY_OUTCOMES);
const ERRORS = new Set(AUTHORING_TELEMETRY_ERRORS);
const COMPLETION_OUTCOMES = new Set(['save_succeeded', 'export_succeeded', 'publish_succeeded']);
const LOCAL_WORKFLOW_ENDPOINT = 'http://127.0.0.1:4318/v1/authoring';
const LOCAL_WORKFLOW_SCHEMA_VERSION = 'codex-workflow.authoring.v1';

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

function createSessionId(runtimeGlobal, startedAtMs) {
    try {
        const id = runtimeGlobal?.crypto?.randomUUID?.();
        if (id) return id;
    } catch {
        // A local correlation ID does not need to block authoring startup.
    }
    return `${startedAtMs.toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function createLocalLifecycleSink(runtimeGlobal) {
    const navigatorRef = runtimeGlobal?.navigator;
    if (navigatorRef?.webdriver === true) return null;
    const sendBeacon = navigatorRef?.sendBeacon;
    const BlobRef = runtimeGlobal?.Blob;
    if (typeof sendBeacon === 'function' && typeof BlobRef === 'function') {
        return (payload) => {
            const body = new BlobRef([JSON.stringify(payload)], { type: 'text/plain;charset=UTF-8' });
            return sendBeacon.call(navigatorRef, LOCAL_WORKFLOW_ENDPOINT, body);
        };
    }

    const fetchRef = runtimeGlobal?.fetch;
    if (typeof fetchRef === 'function') {
        return (payload) => {
            void fetchRef.call(runtimeGlobal, LOCAL_WORKFLOW_ENDPOINT, {
                method: 'POST',
                mode: 'no-cors',
                keepalive: true,
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                body: JSON.stringify(payload),
            }).catch(() => {});
            return true;
        };
    }
    return null;
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
        this.sessionId = String(options.sessionId || createSessionId(this.runtimeGlobal, this.startedAtMs));
        this.lifecycleSink = typeof options.lifecycleSink === 'function'
            ? options.lifecycleSink
            : createLocalLifecycleSink(this.runtimeGlobal);
        this._onVisibilityChange = () => this._handleVisibilityChange();
        this._onPageHide = () => this.end({ completed: this.outcomes.completed === true });
        this.documentRef?.addEventListener?.('visibilitychange', this._onVisibilityChange);
        this.runtimeGlobal?.addEventListener?.('pagehide', this._onPageHide, { once: true });
        this._emitLifecycle('started', {
            startedAt: new Date(this.startedAtMs).toISOString(),
        });
    }

    _emitLifecycle(event, data = {}) {
        if (!this.lifecycleSink || !this.tool) return false;
        try {
            return this.lifecycleSink({
                schemaVersion: LOCAL_WORKFLOW_SCHEMA_VERSION,
                event,
                sessionId: this.sessionId,
                tool: this.tool,
                platform: this.platform,
                ...data,
            }) !== false;
        } catch {
            return false;
        }
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
            this._emitLifecycle('activity', normalizeAuthoringTelemetryDelta(delta));
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
        const summary = normalizeAuthoringTelemetrySession({
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
        const saved = this.store.recordSession(summary);
        this._emitLifecycle('ended', summary);
        return saved;
    }
}

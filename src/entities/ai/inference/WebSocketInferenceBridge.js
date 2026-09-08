import { clamp } from '../../../shared/utils/MathOps.js';

function boundedInt(value, fallback, min, max) {
    const numeric = Number(value);
    return Number.isFinite(numeric)
        ? Math.max(min, Math.min(max, Math.trunc(numeric)))
        : fallback;
}

function createTelemetry() {
    return {
        requestsSent: 0,
        actionRequests: 0,
        responsesReceived: 0,
        actionResponses: 0,
        retries: 0,
        timeouts: 0,
        failures: 0,
        fallbacks: 0,
        readyMessages: 0,
        actionDrops: 0,
        actionSendSkipped: 0,
        latencySamplesMs: [],
        lastFailure: null,
        lastFallbackReason: null,
    };
}

function cloneTelemetry(state, pendingActionRequest) {
    const samples = [...state.latencySamplesMs].sort((left, right) => left - right);
    const total = samples.reduce((sum, value) => sum + value, 0);
    const p95Index = samples.length > 0
        ? Math.min(samples.length - 1, Math.max(0, Math.ceil(samples.length * 0.95) - 1))
        : -1;
    const snapshot = { ...state };
    delete snapshot.latencySamplesMs;
    return {
        ...snapshot,
        latencySampleCount: samples.length,
        latencyMeanMs: samples.length > 0 ? total / samples.length : null,
        latencyP95Ms: p95Index >= 0 ? samples[p95Index] : null,
        latencyMinMs: samples.length > 0 ? samples[0] : null,
        latencyMaxMs: samples.length > 0 ? samples[samples.length - 1] : null,
        lastLatencyMs: samples.length > 0 ? state.latencySamplesMs[state.latencySamplesMs.length - 1] : null,
        pendingActionRequest,
    };
}

export class WebSocketInferenceBridge {
    constructor(options = {}) {
        this.enabled = options.enabled === true;
        this.url = typeof options.url === 'string' && options.url.trim()
            ? options.url.trim()
            : 'ws://127.0.0.1:8765';
        this.timeoutMs = clamp(options.timeoutMs, 20, 10_000);
        this.maxRetries = boundedInt(options.maxRetries, 1, 0, 5);
        this.retryDelayMs = clamp(options.retryDelayMs, 0, 1_000);
        this.requireReadyMessage = options.requireReadyMessage !== false;
        this.readyMessageTypes = new Set([
            'inference-ready',
            'trainer-ready',
            typeof options.readyMessageType === 'string'
                ? options.readyMessageType.trim().toLowerCase()
                : '',
        ].filter(Boolean));
        this._socketFactory = typeof options.socketFactory === 'function' ? options.socketFactory : null;
        this._now = typeof options.now === 'function' ? options.now : () => Date.now();
        this._socket = null;
        this._nextRequestId = 1;
        this._pendingRequest = null;
        this._queuedObservation = null;
        this._latestAction = null;
        this._latestFailure = null;
        this._latestReadyPayload = null;
        this._isReady = false;
        this._telemetry = createTelemetry();
        this._handlers = null;
    }

    _openState() {
        return typeof WebSocket === 'function' && Number.isInteger(WebSocket.OPEN) ? WebSocket.OPEN : 1;
    }

    _connectingState() {
        return typeof WebSocket === 'function' && Number.isInteger(WebSocket.CONNECTING) ? WebSocket.CONNECTING : 0;
    }

    _addListener(socket, type, handler) {
        if (typeof socket?.addEventListener === 'function') socket.addEventListener(type, handler);
        else if (typeof socket?.on === 'function') socket.on(type, handler);
    }

    _removeListener(socket, type, handler) {
        if (typeof socket?.removeEventListener === 'function') socket.removeEventListener(type, handler);
        else if (typeof socket?.off === 'function') socket.off(type, handler);
        else if (typeof socket?.removeListener === 'function') socket.removeListener(type, handler);
    }

    _recordFailure(reason) {
        const normalized = String(reason || 'inference-bridge-error');
        this._latestFailure = normalized;
        this._telemetry.failures += 1;
        this._telemetry.lastFailure = normalized;
    }

    _attach(socket) {
        const handlers = {
            open: () => {
                if (!this.requireReadyMessage) this._isReady = true;
                this._flushQueuedObservation();
            },
            message: (event) => this._handleMessage(event),
            error: () => {
                this._isReady = false;
                this._pendingRequest = null;
                this._recordFailure('socket-error');
            },
            close: () => {
                this._isReady = false;
                this._pendingRequest = null;
                this._recordFailure('socket-closed');
            },
        };
        this._handlers = handlers;
        Object.entries(handlers).forEach(([type, handler]) => this._addListener(socket, type, handler));
    }

    _detach() {
        if (!this._socket || !this._handlers) return;
        Object.entries(this._handlers).forEach(([type, handler]) => this._removeListener(this._socket, type, handler));
        this._handlers = null;
    }

    _ensureSocket() {
        if (!this.enabled) return null;
        const openState = this._openState();
        const connectingState = this._connectingState();
        if (this._socket?.readyState === openState || this._socket?.readyState === connectingState) {
            return this._socket;
        }
        if (typeof WebSocket !== 'function' && !this._socketFactory) {
            this._recordFailure('websocket-unavailable');
            return null;
        }
        try {
            const socket = this._socketFactory ? this._socketFactory(this.url) : new WebSocket(this.url);
            if (!socket || (typeof socket.addEventListener !== 'function' && typeof socket.on !== 'function')) {
                this._recordFailure('socket-create-failed');
                return null;
            }
            this._socket = socket;
            this._isReady = !this.requireReadyMessage && socket.readyState === openState;
            this._attach(socket);
            return socket;
        } catch (error) {
            this._recordFailure(error?.message || 'socket-create-failed');
            return null;
        }
    }

    _parseMessage(event) {
        const raw = event?.data ?? event;
        if (raw == null) return null;
        try {
            return typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(String(raw));
        } catch {
            this._recordFailure('invalid-json');
            return null;
        }
    }

    _handleMessage(event) {
        const parsed = this._parseMessage(event);
        if (!parsed) return;
        const responseType = typeof parsed.type === 'string' ? parsed.type.trim().toLowerCase() : '';
        if (this.readyMessageTypes.has(responseType)) {
            this._isReady = true;
            this._latestReadyPayload = parsed;
            this._telemetry.readyMessages += 1;
            this._flushQueuedObservation();
            return;
        }
        const responseId = Number(parsed.id);
        if (!this._pendingRequest || responseId !== this._pendingRequest.id) return;
        const pending = this._pendingRequest;
        this._pendingRequest = null;
        this._telemetry.responsesReceived += 1;
        const latency = Math.max(0, Math.trunc(clamp(this._now() - pending.sentAt, 0, 60_000)));
        this._telemetry.latencySamplesMs.push(latency);
        if (this._telemetry.latencySamplesMs.length > 128) this._telemetry.latencySamplesMs.shift();
        const action = parsed.action ?? parsed?.payload?.action ?? null;
        if (action && typeof action === 'object') {
            this._latestAction = action;
            this._telemetry.actionResponses += 1;
        } else {
            this._recordFailure('missing-action');
        }
        this._flushQueuedObservation();
    }

    _canSend() {
        return this._socket?.readyState === this._openState()
            && (this._isReady || !this.requireReadyMessage)
            && !this._pendingRequest;
    }

    _sendObservation(payload) {
        if (!this._canSend()) return false;
        const id = this._nextRequestId;
        this._nextRequestId += 1;
        const envelope = { type: 'bot-action-request', id, payload };
        let serialized;
        try {
            serialized = JSON.stringify(envelope);
            this._socket.send(serialized);
        } catch {
            this._recordFailure('send-failed');
            return false;
        }
        const now = this._now();
        this._pendingRequest = {
            id,
            serialized,
            sentAt: now,
            retryAt: now + this.timeoutMs + this.retryDelayMs,
            retries: 0,
        };
        this._telemetry.requestsSent += 1;
        this._telemetry.actionRequests += 1;
        return true;
    }

    _queueObservation(payload) {
        if (this._queuedObservation) this._telemetry.actionDrops += 1;
        this._queuedObservation = payload;
        this._telemetry.actionSendSkipped += 1;
    }

    _flushQueuedObservation() {
        if (!this._queuedObservation || !this._canSend()) return false;
        const queued = this._queuedObservation;
        this._queuedObservation = null;
        if (this._sendObservation(queued)) return true;
        this._queuedObservation = queued;
        return false;
    }

    _handleTimeout() {
        const pending = this._pendingRequest;
        if (!pending || this._now() - pending.sentAt <= this.timeoutMs) return;
        this._telemetry.timeouts += 1;
        if (pending.retries < this.maxRetries && this._now() >= pending.retryAt) {
            try {
                this._socket.send(pending.serialized);
                pending.retries += 1;
                pending.sentAt = this._now();
                pending.retryAt = pending.sentAt + this.timeoutMs + this.retryDelayMs;
                this._telemetry.retries += 1;
                return;
            } catch {
                this._recordFailure('send-failed');
            }
        }
        this._pendingRequest = null;
        this._recordFailure('timeout');
        this._flushQueuedObservation();
    }

    submitObservation(payload) {
        this._ensureSocket();
        this._handleTimeout();
        if (!this._sendObservation(payload)) this._queueObservation(payload);
    }

    waitForReady(timeoutMs = this.timeoutMs) {
        if (!this.enabled) return Promise.resolve(false);
        const socket = this._ensureSocket();
        if (!socket) return Promise.resolve(false);
        if (socket.readyState === this._openState() && (this._isReady || !this.requireReadyMessage)) {
            return Promise.resolve(true);
        }
        const timeout = clamp(timeoutMs, 20, 30_000);
        return new Promise((resolve) => {
            const startedAt = this._now();
            const poll = () => {
                if (socket.readyState === this._openState() && (this._isReady || !this.requireReadyMessage)) {
                    resolve(true);
                    return;
                }
                if (this._now() - startedAt >= timeout || socket.readyState > this._openState()) {
                    this._recordFailure('ready-timeout');
                    resolve(false);
                    return;
                }
                setTimeout(poll, 5);
            };
            poll();
        });
    }

    consumeLatestAction() {
        const action = this._latestAction;
        this._latestAction = null;
        return action;
    }

    consumeLatestReadyPayload() {
        const payload = this._latestReadyPayload;
        this._latestReadyPayload = null;
        return payload;
    }

    consumeFailure() {
        this._handleTimeout();
        const failure = this._latestFailure;
        this._latestFailure = null;
        return failure;
    }

    recordFallback(reason = 'external-fallback') {
        this._telemetry.fallbacks += 1;
        this._telemetry.lastFallbackReason = String(reason || 'external-fallback');
    }

    getTelemetrySnapshot() {
        this._handleTimeout();
        return cloneTelemetry(this._telemetry, this._pendingRequest !== null);
    }

    resetTelemetry() {
        this._telemetry = createTelemetry();
    }

    close() {
        if (this._socket) {
            this._detach();
            try {
                this._socket.close();
            } catch {
                // A failed close must not block the local fallback policy.
            }
        }
        this._socket = null;
        this._pendingRequest = null;
        this._queuedObservation = null;
        this._latestAction = null;
        this._latestReadyPayload = null;
        this._isReady = false;
    }
}

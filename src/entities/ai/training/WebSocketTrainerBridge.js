// ============================================
// WebSocketTrainerBridge.js - optional async trainer bridge with timeout/retry/error telemetry
// ============================================
import { TRAINING_CONTRACT_VERSION } from '../../../shared/contracts/TrainingRuntimeContract.js';
import { createTrainerTransportEnvelope } from './TrainerPayloadAdapter.js';
import {
    cloneTelemetrySnapshot,
    createTelemetryState,
    pushLatencySample,
    pushTelemetrySample,
} from './WebSocketTrainerBridgeTelemetry.js';
import { clamp } from '../../../utils/MathOps.js';
function toSafeUrl(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
function toNow(value) { return typeof value === 'function' ? value : () => Date.now(); }
const toBoundedInt = (value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) => (Number.isFinite(Number(value))
    ? Math.max(min, Math.min(max, Math.trunc(Number(value))))
    : fallback);
export class WebSocketTrainerBridge {
    constructor(options = {}) {
        this.enabled = !!options.enabled;
        this.url = toSafeUrl(options.url, 'ws://127.0.0.1:8765');
        this.timeoutMs = clamp(options.timeoutMs, 20, 10000);
        this.maxRetries = Math.trunc(clamp(options.maxRetries, 0, 5));
        this.retryDelayMs = clamp(options.retryDelayMs, 0, 1000);
        this.readyMessageType = typeof options.readyMessageType === 'string' && options.readyMessageType.trim()
            ? options.readyMessageType.trim()
            : 'trainer-ready';
        this.requireReadyMessage = options.requireReadyMessage !== false;
        this.maxPendingAcks = toBoundedInt(options.maxPendingAcks, 512, 1, 8192);
        this.maxPendingActionRequests = Math.min(this.maxPendingAcks, toBoundedInt(
            options.maxPendingActionRequests,
            2,
            1,
            this.maxPendingAcks
        ));
        this.backpressureThreshold = Math.min(this.maxPendingAcks, toBoundedInt(
            options.backpressureThreshold,
            Math.max(1, Math.floor(this.maxPendingAcks * 0.75)),
            1,
            this.maxPendingAcks
        ));
        this.dropTrainingPayloadWhenBacklogged = options.dropTrainingPayloadWhenBacklogged !== false;
        this._now = toNow(options.now);
        this._socketFactory = typeof options.socketFactory === 'function'
            ? options.socketFactory
            : null;
        this._socket = null;
        this._nextRequestId = 1;
        this._pendingActionRequests = new Map();
        this._pendingAcks = new Map();
        this._pendingCommands = new Map();
        this._latestQueuedActionRequest = null;
        this._flushLatestActionScheduled = false;
        this._latestAction = null;
        this._latestResponse = null;
        this._latestFailure = null;
        this._latestReadyPayload = null;
        this._isReady = false;
        this._telemetry = createTelemetryState();
        this._telemetry.maxPendingAcks = this.maxPendingAcks; this._telemetry.backpressureThreshold = this.backpressureThreshold;
        this._boundOpenHandler = null; this._boundMessageHandler = null; this._boundErrorHandler = null; this._boundCloseHandler = null;
    }
    _resolveOpenState() {
        return typeof WebSocket === 'function' && Number.isInteger(WebSocket.OPEN) ? WebSocket.OPEN : 1;
    }
    _resolveConnectingState() {
        return typeof WebSocket === 'function' && Number.isInteger(WebSocket.CONNECTING) ? WebSocket.CONNECTING : 0;
    }
    _recordFailure(reason) {
        const normalizedReason = String(reason || 'bridge-error');
        this._latestFailure = normalizedReason;
        this._telemetry.failures += 1;
        this._telemetry.lastFailure = normalizedReason;
    }
    _markReady(payload = null) {
        this._isReady = true;
        this._telemetry.readyMessages += 1;
        if (payload && typeof payload === 'object') {
            this._latestReadyPayload = payload;
        }
    }
    _markNotReady() {
        this._isReady = false;
    }
    _ingestTrainingTelemetry(parsed) {
        const training = parsed?.training;
        if (!training || typeof training !== 'object') {
            return;
        }
        this._telemetry.learningReports += 1;
        if (training.trained === true) {
            this._telemetry.learningUpdates += 1;
        }
        if (pushTelemetrySample(this._telemetry, 'lossSamples', 'lossTotal', training.loss, -1_000_000, 1_000_000)) {
            this._telemetry.latestLoss = Number(training.loss);
        }
        if (pushTelemetrySample(this._telemetry, 'epsilonSamples', 'epsilonTotal', training.epsilon, 0, 1)) {
            this._telemetry.latestEpsilon = Number(training.epsilon);
        }
        if (pushTelemetrySample(this._telemetry, 'replayFillSamples', 'replayFillTotal', training.replayFill, 0, 1)) {
            this._telemetry.latestReplayFill = Number(training.replayFill);
        }
        const optimizerSteps = Number(training.optimizerSteps);
        if (Number.isFinite(optimizerSteps)) {
            this._telemetry.maxOptimizerSteps = Math.max(
                this._telemetry.maxOptimizerSteps,
                Math.trunc(optimizerSteps)
            );
        }
    }
    _clearPending(options = {}) {
        this._pendingActionRequests.clear();
        if (options.flushLatest !== false) {
            this._flushLatestActionRequest();
        }
    }
    _queueLatestActionRequest(payload) {
        if (this._latestQueuedActionRequest) {
            this._telemetry.actionDrops += 1;
        }
        this._latestQueuedActionRequest = payload;
    }
    _flushLatestActionRequest() {
        if (!this._latestQueuedActionRequest) return false;
        if (!this._canSendRequest({ expectsAction: true })) return false;
        const queuedPayload = this._latestQueuedActionRequest;
        this._latestQueuedActionRequest = null;
        const sent = this._submitRequest('bot-action-request', queuedPayload, {
            expectsAction: true,
        });
        if (!sent) {
            this._latestQueuedActionRequest = queuedPayload;
            return false;
        }
        return true;
    }
    _scheduleLatestActionFlush() {
        if (this._flushLatestActionScheduled) return;
        this._flushLatestActionScheduled = true;
        const schedule = typeof queueMicrotask === 'function'
            ? queueMicrotask
            : (callback) => Promise.resolve().then(callback);
        schedule(() => {
            this._flushLatestActionScheduled = false;
            this._flushLatestActionRequest();
        });
    }
    _attachSocketHandlers(socket) {
        this._boundOpenHandler = () => {
            if (!this.requireReadyMessage) {
                this._markReady(null);
            }
        };
        this._boundMessageHandler = (event) => this._handleSocketMessage(event);
        this._boundErrorHandler = () => {
            this._markNotReady();
            this._recordFailure('socket-error');
            this._clearPending();
            this._resolvePendingCommands(null);
        };
        this._boundCloseHandler = () => {
            this._markNotReady();
            this._recordFailure('socket-closed');
            this._clearPending();
            this._resolvePendingCommands(null);
        };
        this._addSocketListener(socket, 'open', this._boundOpenHandler);
        this._addSocketListener(socket, 'message', this._boundMessageHandler);
        this._addSocketListener(socket, 'error', this._boundErrorHandler);
        this._addSocketListener(socket, 'close', this._boundCloseHandler);
    }
    _detachSocketHandlers() {
        const socket = this._socket;
        if (!socket) return;
        if (this._boundOpenHandler) this._removeSocketListener(socket, 'open', this._boundOpenHandler);
        if (this._boundMessageHandler) this._removeSocketListener(socket, 'message', this._boundMessageHandler);
        if (this._boundErrorHandler) this._removeSocketListener(socket, 'error', this._boundErrorHandler);
        if (this._boundCloseHandler) this._removeSocketListener(socket, 'close', this._boundCloseHandler);
        this._boundOpenHandler = null;
        this._boundMessageHandler = null;
        this._boundErrorHandler = null;
        this._boundCloseHandler = null;
    }
    _addSocketListener(socket, type, handler) {
        if (!socket || typeof handler !== 'function') return;
        if (typeof socket.addEventListener === 'function') {
            socket.addEventListener(type, handler);
            return;
        }
        if (typeof socket.on === 'function') {
            socket.on(type, handler);
        }
    }
    _removeSocketListener(socket, type, handler) {
        if (!socket || typeof handler !== 'function') return;
        if (typeof socket.removeEventListener === 'function') {
            socket.removeEventListener(type, handler);
            return;
        }
        if (typeof socket.off === 'function') {
            socket.off(type, handler);
            return;
        }
        if (typeof socket.removeListener === 'function') {
            socket.removeListener(type, handler);
        }
    }
    _resolvePendingCommands(response) {
        if (this._pendingCommands.size <= 0) return;
        for (const entry of this._pendingCommands.values()) {
            if (entry?.timer) {
                clearTimeout(entry.timer);
            }
            if (typeof entry?.resolve === 'function') {
                entry.resolve(response);
            }
        }
        this._pendingCommands.clear();
    }
    _handleSocketMessage(event) {
        const raw = event?.data;
        if (!raw) return;
        let parsed = null;
        try {
            parsed = JSON.parse(raw);
        } catch {
            this._recordFailure('invalid-json');
            return;
        }
        const responseType = typeof parsed?.type === 'string' ? parsed.type.trim().toLowerCase() : '';
        if (responseType && responseType === this.readyMessageType.trim().toLowerCase()) {
            this._markReady(parsed);
            this._latestResponse = parsed;
            return;
        }
        const responseId = Number(parsed?.id);
        if (!Number.isInteger(responseId)) {
            return;
        }
        if (this._pendingCommands.has(responseId)) {
            const pendingCommand = this._pendingCommands.get(responseId);
            this._pendingCommands.delete(responseId);
            if (pendingCommand?.timer) {
                clearTimeout(pendingCommand.timer);
            }
            this._telemetry.responsesReceived += 1;
            if (Number.isFinite(pendingCommand?.sentAt)) {
                pushLatencySample(this._telemetry, this._now() - pendingCommand.sentAt);
            }
            this._latestResponse = parsed;
            this._telemetry.commandResponses += 1;
            this._ingestTrainingTelemetry(parsed);
            if (typeof pendingCommand?.resolve === 'function') {
                pendingCommand.resolve(parsed);
            }
            return;
        }
        if (this._pendingAcks.has(responseId)) {
            const sentAt = this._pendingAcks.get(responseId);
            this._pendingAcks.delete(responseId);
            this._telemetry.responsesReceived += 1;
            if (Number.isFinite(sentAt)) {
                pushLatencySample(this._telemetry, this._now() - sentAt);
            }
            this._latestResponse = parsed;
            this._telemetry.ackResponses += 1;
            this._ingestTrainingTelemetry(parsed);
            return;
        }
        if (!this._pendingActionRequests.has(responseId)) {
            if (
                parsed?.ok === true
                && (responseType === 'training-step' || responseType === 'training-reset' || responseType === 'training-ack')
            ) {
                this._telemetry.responsesReceived += 1;
                this._telemetry.ackResponses += 1;
                this._latestResponse = parsed;
                this._ingestTrainingTelemetry(parsed);
            }
            return;
        }
        const pending = this._pendingActionRequests.get(responseId);
        this._pendingActionRequests.delete(responseId);
        this._telemetry.responsesReceived += 1;
        if (Number.isFinite(pending?.sentAt)) {
            pushLatencySample(this._telemetry, this._now() - pending.sentAt);
        }
        this._latestResponse = parsed;
        this._ingestTrainingTelemetry(parsed);
        const actionPayload = parsed?.action ?? parsed?.payload?.action ?? null;
        if (actionPayload && typeof actionPayload === 'object') {
            const nextTick = Number(actionPayload?.requestTick);
            const currentTick = Number(this._latestAction?.requestTick);
            const shouldReplace = !(Number.isFinite(nextTick) && Number.isFinite(currentTick) && nextTick < currentTick);
            if (shouldReplace) {
                this._latestAction = actionPayload;
            }
            this._telemetry.actionResponses += 1;
            this._flushLatestActionRequest();
            return;
        }
        this._recordFailure('missing-action');
    }
    _ensureSocket() {
        if (!this.enabled) return;
        const openState = this._resolveOpenState();
        const connectingState = this._resolveConnectingState();
        const isSocketOpen = this._socket && this._socket.readyState === openState;
        const isSocketConnecting = this._socket && this._socket.readyState === connectingState;
        if (isSocketOpen || isSocketConnecting) return;
        this._markNotReady();
        if (typeof WebSocket !== 'function') {
            if (!this._socketFactory) {
                this._recordFailure('websocket-unavailable');
                return;
            }
        }
        try {
            this._socket = this._socketFactory
                ? this._socketFactory(this.url)
                : new WebSocket(this.url);
            if (
                !this._socket
                || (
                    typeof this._socket.addEventListener !== 'function'
                    && typeof this._socket.on !== 'function'
                )
            ) {
                this._recordFailure('socket-create-failed');
                this._socket = null;
                return;
            }
            this._attachSocketHandlers(this._socket);
            if (!this.requireReadyMessage && this._socket.readyState === openState) {
                this._markReady(null);
            }
        } catch (error) {
            this._recordFailure(error?.message || 'socket-create-failed');
            this._socket = null;
        }
    }
    waitForReady(timeoutMs = this.timeoutMs) {
        if (!this.enabled) return Promise.resolve(false);
        const timeout = clamp(timeoutMs, 20, 30_000);
        this._ensureSocket();
        const socket = this._socket;
        if (!socket) return Promise.resolve(false);
        const openState = this._resolveOpenState();
        const isReady = socket.readyState === openState && (this._isReady || !this.requireReadyMessage);
        if (isReady) {
            return Promise.resolve(true);
        }
        return new Promise((resolve) => {
            let settled = false;
            const finish = (ready) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this._removeSocketListener(socket, 'open', handleOpen);
                this._removeSocketListener(socket, 'error', handleError);
                this._removeSocketListener(socket, 'close', handleClose);
                this._removeSocketListener(socket, 'message', handleMessage);
                resolve(!!ready);
            };
            const handleOpen = () => {
                if (!this.requireReadyMessage) {
                    this._markReady(null);
                    finish(true);
                }
            };
            const handleError = () => finish(false);
            const handleClose = () => finish(false);
            const handleMessage = () => {
                if (socket.readyState !== openState) return;
                if (this._isReady || !this.requireReadyMessage) {
                    finish(true);
                }
            };
            const timer = setTimeout(() => {
                if (socket.readyState === openState && (this._isReady || !this.requireReadyMessage)) {
                    finish(true);
                    return;
                }
                this._recordFailure(this.requireReadyMessage ? 'ready-timeout' : 'connect-timeout');
                finish(false);
            }, timeout);
            this._addSocketListener(socket, 'open', handleOpen);
            this._addSocketListener(socket, 'error', handleError);
            this._addSocketListener(socket, 'close', handleClose);
            this._addSocketListener(socket, 'message', handleMessage);
        });
    }
    _retryPendingRequest(pending) {
        if (!pending) return false;
        if (pending.retryCount >= this.maxRetries) return false;
        const now = this._now();
        if (now < pending.retryAt) return false;
        try {
            this._socket.send(pending.serialized);
            pending.retryCount += 1;
            pending.sentAt = now;
            pending.retryAt = now + this.timeoutMs + this.retryDelayMs;
            this._telemetry.retries += 1;
            return true;
        } catch {
            this._recordFailure('send-failed');
            this._clearPending();
            return false;
        }
    }
    _handleTimeout() {
        if (this._pendingActionRequests.size <= 0) return;
        const now = this._now();
        for (const [requestId, pending] of this._pendingActionRequests.entries()) {
            const sentAt = Number(pending?.sentAt);
            if (!Number.isFinite(sentAt)) continue;
            const ageMs = now - sentAt;
            if (ageMs <= this.timeoutMs) continue;
            if (pending.retryCount < this.maxRetries) {
                if (now < pending.retryAt) {
                    continue;
                }
                this._telemetry.timeouts += 1;
                if (this._retryPendingRequest(pending)) {
                    continue;
                }
            } else {
                this._telemetry.timeouts += 1;
                this._recordFailure('timeout');
                this._pendingActionRequests.delete(requestId);
            }
        }
        this._flushLatestActionRequest();
    }
    _canSendRequest(options = {}) {
        const openState = this._resolveOpenState();
        const expectsAction = options.expectsAction !== false;
        if (!this._socket || this._socket.readyState !== openState) return false;
        if (expectsAction) {
            return this._pendingActionRequests.size < this.maxPendingActionRequests;
        }
        return this._pendingActionRequests.size <= 0;
    }
    _submitRequest(type, payload, options = {}) {
        if (!this.enabled) return false;
        this._ensureSocket();
        this._handleTimeout();
        const expectsAction = options.expectsAction !== false;
        if (!this._canSendRequest({ expectsAction })) return false;
        const requestId = this._nextRequestId++;
        const envelope = createTrainerTransportEnvelope(
            type,
            requestId,
            payload,
            options.envelopeOptions || {}
        );
        let serialized = '';
        try {
            serialized = JSON.stringify(envelope);
        } catch {
            this._recordFailure('serialize-failed');
            return false;
        }
        if (!expectsAction && this.dropTrainingPayloadWhenBacklogged && this._pendingAcks.size >= this.backpressureThreshold) {
            this._telemetry.backpressureDrops += 1;
            return false;
        }
        try {
            this._socket.send(serialized);
            const now = this._now();
            this._telemetry.requestsSent += 1;
            if (expectsAction) {
                this._telemetry.actionRequests += 1;
            } else {
                this._telemetry.trainingRequests += 1;
            }
            if (expectsAction) {
                this._pendingActionRequests.set(requestId, {
                    id: requestId,
                    sentAt: now,
                    retryAt: now + this.timeoutMs + this.retryDelayMs,
                    retryCount: 0,
                    serialized,
                });
                return true;
            }
            this._pendingAcks.set(requestId, now);
            if (this._pendingAcks.size > this.maxPendingAcks) {
                const firstKey = this._pendingAcks.keys().next().value;
                this._pendingAcks.delete(firstKey);
                this._telemetry.ackEvictions += 1;
            }
            return true;
        } catch {
            this._recordFailure('send-failed');
            return false;
        }
    }
    submitObservation(payload) {
        if (this._pendingActionRequests.size <= 0) {
            const sent = this._submitRequest('bot-action-request', payload, {
                expectsAction: true,
            });
            if (sent) return;
        }
        this._telemetry.actionSendSkipped += 1;
        this._queueLatestActionRequest(payload);
        this._scheduleLatestActionFlush();
    }
    submitTrainingPayload(messageType, payload) {
        const type = typeof messageType === 'string' && messageType.trim()
            ? messageType.trim()
            : 'training-step';
        this._submitRequest(type, payload, {
            expectsAction: false,
            envelopeOptions: {
                contractVersion: TRAINING_CONTRACT_VERSION,
                sentAtMs: this._now(),
            },
        });
    }
    submitTrainingReset(payload) {
        this.submitTrainingPayload('training-reset', payload);
    }
    submitTrainingStep(payload) {
        this.submitTrainingPayload('training-step', payload);
    }
    submitCommand(messageType, payload = {}, options = {}) {
        if (!this.enabled) return Promise.resolve(null);
        const type = typeof messageType === 'string' && messageType.trim()
            ? messageType.trim()
            : 'trainer-stats-request';
        const timeout = clamp(options.timeoutMs, 20, 30_000);
        this._ensureSocket();
        this._handleTimeout();
        if (!this._canSendRequest()) {
            return Promise.resolve(null);
        }
        const requestId = this._nextRequestId++;
        const envelope = createTrainerTransportEnvelope(
            type,
            requestId,
            payload,
            {
                contractVersion: TRAINING_CONTRACT_VERSION,
                sentAtMs: this._now(),
            }
        );
        let serialized = '';
        try {
            serialized = JSON.stringify(envelope);
        } catch {
            this._recordFailure('serialize-failed');
            return Promise.resolve(null);
        }
        return new Promise((resolve) => {
            try {
                this._socket.send(serialized);
            } catch {
                this._recordFailure('send-failed');
                resolve(null);
                return;
            }
            const sentAt = this._now();
            this._telemetry.requestsSent += 1;
            this._telemetry.commandRequests += 1;
            const timer = setTimeout(() => {
                const pending = this._pendingCommands.get(requestId);
                if (!pending) return;
                this._pendingCommands.delete(requestId);
                this._telemetry.timeouts += 1;
                this._recordFailure('command-timeout');
                resolve(null);
            }, timeout);
            this._pendingCommands.set(requestId, {
                sentAt,
                timer,
                resolve,
            });
        });
    }
    consumeLatestAction() {
        const action = this._latestAction;
        this._latestAction = null;
        return action;
    }
    consumeLatestResponse() {
        const response = this._latestResponse;
        this._latestResponse = null;
        return response;
    }
    consumeLatestReadyPayload() {
        const readyPayload = this._latestReadyPayload;
        this._latestReadyPayload = null;
        return readyPayload;
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
        return cloneTelemetrySnapshot({
            ...this._telemetry,
            pendingActionRequest: this._pendingActionRequests.size > 0,
            pendingAckCount: this._pendingAcks.size,
            pendingCommandCount: this._pendingCommands.size,
        });
    }
    resetTelemetry() {
        this._telemetry = createTelemetryState();
        this._telemetry.maxPendingAcks = this.maxPendingAcks;
        this._telemetry.backpressureThreshold = this.backpressureThreshold;
    }
    close() {
        if (this._socket) {
            this._detachSocketHandlers();
            try {
                this._socket.close();
            } catch {
                // ignore close errors
            }
        }
        this._socket = null;
        this._clearPending();
        this._latestQueuedActionRequest = null;
        this._pendingAcks.clear();
        this._resolvePendingCommands(null);
        this._latestReadyPayload = null;
        this._markNotReady();
        this._latestAction = null;
        this._latestResponse = null;
    }
}

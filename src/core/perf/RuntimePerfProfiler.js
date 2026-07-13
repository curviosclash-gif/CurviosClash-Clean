import { toFiniteNumber } from '../../utils/MathOps.js';
import { createLogger } from '../../shared/logging/Logger.js';

const logger = createLogger('PerfSpike');
const DEFAULT_BUFFER_SIZE = 720;
const DEFAULT_STATS_WINDOW = 300;
const DEFAULT_SPIKE_THRESHOLD_MS = 30;
const DEFAULT_SPIKE_LOG_LIMIT = 64;
const DEFAULT_SPIKE_LOG_COOLDOWN_MS = 1500;

const SUBSYSTEM_IDS = Object.freeze([
    'update',
    'collision',
    'hunt_targeting',
    'bot_sensing',
    'camera',
    'render',
    'recorder_encode',
]);

const SUBSYSTEM_INDEX_BY_ID = Object.freeze(
    SUBSYSTEM_IDS.reduce((acc, id, index) => {
        acc[id] = index;
        return acc;
    }, {})
);

function toPositiveInt(value, fallback, min = 1, max = 1_000_000) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(numeric)));
}

function nowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

function percentileFromSorted(values, ratio) {
    if (!Array.isArray(values) || values.length === 0) return 0;
    const clampedRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
    const rawIndex = Math.ceil(values.length * clampedRatio) - 1;
    const index = Math.max(0, Math.min(values.length - 1, rawIndex));
    return Number(values[index]) || 0;
}

function sanitizeWindowSize(value, fallback, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return Math.min(fallback, max);
    return Math.max(1, Math.min(max, Math.trunc(numeric)));
}

function createBotSensingDetailState() {
    return {
        playerIndex: -1,
        policyType: '',
        ms: 0,
    };
}

export class RuntimePerfProfiler {
    constructor(options = {}) {
        this.bufferSize = toPositiveInt(options.bufferSize, DEFAULT_BUFFER_SIZE, 120, 4096);
        this.defaultWindowSize = sanitizeWindowSize(
            options.defaultWindowSize,
            DEFAULT_STATS_WINDOW,
            this.bufferSize
        );
        this.spikeThresholdMs = Math.max(
            1,
            toFiniteNumber(options.spikeThresholdMs, DEFAULT_SPIKE_THRESHOLD_MS)
        );
        this._spikeLogLimit = toPositiveInt(options.spikeLogLimit, DEFAULT_SPIKE_LOG_LIMIT, 8, 512);
        this._spikeLoggingEnabled = options.logSpikes === true;
        this._spikeLogCooldownMs = Math.max(
            0,
            toFiniteNumber(options.spikeLogCooldownMs, DEFAULT_SPIKE_LOG_COOLDOWN_MS)
        );

        this._frameTimesMs = new Float32Array(this.bufferSize);
        this._subsystemBuffers = SUBSYSTEM_IDS.map(() => new Float32Array(this.bufferSize));
        this._currentFrameSubsystemMs = new Float32Array(SUBSYSTEM_IDS.length);

        this._writeIndex = 0;
        this._sampleCount = 0;
        this._frameActive = false;
        this._pendingFrameTimeMs = 0;
        this._pendingTimestampMs = 0;
        this._lastFrameTimestampMs = 0;
        this._spikeCountTotal = 0;

        this._spikeEvents = [];
        this._currentFrameBotSensing = createBotSensingDetailState();
        this._lastSpikeLogTimestampMs = -Infinity;
        this._suppressedSpikeLogs = 0;
    }

    getSubsystemIds() {
        return SUBSYSTEM_IDS.slice();
    }

    reset() {
        this._frameTimesMs.fill(0);
        for (let i = 0; i < this._subsystemBuffers.length; i++) {
            this._subsystemBuffers[i].fill(0);
        }
        this._currentFrameSubsystemMs.fill(0);
        this._writeIndex = 0;
        this._sampleCount = 0;
        this._frameActive = false;
        this._pendingFrameTimeMs = 0;
        this._pendingTimestampMs = 0;
        this._lastFrameTimestampMs = 0;
        this._spikeCountTotal = 0;
        this._spikeEvents.length = 0;
        this._currentFrameBotSensing.playerIndex = -1;
        this._currentFrameBotSensing.policyType = '';
        this._currentFrameBotSensing.ms = 0;
        this._lastSpikeLogTimestampMs = -Infinity;
        this._suppressedSpikeLogs = 0;
    }

    setSpikeLoggingEnabled(enabled) {
        this._spikeLoggingEnabled = enabled === true;
    }

    isSpikeLoggingEnabled() {
        return this._spikeLoggingEnabled === true;
    }

    _shouldEmitSpikeLog(timestampMs) {
        if (this._spikeLoggingEnabled !== true) {
            this._suppressedSpikeLogs += 1;
            return false;
        }
        if (!(this._spikeLogCooldownMs > 0)) {
            return true;
        }
        if ((timestampMs - this._lastSpikeLogTimestampMs) < this._spikeLogCooldownMs) {
            this._suppressedSpikeLogs += 1;
            return false;
        }
        return true;
    }

    beginFrame(frameTimeMs, timestampMs = nowMs()) {
        this._currentFrameSubsystemMs.fill(0);
        this._pendingFrameTimeMs = Math.max(0, toFiniteNumber(frameTimeMs, 0));
        this._pendingTimestampMs = Math.max(0, toFiniteNumber(timestampMs, nowMs()));
        this._frameActive = true;
        this._currentFrameBotSensing.playerIndex = -1;
        this._currentFrameBotSensing.policyType = '';
        this._currentFrameBotSensing.ms = 0;
    }

    startSample() {
        return nowMs();
    }

    endSample(subsystemId, startMs) {
        if (!Number.isFinite(startMs)) return;
        this.recordSubsystemDuration(subsystemId, nowMs() - startMs);
    }

    recordSubsystemDuration(subsystemId, durationMs) {
        if (!this._frameActive) return;
        const subsystemIndex = SUBSYSTEM_INDEX_BY_ID[subsystemId];
        if (subsystemIndex === undefined) return;
        const safeDuration = toFiniteNumber(durationMs, 0);
        if (!(safeDuration > 0)) return;
        this._currentFrameSubsystemMs[subsystemIndex] += safeDuration;
    }

    recordBotSensingDetail(playerIndex, policyType, durationMs) {
        if (!this._frameActive) return;
        const safeDuration = toFiniteNumber(durationMs, 0);
        if (!(safeDuration > this._currentFrameBotSensing.ms)) return;

        this._currentFrameBotSensing.playerIndex = Number.isInteger(playerIndex) ? playerIndex : -1;
        this._currentFrameBotSensing.policyType = typeof policyType === 'string' ? policyType : '';
        this._currentFrameBotSensing.ms = safeDuration;
    }

    endFrame(frameTimeMs = null, timestampMs = null) {
        if (!this._frameActive) {
            return null;
        }

        const resolvedFrameTimeMs = frameTimeMs == null
            ? this._pendingFrameTimeMs
            : Math.max(0, toFiniteNumber(frameTimeMs, this._pendingFrameTimeMs));
        const resolvedTimestampMs = timestampMs == null
            ? this._pendingTimestampMs
            : Math.max(0, toFiniteNumber(timestampMs, this._pendingTimestampMs));
        const writeIndex = this._writeIndex;
        this._frameTimesMs[writeIndex] = resolvedFrameTimeMs;
        for (let i = 0; i < this._subsystemBuffers.length; i++) {
            this._subsystemBuffers[i][writeIndex] = this._currentFrameSubsystemMs[i];
        }

        this._writeIndex = (this._writeIndex + 1) % this.bufferSize;
        this._sampleCount = Math.min(this.bufferSize, this._sampleCount + 1);
        this._frameActive = false;
        this._lastFrameTimestampMs = resolvedTimestampMs;

        if (resolvedFrameTimeMs >= this.spikeThresholdMs) {
            this._spikeCountTotal += 1;
            const topSubsystems = this._resolveTopSubsystems(this._currentFrameSubsystemMs);
            const botSensingDetail = this._currentFrameBotSensing.ms > 0
                ? {
                    playerIndex: this._currentFrameBotSensing.playerIndex,
                    policyType: this._currentFrameBotSensing.policyType,
                    ms: this._currentFrameBotSensing.ms,
                }
                : null;
            const spikeEvent = {
                timestampMs: resolvedTimestampMs,
                frameTimeMs: resolvedFrameTimeMs,
                topSubsystems,
                botSensing: botSensingDetail,
            };
            this._spikeEvents.push(spikeEvent);
            if (this._spikeEvents.length > this._spikeLogLimit) {
                this._spikeEvents.shift();
            }

            if (
                this._shouldEmitSpikeLog(resolvedTimestampMs)
                && typeof console !== 'undefined'
                && typeof console.warn === 'function'
            ) {
                const topSummary = topSubsystems
                    .map((entry) => `${entry.id}=${entry.ms.toFixed(2)}ms`)
                    .join(', ');
                const botSummary = botSensingDetail
                    ? ` bot=[index=${botSensingDetail.playerIndex} policy=${botSensingDetail.policyType || 'unknown'} ms=${botSensingDetail.ms.toFixed(2)}]`
                    : '';
                const suppressedSummary = this._suppressedSpikeLogs > 0
                    ? ` suppressed=${this._suppressedSpikeLogs}`
                    : '';
                logger.warn(
                    `frame=${resolvedFrameTimeMs.toFixed(2)}ms threshold=${this.spikeThresholdMs.toFixed(1)}ms top=[${topSummary}]${botSummary}${suppressedSummary}`
                );
                this._lastSpikeLogTimestampMs = resolvedTimestampMs;
                this._suppressedSpikeLogs = 0;
            }
        }

        return resolvedFrameTimeMs;
    }

    _resolveTopSubsystems(sourceTotals) {
        let bestA = -1;
        let bestB = -1;
        let bestC = -1;

        for (let i = 0; i < sourceTotals.length; i++) {
            const value = sourceTotals[i];
            if (!(value > 0)) continue;
            if (bestA < 0 || value > sourceTotals[bestA]) {
                bestC = bestB;
                bestB = bestA;
                bestA = i;
                continue;
            }
            if (bestB < 0 || value > sourceTotals[bestB]) {
                bestC = bestB;
                bestB = i;
                continue;
            }
            if (bestC < 0 || value > sourceTotals[bestC]) {
                bestC = i;
            }
        }

        const indices = [bestA, bestB, bestC].filter((index) => index >= 0);
        return indices.map((index) => ({
            id: SUBSYSTEM_IDS[index],
            ms: sourceTotals[index],
        }));
    }

    _resolveRingIndex(offsetFromOldest) {
        if (this._sampleCount <= 0) return -1;
        const oldestIndex = (this._writeIndex - this._sampleCount + this.bufferSize) % this.bufferSize;
        return (oldestIndex + offsetFromOldest) % this.bufferSize;
    }

    _collectWindowFrameTimes(windowSize) {
        const safeWindow = Math.max(1, Math.min(windowSize, this._sampleCount));
        const values = new Array(safeWindow);
        for (let i = 0; i < safeWindow; i++) {
            values[i] = this._frameTimesMs[this._resolveRingIndex(this._sampleCount - safeWindow + i)];
        }
        return values;
    }

    _collectSubsystemWindowAverage(subsystemIndex, windowSize) {
        const safeWindow = Math.max(1, Math.min(windowSize, this._sampleCount));
        let sum = 0;
        for (let i = 0; i < safeWindow; i++) {
            const ringIndex = this._resolveRingIndex(this._sampleCount - safeWindow + i);
            sum += this._subsystemBuffers[subsystemIndex][ringIndex];
        }
        return sum / safeWindow;
    }

    _collectSpikeCountInWindow(windowSize) {
        if (this._sampleCount <= 0 || this._spikeEvents.length === 0) return 0;
        const safeWindow = Math.max(1, Math.min(windowSize, this._sampleCount));
        if (!(this._lastFrameTimestampMs > 0)) return 0;
        const frameTimes = this._collectWindowFrameTimes(safeWindow);
        let windowDurationMs = 0;
        for (let i = 0; i < frameTimes.length; i++) {
            windowDurationMs += frameTimes[i];
        }
        const minTimestamp = this._lastFrameTimestampMs - windowDurationMs;
        let count = 0;
        for (let i = 0; i < this._spikeEvents.length; i++) {
            const event = this._spikeEvents[i];
            if (event.timestampMs >= minTimestamp) {
                count += 1;
            }
        }
        return count;
    }

    getSnapshot(options = {}) {
        if (this._sampleCount <= 0) {
            return {
                sampleCount: 0,
                frameMs: {
                    avg: 0,
                    min: 0,
                    max: 0,
                    p95: 0,
                    p99: 0,
                },
                spikes: {
                    thresholdMs: this.spikeThresholdMs,
                    total: this._spikeCountTotal,
                    recent: 0,
                    events: [],
                },
                subsystems: {},
            };
        }

        const windowSize = sanitizeWindowSize(
            options.windowSize,
            this.defaultWindowSize,
            this._sampleCount
        );
        const frameTimes = this._collectWindowFrameTimes(windowSize);
        let sum = 0;
        let min = Number.POSITIVE_INFINITY;
        let max = 0;
        for (let i = 0; i < frameTimes.length; i++) {
            const value = frameTimes[i];
            sum += value;
            if (value < min) min = value;
            if (value > max) max = value;
        }
        const sortedFrameTimes = frameTimes.slice().sort((a, b) => a - b);

        const subsystemSnapshot = {};
        for (let i = 0; i < SUBSYSTEM_IDS.length; i++) {
            subsystemSnapshot[SUBSYSTEM_IDS[i]] = {
                avg: this._collectSubsystemWindowAverage(i, windowSize),
            };
        }

        const recentSpikes = this._collectSpikeCountInWindow(windowSize);
        const requestedSpikeEventsLimit = Number(options.spikeEventsLimit);
        const spikeEventsLimit = Number.isFinite(requestedSpikeEventsLimit)
            ? Math.max(0, Math.min(this._spikeLogLimit, Math.trunc(requestedSpikeEventsLimit)))
            : Math.min(12, this._spikeLogLimit);
        const spikeEvents = spikeEventsLimit > 0
            ? this._spikeEvents.slice(-spikeEventsLimit).map((entry) => ({
                timestampMs: entry.timestampMs,
                frameTimeMs: entry.frameTimeMs,
                topSubsystems: entry.topSubsystems.map((subsystem) => ({
                    id: subsystem.id,
                    ms: subsystem.ms,
                })),
                botSensing: entry.botSensing
                    ? {
                        playerIndex: entry.botSensing.playerIndex,
                        policyType: entry.botSensing.policyType,
                        ms: entry.botSensing.ms,
                    }
                    : null,
            }))
            : [];

        return {
            sampleCount: this._sampleCount,
            windowSize,
            frameMs: {
                avg: sum / frameTimes.length,
                min: Number.isFinite(min) ? min : 0,
                max: max || 0,
                p95: percentileFromSorted(sortedFrameTimes, 0.95),
                p99: percentileFromSorted(sortedFrameTimes, 0.99),
            },
            spikes: {
                thresholdMs: this.spikeThresholdMs,
                total: this._spikeCountTotal,
                recent: recentSpikes,
                events: spikeEvents,
            },
            subsystems: subsystemSnapshot,
        };
    }
}

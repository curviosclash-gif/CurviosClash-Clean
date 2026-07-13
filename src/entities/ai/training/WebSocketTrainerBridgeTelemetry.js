import { clamp } from '../../../utils/MathOps.js';

function computePercentile(samples, percentile) {
    if (!Array.isArray(samples) || samples.length === 0) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    const clampedPercentile = clamp(percentile, 0, 1);
    const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil(sorted.length * clampedPercentile) - 1)
    );
    return sorted[index];
}

export function createTelemetryState() {
    return {
        requestsSent: 0,
        actionRequests: 0,
        trainingRequests: 0,
        commandRequests: 0,
        responsesReceived: 0,
        actionResponses: 0,
        ackResponses: 0,
        commandResponses: 0,
        retries: 0,
        timeouts: 0,
        failures: 0,
        fallbacks: 0,
        readyMessages: 0,
        latencySamplesMs: [],
        latencyTotalMs: 0,
        latencyMinMs: null,
        latencyMaxMs: null,
        lastLatencyMs: null,
        learningReports: 0,
        learningUpdates: 0,
        lossSamples: [],
        lossTotal: 0,
        epsilonSamples: [],
        epsilonTotal: 0,
        replayFillSamples: [],
        replayFillTotal: 0,
        latestLoss: null,
        latestEpsilon: null,
        latestReplayFill: null,
        maxOptimizerSteps: 0,
        maxPendingAcks: 0,
        backpressureThreshold: 0,
        backpressureDrops: 0,
        actionDrops: 0,
        actionSendSkipped: 0,
        ackEvictions: 0,
        lastFailure: null,
        lastFallbackReason: null,
    };
}

export function cloneTelemetrySnapshot(state) {
    const sampleCount = state.latencySamplesMs.length;
    const latencyMeanMs = sampleCount > 0
        ? state.latencyTotalMs / sampleCount
        : null;
    const lossSampleCount = state.lossSamples.length;
    const epsilonSampleCount = state.epsilonSamples.length;
    const replayFillSampleCount = state.replayFillSamples.length;
    return {
        requestsSent: state.requestsSent,
        actionRequests: state.actionRequests,
        trainingRequests: state.trainingRequests,
        commandRequests: state.commandRequests,
        responsesReceived: state.responsesReceived,
        actionResponses: state.actionResponses,
        ackResponses: state.ackResponses,
        commandResponses: state.commandResponses,
        retries: state.retries,
        timeouts: state.timeouts,
        failures: state.failures,
        fallbacks: state.fallbacks,
        readyMessages: state.readyMessages,
        latencySampleCount: sampleCount,
        latencyMeanMs,
        latencyP95Ms: computePercentile(state.latencySamplesMs, 0.95),
        latencyMinMs: state.latencyMinMs,
        latencyMaxMs: state.latencyMaxMs,
        lastLatencyMs: state.lastLatencyMs,
        learningReports: state.learningReports,
        learningUpdates: state.learningUpdates,
        lossSampleCount,
        lossMean: lossSampleCount > 0 ? state.lossTotal / lossSampleCount : null,
        lossP95: computePercentile(state.lossSamples, 0.95),
        latestLoss: state.latestLoss,
        epsilonSampleCount,
        epsilonMean: epsilonSampleCount > 0 ? state.epsilonTotal / epsilonSampleCount : null,
        latestEpsilon: state.latestEpsilon,
        replayFillSampleCount,
        replayFillMean: replayFillSampleCount > 0 ? state.replayFillTotal / replayFillSampleCount : null,
        latestReplayFill: state.latestReplayFill,
        maxOptimizerSteps: state.maxOptimizerSteps,
        maxPendingAcks: state.maxPendingAcks,
        backpressureThreshold: state.backpressureThreshold,
        backpressureDrops: state.backpressureDrops,
        actionDrops: state.actionDrops,
        actionSendSkipped: state.actionSendSkipped,
        ackEvictions: state.ackEvictions,
        lastFailure: state.lastFailure,
        lastFallbackReason: state.lastFallbackReason,
        pendingActionRequest: !!state.pendingActionRequest,
        pendingAckCount: Number(state.pendingAckCount) || 0,
        pendingCommandCount: Number(state.pendingCommandCount) || 0,
    };
}

export function pushLatencySample(state, latencyMs) {
    const latency = Math.max(0, Math.trunc(clamp(latencyMs, 0, 60_000)));
    state.latencySamplesMs.push(latency);
    if (state.latencySamplesMs.length > 128) {
        const removed = state.latencySamplesMs.shift();
        state.latencyTotalMs -= Number.isFinite(removed) ? removed : 0;
    }
    state.latencyTotalMs += latency;
    state.lastLatencyMs = latency;
    state.latencyMinMs = state.latencyMinMs == null
        ? latency
        : Math.min(state.latencyMinMs, latency);
    state.latencyMaxMs = state.latencyMaxMs == null
        ? latency
        : Math.max(state.latencyMaxMs, latency);
}

export function pushTelemetrySample(
    state,
    key,
    totalKey,
    value,
    min = -1_000_000_000,
    max = 1_000_000_000
) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return false;
    const clamped = clamp(numeric, min, max);
    state[key].push(clamped);
    if (state[key].length > 128) {
        const removed = state[key].shift();
        state[totalKey] -= Number.isFinite(removed) ? removed : 0;
    }
    state[totalKey] += clamped;
    return true;
}

// ============================================
// TrainingGateEvaluator.js - derives V33 KPIs and evaluates gate thresholds
// ============================================

import {
    DEFAULT_TRAINING_GATE_THRESHOLDS,
    TRAINING_GATE_BASELINE_REFERENCE,
    TRAINING_GATE_THRESHOLD_VERSION,
    createTrainingGateThresholds,
} from './TrainingGateThresholds.js';
import { deriveTrainingOpsKpis } from './TrainingOpsKpiContractV36.js';
import { toFiniteNumber } from '../../utils/MathOps.js';

function roundMetric(value) {
    return Math.round(toFiniteNumber(value, 0) * 1_000_000) / 1_000_000;
}

function toRate(numerator, denominator) {
    const safeDenominator = toFiniteNumber(denominator, 0);
    if (safeDenominator <= 0) return 0;
    return roundMetric(toFiniteNumber(numerator, 0) / safeDenominator);
}

function resolveEpisodes(evalArtifact = {}) {
    if (Array.isArray(evalArtifact.episodes)) return evalArtifact.episodes;
    if (Array.isArray(evalArtifact.scenarios)) return evalArtifact.scenarios;
    if (Array.isArray(evalArtifact.metrics?.episodes)) return evalArtifact.metrics.episodes;
    return [];
}

function resolveRuntimeErrors(evalArtifact = {}) {
    const direct = toFiniteNumber(evalArtifact?.metrics?.runtimeErrorCount, NaN);
    if (Number.isFinite(direct)) return Math.max(0, Math.trunc(direct));
    const errorArray = Array.isArray(evalArtifact.runtimeErrors)
        ? evalArtifact.runtimeErrors
        : [];
    return errorArray.length;
}

function resolveBridgeTelemetry(evalArtifact = {}) {
    const source = evalArtifact?.bridgeTelemetry
        || evalArtifact?.bridge?.telemetry
        || evalArtifact?.metrics?.bridge
        || {};
    const requestsSent = Math.max(0, Math.trunc(toFiniteNumber(source.requestsSent, 0)));
    const actionRequests = Math.max(0, Math.trunc(toFiniteNumber(source.actionRequests, requestsSent)));
    const trainingRequests = Math.max(0, Math.trunc(toFiniteNumber(source.trainingRequests, 0)));
    const commandRequests = Math.max(0, Math.trunc(toFiniteNumber(source.commandRequests, 0)));
    const responsesReceived = Math.max(0, Math.trunc(toFiniteNumber(source.responsesReceived, 0)));
    const actionResponses = Math.max(0, Math.trunc(toFiniteNumber(source.actionResponses, responsesReceived)));
    const ackResponses = Math.max(0, Math.trunc(toFiniteNumber(source.ackResponses, 0)));
    const commandResponses = Math.max(0, Math.trunc(toFiniteNumber(source.commandResponses, 0)));
    const retries = Math.max(0, Math.trunc(toFiniteNumber(source.retries, 0)));
    const timeouts = Math.max(0, Math.trunc(toFiniteNumber(source.timeouts, 0)));
    const fallbacks = Math.max(0, Math.trunc(toFiniteNumber(source.fallbacks, 0)));
    const latencyP95Ms = toFiniteNumber(source.latencyP95Ms, null);
    return {
        requestsSent,
        actionRequests,
        trainingRequests,
        commandRequests,
        responsesReceived,
        actionResponses,
        ackResponses,
        commandResponses,
        retries,
        timeouts,
        fallbacks,
        latencyP95Ms: latencyP95Ms == null ? null : roundMetric(latencyP95Ms),
    };
}

export function deriveTrainingGateKpis(evalArtifact = {}) {
    const episodes = resolveEpisodes(evalArtifact);
    let returnSum = 0;
    let terminalCount = 0;
    let truncationCount = 0;
    let invalidActionCount = 0;
    let actionCount = 0;

    for (const episode of episodes) {
        returnSum += toFiniteNumber(episode?.episodeReturn, 0);
        if (episode?.done === true) terminalCount += 1;
        if (episode?.truncated === true) truncationCount += 1;
        invalidActionCount += Math.max(0, Math.trunc(toFiniteNumber(episode?.invalidActionCount, 0)));
        const episodeActionCount = Math.max(
            0,
            Math.trunc(
                toFiniteNumber(
                    episode?.actionCount,
                    episode?.steps
                )
            )
        );
        actionCount += episodeActionCount;
    }

    const episodeCount = episodes.length;
    const bridgeTelemetry = resolveBridgeTelemetry(evalArtifact);
    const opsKpis = deriveTrainingOpsKpis(bridgeTelemetry);
    const runtimeErrorCount = resolveRuntimeErrors(evalArtifact);
    return {
        episodeCount,
        episodeReturnMean: episodeCount > 0
            ? roundMetric(returnSum / episodeCount)
            : 0,
        terminalRate: toRate(terminalCount, episodeCount),
        truncationRate: toRate(truncationCount, episodeCount),
        invalidActionRate: toRate(invalidActionCount, actionCount),
        runtimeErrorCount,
        timeoutRate: opsKpis.timeoutRate,
        fallbackRate: opsKpis.fallbackRate,
        actionCoverage: opsKpis.actionCoverage,
        responseCoverage: opsKpis.responseCoverage,
        bridgeTimeoutRate: opsKpis.bridgeTimeoutRate,
        bridgeFallbackRate: opsKpis.bridgeFallbackRate,
        bridgeLatencyP95Ms: opsKpis.bridgeLatencyP95Ms,
        latencyP95Ms: opsKpis.latencyP95Ms,
        opsKpis,
        bridgeTelemetry,
    };
}

function resolveThresholdSet(options = {}) {
    if (options.thresholds && typeof options.thresholds === 'object') {
        return options.thresholds;
    }
    if (options.baseline && typeof options.baseline === 'object') {
        return createTrainingGateThresholds(options.baseline);
    }
    return DEFAULT_TRAINING_GATE_THRESHOLDS;
}

function evaluateMetric(metricName, metricValue, thresholdDef) {
    const comparator = thresholdDef?.comparator === 'min' ? 'min' : 'max';
    const warnThreshold = toFiniteNumber(thresholdDef?.warn, 0);
    const hardThreshold = toFiniteNumber(thresholdDef?.hard, 0);
    let level = 'pass';
    if (comparator === 'min') {
        if (metricValue < hardThreshold) level = 'fail';
        else if (metricValue < warnThreshold) level = 'warn';
    } else {
        if (metricValue > hardThreshold) level = 'fail';
        else if (metricValue > warnThreshold) level = 'warn';
    }
    return {
        metric: metricName,
        comparator,
        value: roundMetric(metricValue),
        warnThreshold: roundMetric(warnThreshold),
        hardThreshold: roundMetric(hardThreshold),
        level,
    };
}

export function evaluateTrainingGate(evalArtifact = {}, options = {}) {
    const kpis = deriveTrainingGateKpis(evalArtifact);
    const thresholds = resolveThresholdSet(options);
    const metricOrder = [
        'episodeReturnMean',
        'terminalRate',
        'truncationRate',
        'invalidActionRate',
        'runtimeErrorCount',
        'timeoutRate',
        'fallbackRate',
        'actionCoverage',
        'responseCoverage',
        'bridgeTimeoutRate',
        'bridgeFallbackRate',
        'bridgeLatencyP95Ms',
    ];

    const checks = [];
    for (const metricName of metricOrder) {
        const thresholdDef = thresholds?.[metricName];
        if (!thresholdDef || typeof thresholdDef !== 'object') continue;
        checks.push(evaluateMetric(metricName, kpis[metricName], thresholdDef));
    }

    const hardFailures = checks.filter((entry) => entry.level === 'fail');
    const warnings = checks.filter((entry) => entry.level === 'warn');
    return {
        ok: hardFailures.length === 0,
        status: hardFailures.length === 0 ? 'pass' : 'fail',
        thresholdVersion: TRAINING_GATE_THRESHOLD_VERSION,
        baselineReference: options.baseline || TRAINING_GATE_BASELINE_REFERENCE,
        thresholds,
        kpis,
        checks,
        hardFailures,
        warnings,
    };
}

// ============================================
// TrainingOpsKpiContractV36.js - production operations KPIs for bridge/trainer runtime
// ============================================

import { toFiniteNumber } from '../../utils/MathOps.js';

export const TRAINING_OPS_KPI_CONTRACT_VERSION = 'v36-ops-kpi-v1';

function toNonNegativeInt(value, fallback = 0) {
    return Math.max(0, Math.trunc(toFiniteNumber(value, fallback)));
}

function roundMetric(value) {
    return Math.round(toFiniteNumber(value, 0) * 1_000_000) / 1_000_000;
}

function toRate(numerator, denominator) {
    const safeDenominator = toFiniteNumber(denominator, 0);
    if (safeDenominator <= 0) return 0;
    return roundMetric(toFiniteNumber(numerator, 0) / safeDenominator);
}

export function deriveTrainingOpsKpis(bridgeTelemetry = null) {
    const telemetry = bridgeTelemetry && typeof bridgeTelemetry === 'object'
        ? bridgeTelemetry
        : {};
    const requestsSent = toNonNegativeInt(telemetry.requestsSent, 0);
    const actionRequests = toNonNegativeInt(telemetry.actionRequests, requestsSent);
    const responsesReceived = toNonNegativeInt(telemetry.responsesReceived, 0);
    const actionResponses = toNonNegativeInt(telemetry.actionResponses, responsesReceived);
    const ackResponses = toNonNegativeInt(telemetry.ackResponses, 0);
    const commandResponses = toNonNegativeInt(telemetry.commandResponses, 0);
    const retries = toNonNegativeInt(telemetry.retries, 0);
    const timeouts = toNonNegativeInt(telemetry.timeouts, 0);
    const fallbacks = toNonNegativeInt(telemetry.fallbacks, 0);
    const failures = toNonNegativeInt(telemetry.failures, 0);
    const latencyP95Ms = roundMetric(toFiniteNumber(telemetry.latencyP95Ms, 0));

    const timeoutRate = toRate(timeouts, requestsSent);
    const fallbackRate = toRate(fallbacks, requestsSent);
    const responseCoverage = toRate(responsesReceived, requestsSent);
    const actionCoverage = toRate(actionResponses, Math.max(1, actionRequests));

    return {
        contractVersion: TRAINING_OPS_KPI_CONTRACT_VERSION,
        requestCount: requestsSent,
        actionRequestCount: actionRequests,
        responseCount: responsesReceived,
        actionResponseCount: actionResponses,
        ackResponseCount: ackResponses,
        commandResponseCount: commandResponses,
        retryCount: retries,
        timeoutCount: timeouts,
        fallbackCount: fallbacks,
        failureCount: failures,
        timeoutRate,
        fallbackRate,
        responseCoverage,
        actionCoverage,
        latencyP95Ms,
        // v33 compatibility aliases
        bridgeTimeoutRate: timeoutRate,
        bridgeFallbackRate: fallbackRate,
        bridgeLatencyP95Ms: latencyP95Ms,
    };
}

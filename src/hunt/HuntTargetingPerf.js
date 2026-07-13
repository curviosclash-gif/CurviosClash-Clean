import { resolveEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';

function toPositiveNumber(value, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return numeric;
}

function nowMs() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

export function createHuntTargetingTelemetryState(reusable = null) {
    const telemetry = reusable && typeof reusable === 'object' ? reusable : {};
    telemetry.calls = Number(telemetry.calls) || 0;
    telemetry.hits = Number(telemetry.hits) || 0;
    telemetry.playerHits = Number(telemetry.playerHits) || 0;
    telemetry.trailHits = Number(telemetry.trailHits) || 0;
    telemetry.misses = Number(telemetry.misses) || 0;
    telemetry.adaptiveCalls = Number(telemetry.adaptiveCalls) || 0;
    telemetry.probeQueriesTotal = Number(telemetry.probeQueriesTotal) || 0;
    telemetry.probeQueriesMax = Number(telemetry.probeQueriesMax) || 0;
    telemetry.adaptiveProbeQueriesTotal = Number(telemetry.adaptiveProbeQueriesTotal) || 0;
    telemetry.legacyProbeQueriesTotal = Number(telemetry.legacyProbeQueriesTotal) || 0;
    telemetry.refinementScansTotal = Number(telemetry.refinementScansTotal) || 0;
    telemetry.durationMsTotal = Number(telemetry.durationMsTotal) || 0;
    telemetry.durationMsMax = Number(telemetry.durationMsMax) || 0;
    telemetry.lastDurationMs = Number(telemetry.lastDurationMs) || 0;
    telemetry.lastProbeQueries = Number(telemetry.lastProbeQueries) || 0;
    telemetry.lastUsedAdaptive = telemetry.lastUsedAdaptive === true;
    telemetry.lastRefinementScans = Number(telemetry.lastRefinementScans) || 0;
    telemetry.lastResultKind = typeof telemetry.lastResultKind === 'string' ? telemetry.lastResultKind : 'none';
    return telemetry;
}

export function resetHuntTargetingCallMetrics(metrics) {
    if (!metrics || typeof metrics !== 'object') return null;
    metrics.probeQueries = 0;
    metrics.adaptiveProbeQueries = 0;
    metrics.legacyProbeQueries = 0;
    metrics.refinementScans = 0;
    metrics.usedAdaptive = false;
    return metrics;
}

function commitHuntTargetingTelemetry(telemetry, metrics, result, durationMs) {
    if (!telemetry || typeof telemetry !== 'object' || !metrics || typeof metrics !== 'object') return;
    telemetry.calls += 1;
    if (result) {
        telemetry.hits += 1;
    } else {
        telemetry.misses += 1;
    }

    const resultKind = result?.kind === 'player'
        ? 'player'
        : (result?.kind === 'trail' ? 'trail' : 'none');
    if (resultKind === 'player') telemetry.playerHits += 1;
    if (resultKind === 'trail') telemetry.trailHits += 1;
    if (metrics.usedAdaptive) telemetry.adaptiveCalls += 1;

    telemetry.probeQueriesTotal += metrics.probeQueries;
    telemetry.probeQueriesMax = Math.max(telemetry.probeQueriesMax, metrics.probeQueries);
    telemetry.adaptiveProbeQueriesTotal += metrics.adaptiveProbeQueries;
    telemetry.legacyProbeQueriesTotal += metrics.legacyProbeQueries;
    telemetry.refinementScansTotal += metrics.refinementScans;
    telemetry.durationMsTotal += Math.max(0, durationMs);
    telemetry.durationMsMax = Math.max(telemetry.durationMsMax, Math.max(0, durationMs));

    telemetry.lastDurationMs = Math.max(0, durationMs);
    telemetry.lastProbeQueries = metrics.probeQueries;
    telemetry.lastUsedAdaptive = metrics.usedAdaptive === true;
    telemetry.lastRefinementScans = metrics.refinementScans;
    telemetry.lastResultKind = resultKind;
}

export function resolveHuntTargetingHotpathSettings(options = {}) {
    const targetingConfig = resolveEntityRuntimeConfig(options?.entityRuntimeConfig || options?.runtimeContext || options?.runtime)?.HUNT?.TARGETING || {};
    const optimizedScanEnabled = options.optimizedTrailScan == null
        ? targetingConfig.OPTIMIZED_SCAN_ENABLED !== false
        : options.optimizedTrailScan !== false;
    return {
        optimizedScanEnabled,
        optimizedScanStepMultiplier: toPositiveNumber(
            options.optimizedTrailScanStepMultiplier,
            toPositiveNumber(targetingConfig.OPTIMIZED_SCAN_STEP_MULTIPLIER, 2.0)
        ),
        optimizedScanMaxStep: toPositiveNumber(
            options.optimizedTrailScanMaxStep,
            toPositiveNumber(targetingConfig.OPTIMIZED_SCAN_MAX_STEP, 1.1)
        ),
    };
}

export function finalizeHuntTargetingResult({
    result,
    runtimeProfiler = null,
    profilerSampleStart = Number.NaN,
    callStartedAtMs = Number.NaN,
    telemetry = null,
    metrics = null,
}) {
    if (runtimeProfiler && Number.isFinite(profilerSampleStart)) {
        runtimeProfiler.endSample?.('hunt_targeting', profilerSampleStart);
    }
    if (telemetry && Number.isFinite(callStartedAtMs)) {
        const elapsedMs = Math.max(0, nowMs() - callStartedAtMs);
        commitHuntTargetingTelemetry(telemetry, metrics, result, elapsedMs);
    }
    return result;
}

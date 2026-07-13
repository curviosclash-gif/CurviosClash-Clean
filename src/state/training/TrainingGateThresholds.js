// ============================================
// TrainingGateThresholds.js - baseline + drift thresholds for V33 gate decisions
// ============================================

function roundMetric(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(numeric * 1_000_000) / 1_000_000;
}

function deriveMinThresholds(baseline, options = {}) {
    const source = Math.max(0, Number(baseline) || 0);
    const warnFactor = Number.isFinite(Number(options.warnFactor))
        ? Number(options.warnFactor)
        : 0.9;
    const hardFactor = Number.isFinite(Number(options.hardFactor))
        ? Number(options.hardFactor)
        : 0.75;
    const minFloor = Number.isFinite(Number(options.minFloor))
        ? Number(options.minFloor)
        : 0;
    return {
        warn: roundMetric(Math.max(minFloor, source * warnFactor)),
        hard: roundMetric(Math.max(minFloor, source * hardFactor)),
    };
}

function deriveMaxThresholds(baseline, options = {}) {
    const source = Math.max(0, Number(baseline) || 0);
    const warnFactor = Number.isFinite(Number(options.warnFactor))
        ? Number(options.warnFactor)
        : 1.2;
    const hardFactor = Number.isFinite(Number(options.hardFactor))
        ? Number(options.hardFactor)
        : 1.5;
    const slack = Number.isFinite(Number(options.slack))
        ? Number(options.slack)
        : 0;
    const hardFloor = Number.isFinite(Number(options.hardFloor))
        ? Number(options.hardFloor)
        : 0;
    const warnValue = source * warnFactor + slack;
    const hardValue = source * hardFactor + slack;
    return {
        warn: roundMetric(Math.max(hardFloor, warnValue)),
        hard: roundMetric(Math.max(hardFloor, hardValue)),
    };
}

export const TRAINING_GATE_THRESHOLD_VERSION = 'v36-botops-1';

// Baseline aus deterministischen V33-Eval-Szenarien (seed-set 11/23/37/41 pro mode-planar domain).
export const TRAINING_GATE_BASELINE_REFERENCE = Object.freeze({
    sampleSizeEpisodes: 16,
    episodeReturnMean: 1.615,
    terminalRate: 0.5,
    truncationRate: 0.5,
    invalidActionRate: 1,
    runtimeErrorCount: 0,
    timeoutRate: 0.5,
    fallbackRate: 0.25,
    actionCoverage: 0.5,
    responseCoverage: 0.75,
    bridgeTimeoutRate: 0.5,
    bridgeFallbackRate: 0.25,
    bridgeLatencyP95Ms: 6,
});

export function createTrainingGateThresholds(
    baseline = TRAINING_GATE_BASELINE_REFERENCE
) {
    const minEpisodeReturn = deriveMinThresholds(baseline.episodeReturnMean, {
        warnFactor: 0.9,
        hardFactor: 0.75,
        minFloor: 0.1,
    });
    const minTerminalRate = deriveMinThresholds(baseline.terminalRate, {
        warnFactor: 0.9,
        hardFactor: 0.8,
        minFloor: 0.2,
    });
    const maxTruncationRate = deriveMaxThresholds(baseline.truncationRate, {
        warnFactor: 1.15,
        hardFactor: 1.35,
        slack: 0.05,
        hardFloor: 0.4,
    });
    const maxInvalidActionRate = deriveMaxThresholds(baseline.invalidActionRate, {
        warnFactor: 1.1,
        hardFactor: 1.4,
        slack: 0.02,
        hardFloor: 0.05,
    });
    const maxBridgeTimeoutRate = deriveMaxThresholds(baseline.bridgeTimeoutRate, {
        warnFactor: 1.1,
        hardFactor: 1.4,
        slack: 0.02,
        hardFloor: 0.05,
    });
    const maxBridgeFallbackRate = deriveMaxThresholds(baseline.bridgeFallbackRate, {
        warnFactor: 1.1,
        hardFactor: 1.4,
        slack: 0.02,
        hardFloor: 0.05,
    });
    const maxBridgeLatencyP95 = deriveMaxThresholds(baseline.bridgeLatencyP95Ms, {
        warnFactor: 1.2,
        hardFactor: 1.5,
        slack: 2,
        hardFloor: 8,
    });
    const maxTimeoutRate = deriveMaxThresholds(
        baseline.timeoutRate ?? baseline.bridgeTimeoutRate,
        {
            warnFactor: 1.1,
            hardFactor: 1.4,
            slack: 0.02,
            hardFloor: 0.05,
        }
    );
    const maxFallbackRate = deriveMaxThresholds(
        baseline.fallbackRate ?? baseline.bridgeFallbackRate,
        {
            warnFactor: 1.1,
            hardFactor: 1.4,
            slack: 0.02,
            hardFloor: 0.05,
        }
    );
    const minActionCoverage = deriveMinThresholds(baseline.actionCoverage, {
        warnFactor: 0.9,
        hardFactor: 0.75,
        minFloor: 0.05,
    });
    const minResponseCoverage = deriveMinThresholds(baseline.responseCoverage, {
        warnFactor: 0.9,
        hardFactor: 0.75,
        minFloor: 0.1,
    });

    return Object.freeze({
        episodeReturnMean: Object.freeze({
            comparator: 'min',
            warn: minEpisodeReturn.warn,
            hard: minEpisodeReturn.hard,
        }),
        terminalRate: Object.freeze({
            comparator: 'min',
            warn: minTerminalRate.warn,
            hard: minTerminalRate.hard,
        }),
        truncationRate: Object.freeze({
            comparator: 'max',
            warn: maxTruncationRate.warn,
            hard: maxTruncationRate.hard,
        }),
        invalidActionRate: Object.freeze({
            comparator: 'max',
            warn: maxInvalidActionRate.warn,
            hard: maxInvalidActionRate.hard,
        }),
        runtimeErrorCount: Object.freeze({
            comparator: 'max',
            warn: 0,
            hard: 0,
        }),
        timeoutRate: Object.freeze({
            comparator: 'max',
            warn: maxTimeoutRate.warn,
            hard: maxTimeoutRate.hard,
        }),
        fallbackRate: Object.freeze({
            comparator: 'max',
            warn: maxFallbackRate.warn,
            hard: maxFallbackRate.hard,
        }),
        actionCoverage: Object.freeze({
            comparator: 'min',
            warn: minActionCoverage.warn,
            hard: minActionCoverage.hard,
        }),
        responseCoverage: Object.freeze({
            comparator: 'min',
            warn: minResponseCoverage.warn,
            hard: minResponseCoverage.hard,
        }),
        bridgeTimeoutRate: Object.freeze({
            comparator: 'max',
            warn: maxBridgeTimeoutRate.warn,
            hard: maxBridgeTimeoutRate.hard,
        }),
        bridgeFallbackRate: Object.freeze({
            comparator: 'max',
            warn: maxBridgeFallbackRate.warn,
            hard: maxBridgeFallbackRate.hard,
        }),
        bridgeLatencyP95Ms: Object.freeze({
            comparator: 'max',
            warn: maxBridgeLatencyP95.warn,
            hard: maxBridgeLatencyP95.hard,
        }),
    });
}

export const DEFAULT_TRAINING_GATE_THRESHOLDS = createTrainingGateThresholds();

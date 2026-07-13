function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function roundMetric(value) {
    return Math.round(toFiniteNumber(value, 0) * 1_000_000) / 1_000_000;
}

function buildFailure(code, details = {}) {
    const definition = TRAINING_BENCHMARK_FAILURE_TAXONOMY[code]
        || Object.freeze({
            code,
            stage: 'unknown',
            severity: 'high',
            summary: code,
        });
    return {
        code,
        stage: definition.stage,
        severity: definition.severity,
        summary: definition.summary,
        ...details,
    };
}

export const TRAINING_BENCHMARK_FAILURE_TAXONOMY_VERSION = 'v80-benchmark-failure-v1';

export const TRAINING_BENCHMARK_FAILURE_TAXONOMY = Object.freeze({
    'player-dead': Object.freeze({
        code: 'player-dead',
        stage: 'validation',
        severity: 'high',
        summary: 'Bot stirbt in einem Benchmark-Fall.',
    }),
    'match-loss': Object.freeze({
        code: 'match-loss',
        stage: 'validation',
        severity: 'medium',
        summary: 'Bot verliert einen Benchmark-Fall.',
    }),
    'forced-round': Object.freeze({
        code: 'forced-round',
        stage: 'validation',
        severity: 'high',
        summary: 'Round musste forciert beendet werden.',
    }),
    'timeout-round': Object.freeze({
        code: 'timeout-round',
        stage: 'validation',
        severity: 'high',
        summary: 'Round lief in ein Timeout.',
    }),
    'bridge-fallback': Object.freeze({
        code: 'bridge-fallback',
        stage: 'run',
        severity: 'high',
        summary: 'Bridge musste in einen Fallback-Pfad wechseln.',
    }),
    'bridge-timeout': Object.freeze({
        code: 'bridge-timeout',
        stage: 'run',
        severity: 'high',
        summary: 'Bridge verzeichnet Timeouts ueber der Profil-Grenze.',
    }),
    'resume-failed': Object.freeze({
        code: 'resume-failed',
        stage: 'run',
        severity: 'high',
        summary: 'Resume- oder Checkpoint-Laden ist fehlgeschlagen.',
    }),
    'artifact-missing': Object.freeze({
        code: 'artifact-missing',
        stage: 'gate',
        severity: 'high',
        summary: 'Pflichtartefakt fehlt.',
    }),
    'validation-disabled': Object.freeze({
        code: 'validation-disabled',
        stage: 'gate',
        severity: 'high',
        summary: 'Validation-Lane ist deaktiviert oder leer.',
    }),
    'decision-trace-missing': Object.freeze({
        code: 'decision-trace-missing',
        stage: 'gate',
        severity: 'high',
        summary: 'Decision-Trace-Artefakt fehlt.',
    }),
    'hardware-telemetry-missing': Object.freeze({
        code: 'hardware-telemetry-missing',
        stage: 'gate',
        severity: 'high',
        summary: 'Hardware-Telemetrie fehlt.',
    }),
    'validation-lane-telemetry-missing': Object.freeze({
        code: 'validation-lane-telemetry-missing',
        stage: 'gate',
        severity: 'high',
        summary: 'Bot-Validation-Lane liefert keine belastbare Kapazitaets-/Timing-Diagnostik.',
    }),
    'report-io-missing': Object.freeze({
        code: 'report-io-missing',
        stage: 'gate',
        severity: 'high',
        summary: 'Report-IO-Timings oder Write-Bytes fehlen fuer bot:validate.',
    }),
    'preview-lane-missing': Object.freeze({
        code: 'preview-lane-missing',
        stage: 'gate',
        severity: 'high',
        summary: 'Preview-spezifische bot:validate-Diagnostik fehlt trotz Preview-Lane.',
    }),
    'publish-lane-missing': Object.freeze({
        code: 'publish-lane-missing',
        stage: 'gate',
        severity: 'high',
        summary: 'Publish-spezifische bot:validate-Diagnostik fehlt trotz Publish-Evidence.',
    }),
    'latency-spike': Object.freeze({
        code: 'latency-spike',
        stage: 'gate',
        severity: 'high',
        summary: 'Latenzspitzen verletzen das Profil-Guardrail.',
    }),
    backpressure: Object.freeze({
        code: 'backpressure',
        stage: 'gate',
        severity: 'high',
        summary: 'Bridge-Backpressure oder Drops verletzen das Profil-Guardrail.',
    }),
    'artifact-backlog': Object.freeze({
        code: 'artifact-backlog',
        stage: 'gate',
        severity: 'high',
        summary: 'Artefaktstau oder fehlende Pflichtreports entdeckt.',
    }),
    'semantics-mismatch': Object.freeze({
        code: 'semantics-mismatch',
        stage: 'gate',
        severity: 'high',
        summary: 'Semantikfenster stimmt nicht mit dem eingefrorenen Benchmark ueberein.',
    }),
    'benchmark-matrix-mismatch': Object.freeze({
        code: 'benchmark-matrix-mismatch',
        stage: 'gate',
        severity: 'high',
        summary: 'Benchmark-Matrix stimmt nicht mit dem eingefrorenen Vertrag ueberein.',
    }),
    'runtime-lane-missing': Object.freeze({
        code: 'runtime-lane-missing',
        stage: 'gate',
        severity: 'high',
        summary: 'Promotion oder Benchmark laufen nur auf einer synthetischen Lane statt runtime-nah.',
    }),
    'temperature-unavailable': Object.freeze({
        code: 'temperature-unavailable',
        stage: 'gate',
        severity: 'low',
        summary: 'Temperaturdaten sind lokal nicht verfuegbar und bleiben beobachtungsbasiert.',
    }),
});

export function summarizeFailureCodes(failures = []) {
    const counts = {};
    for (const failure of failures) {
        const code = typeof failure?.code === 'string' && failure.code.trim()
            ? failure.code.trim()
            : 'unknown';
        counts[code] = (counts[code] || 0) + 1;
    }
    return counts;
}

export function evaluateBenchmarkArtifactRequirements(input = {}, options = {}) {
    const failures = [];
    const warnings = [];
    const manifest = input.manifest && typeof input.manifest === 'object' ? input.manifest : null;
    const runArtifact = input.runArtifact && typeof input.runArtifact === 'object' ? input.runArtifact : null;
    const evalArtifact = input.evalArtifact && typeof input.evalArtifact === 'object' ? input.evalArtifact : null;
    const trainerArtifact = input.trainerArtifact && typeof input.trainerArtifact === 'object' ? input.trainerArtifact : null;
    const decisionTrace = input.decisionTrace && typeof input.decisionTrace === 'object' ? input.decisionTrace : null;
    const botValidation = evalArtifact?.botValidation && typeof evalArtifact.botValidation === 'object'
        ? evalArtifact.botValidation
        : null;
    const botValidationCapacityScan = botValidation?.capacityScan && typeof botValidation.capacityScan === 'object'
        ? botValidation.capacityScan
        : null;
    const expectedSemanticWindowId = typeof options.expectedSemanticWindowId === 'string'
        ? options.expectedSemanticWindowId
        : null;
    const expectedMatrixVersion = typeof options.expectedMatrixVersion === 'string'
        ? options.expectedMatrixVersion
        : null;
    const semanticWindowId = manifest?.semantics?.id || null;
    const matrixVersion = manifest?.benchmarkMatrix?.version || null;
    const environmentProfile = manifest?.environment?.profile || null;
    const runtimeNear = manifest?.environment?.runtimeNear === true;
    const promotionEligible = manifest?.environment?.promotionEligible === true;

    if (!runArtifact) {
        failures.push(buildFailure('artifact-missing', { artifact: 'run' }));
    }
    if (!evalArtifact) {
        failures.push(buildFailure('artifact-missing', { artifact: 'eval' }));
    }
    if (!trainerArtifact) {
        failures.push(buildFailure('artifact-missing', { artifact: 'trainer' }));
    }
    if (!manifest) {
        failures.push(buildFailure('artifact-missing', { artifact: 'benchmark-manifest' }));
    }
    if (!decisionTrace) {
        failures.push(buildFailure('decision-trace-missing', { artifact: 'decision-trace' }));
    }
    if (!runArtifact?.checkpointPath) {
        failures.push(buildFailure('artifact-missing', { artifact: 'checkpoint' }));
    }
    if (!botValidation?.source?.exists) {
        failures.push(buildFailure('artifact-missing', {
            artifact: 'bot-validation-report',
            path: evalArtifact?.source?.botValidationReportPath || botValidation?.source?.reportPath || null,
        }));
    }
    if (!botValidation?.enabled) {
        failures.push(buildFailure('validation-disabled', {
            artifact: 'bot-validation-report',
            path: botValidation?.source?.reportPath || null,
        }));
    } else {
        if (!botValidationCapacityScan?.available) {
            failures.push(buildFailure('validation-lane-telemetry-missing', {
                artifact: 'bot-validation-report',
                path: botValidation?.source?.reportPath || null,
            }));
        } else {
            const reportIo = botValidationCapacityScan.reportIo && typeof botValidationCapacityScan.reportIo === 'object'
                ? botValidationCapacityScan.reportIo
                : null;
            const stageTimings = botValidationCapacityScan.stageTimingsMs && typeof botValidationCapacityScan.stageTimingsMs === 'object'
                ? botValidationCapacityScan.stageTimingsMs
                : {};
            if (
                reportIo?.jsonWriteMs == null
                || reportIo?.markdownWriteMs == null
                || reportIo?.totalWriteMs == null
                || toFiniteNumber(reportIo?.totalBytes, 0) <= 0
            ) {
                failures.push(buildFailure('report-io-missing', {
                    artifact: 'bot-validation-report',
                    path: botValidation?.source?.reportPath || null,
                }));
            }
            if (
                stageTimings.reportWrite == null
                || stageTimings.scenarioEval == null
                || stageTimings.total == null
            ) {
                failures.push(buildFailure('validation-lane-telemetry-missing', {
                    artifact: 'bot-validation-report',
                    path: botValidation?.source?.reportPath || null,
                }));
            }
            if (botValidation?.runner?.serverMode === 'preview') {
                const preview = botValidationCapacityScan.preview && typeof botValidationCapacityScan.preview === 'object'
                    ? botValidationCapacityScan.preview
                    : null;
                const previewBuildRequested = preview?.buildRequested === true
                    || botValidation?.runner?.previewBuildBeforeStart === true;
                if (
                    preview?.active !== true
                    || typeof preview?.serverReused !== 'boolean'
                    || preview?.serverStartElapsedMs == null
                    || (
                        previewBuildRequested
                        && (
                            preview?.buildPerformed !== true
                            || preview?.buildElapsedMs == null
                        )
                    )
                ) {
                    failures.push(buildFailure('preview-lane-missing', {
                        artifact: 'bot-validation-report',
                        path: botValidation?.source?.reportPath || null,
                    }));
                }
            }
            if (botValidation?.runner?.publishEvidence === true) {
                const publish = botValidationCapacityScan.publish && typeof botValidationCapacityScan.publish === 'object'
                    ? botValidationCapacityScan.publish
                    : null;
                if (
                    publish?.requested !== true
                    || publish?.jsonWriteMs == null
                    || publish?.markdownWriteMs == null
                    || publish?.totalWriteMs == null
                    || toFiniteNumber(publish?.totalBytes, 0) <= 0
                    || publish?.wroteCanonicalJson !== true
                    || publish?.wroteCanonicalMarkdown !== true
                    || !Array.isArray(publish?.writes)
                    || publish.writes.length < 2
                ) {
                    failures.push(buildFailure('publish-lane-missing', {
                        artifact: 'bot-validation-report',
                        path: botValidation?.source?.reportPath || null,
                    }));
                }
            }
        }
    }
    if (!runArtifact?.hardwareTelemetry && !trainerArtifact?.hardwareTelemetry) {
        failures.push(buildFailure('hardware-telemetry-missing', { artifact: 'hardware-telemetry' }));
    }
    if (runArtifact?.resume?.requested && runArtifact?.resume?.loaded !== true) {
        failures.push(buildFailure('resume-failed', {
            artifact: 'resume-health',
            path: runArtifact?.resume?.sourcePath || null,
            details: runArtifact?.resume || null,
        }));
    }
    if (expectedSemanticWindowId && semanticWindowId && semanticWindowId !== expectedSemanticWindowId) {
        failures.push(buildFailure('semantics-mismatch', {
            expected: expectedSemanticWindowId,
            actual: semanticWindowId,
        }));
    }
    if (expectedMatrixVersion && matrixVersion && matrixVersion !== expectedMatrixVersion) {
        failures.push(buildFailure('benchmark-matrix-mismatch', {
            expected: expectedMatrixVersion,
            actual: matrixVersion,
        }));
    }
    if (promotionEligible && !runtimeNear) {
        failures.push(buildFailure('runtime-lane-missing', {
            expected: 'runtime-near',
            actual: environmentProfile,
        }));
    }

    return {
        ok: failures.length === 0,
        status: failures.length === 0 ? 'pass' : 'fail',
        failures,
        warnings,
        counts: summarizeFailureCodes(failures),
    };
}

export function evaluateBenchmarkProfileGuardrails(input = {}) {
    const failures = [];
    const warnings = [];
    const profile = input.profile && typeof input.profile === 'object' ? input.profile : null;
    if (!profile?.guardrails) {
        return {
            ok: true,
            status: 'pass',
            checks: [],
            failures,
            warnings,
        };
    }

    const guardrails = profile.guardrails;
    const bridgeTelemetry = input.bridgeTelemetry && typeof input.bridgeTelemetry === 'object'
        ? input.bridgeTelemetry
        : {};
    const opsKpis = input.opsKpis && typeof input.opsKpis === 'object'
        ? input.opsKpis
        : {};
    const pendingAckCount = Math.max(0, Math.trunc(toFiniteNumber(bridgeTelemetry.pendingAckCount, 0)));
    const maxPendingAcks = Math.max(1, Math.trunc(toFiniteNumber(bridgeTelemetry.maxPendingAcks, profile.bridge?.maxPendingAcks || 1)));
    const pendingAckRatio = roundMetric(pendingAckCount / maxPendingAcks);
    const latencyP95Ms = toFiniteNumber(
        opsKpis.bridgeLatencyP95Ms,
        toFiniteNumber(bridgeTelemetry.latencyP95Ms, 0)
    );
    const timeoutRate = toFiniteNumber(opsKpis.timeoutRate, 0);
    const fallbackRate = toFiniteNumber(opsKpis.fallbackRate, 0);
    const backpressureDrops = Math.max(0, Math.trunc(toFiniteNumber(bridgeTelemetry.backpressureDrops, 0)));
    const artifactBacklogCount = Math.max(0, Math.trunc(toFiniteNumber(input.artifactBacklogCount, 0)));
    const resumeFailures = input.resumeRequested && input.resumeLoaded !== true ? 1 : 0;
    const hardwareTelemetry = input.hardwareTelemetry && typeof input.hardwareTelemetry === 'object'
        ? input.hardwareTelemetry
        : null;

    if (latencyP95Ms > guardrails.maxLatencyP95Ms) {
        failures.push(buildFailure('latency-spike', {
            value: roundMetric(latencyP95Ms),
            hardLimit: guardrails.maxLatencyP95Ms,
        }));
    }
    if (timeoutRate > guardrails.maxTimeoutRate) {
        failures.push(buildFailure('bridge-timeout', {
            value: roundMetric(timeoutRate),
            hardLimit: guardrails.maxTimeoutRate,
        }));
    }
    if (fallbackRate > guardrails.maxFallbackRate) {
        failures.push(buildFailure('bridge-fallback', {
            value: roundMetric(fallbackRate),
            hardLimit: guardrails.maxFallbackRate,
        }));
    }
    if (backpressureDrops > guardrails.maxBackpressureDrops || pendingAckRatio > guardrails.maxPendingAckRatio) {
        failures.push(buildFailure('backpressure', {
            backpressureDrops,
            pendingAckRatio,
            maxBackpressureDrops: guardrails.maxBackpressureDrops,
            maxPendingAckRatio: guardrails.maxPendingAckRatio,
        }));
    }
    if (artifactBacklogCount > guardrails.maxArtifactBacklog) {
        failures.push(buildFailure('artifact-backlog', {
            value: artifactBacklogCount,
            hardLimit: guardrails.maxArtifactBacklog,
        }));
    }
    if (resumeFailures > guardrails.maxResumeFailures) {
        failures.push(buildFailure('resume-failed', {
            value: resumeFailures,
            hardLimit: guardrails.maxResumeFailures,
        }));
    }
    if (guardrails.temperatureC != null) {
        const temperatureC = toFiniteNumber(hardwareTelemetry?.thermal?.temperatureC, null);
        if (temperatureC != null && temperatureC > guardrails.temperatureC) {
            failures.push(buildFailure('latency-spike', {
                metric: 'temperatureC',
                value: roundMetric(temperatureC),
                hardLimit: guardrails.temperatureC,
            }));
        }
    } else {
        warnings.push(buildFailure('temperature-unavailable', {
            artifact: 'hardware-telemetry',
        }));
    }

    const checks = [
        { metric: 'bridgeLatencyP95Ms', value: roundMetric(latencyP95Ms), hardLimit: guardrails.maxLatencyP95Ms },
        { metric: 'timeoutRate', value: roundMetric(timeoutRate), hardLimit: guardrails.maxTimeoutRate },
        { metric: 'fallbackRate', value: roundMetric(fallbackRate), hardLimit: guardrails.maxFallbackRate },
        { metric: 'backpressureDrops', value: backpressureDrops, hardLimit: guardrails.maxBackpressureDrops },
        { metric: 'pendingAckRatio', value: pendingAckRatio, hardLimit: guardrails.maxPendingAckRatio },
        { metric: 'artifactBacklogCount', value: artifactBacklogCount, hardLimit: guardrails.maxArtifactBacklog },
        { metric: 'resumeFailures', value: resumeFailures, hardLimit: guardrails.maxResumeFailures },
    ];

    return {
        ok: failures.length === 0,
        status: failures.length === 0 ? 'pass' : 'fail',
        checks,
        failures,
        warnings,
    };
}

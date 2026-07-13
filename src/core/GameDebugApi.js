import { BotValidationService } from '../state/validation/BotValidationService.js';
import { BotPlayAnalysisService } from '../state/validation/BotPlayAnalysisService.js';
import { DeveloperTrainingController } from './DeveloperTrainingController.js';
import { createRuntimeAccess } from '../shared/runtime/RuntimeAccessFactory.js';
import {
    TRAINING_AUTOMATION_CONTRACT_VERSION,
    TRAINING_GATE_CONTRACT_VERSION,
} from '../shared/contracts/TrainingRuntimeContract.js';
import { toFiniteNumber } from '../utils/MathOps.js';
import {
    buildDeterministicStepPayload,
    buildTrainingKpis,
    cloneSerializable,
    createArtifactPaths,
    normalizeAutomationConfig,
    normalizeGateThresholds,
    roundMetric,
    toInt,
} from './debug/GameDebugTrainingFacade.js';

export function createGameDebugRuntimeAccess(runtime) {
    return createRuntimeAccess(runtime, (game) => {
        const actionShowStatusToast = (message, durationMs, tone) => {
            game?._showStatusToast?.(message, durationMs, tone);
        };
        const actionApplyValidationScenario = (validationService, idOrIndex = 0) => (
            validationService?.applyScenario?.(game, idOrIndex) || null
        );
        return {
        getRecorder: () => game?.recorder || null,
        getRuntimePerfProfiler: () => game?.runtimePerfProfiler || null,
        getMediaRecorderSystem: () => game?.mediaRecorderSystem || null,
        setRecorderFrameCaptureEnabled(enabled) {
            if (!game) return;
            game._recorderFrameCaptureEnabled = !!enabled;
            if (game.recorder?.setFrameCaptureEnabled) {
                game.recorder.setFrameCaptureEnabled(game._recorderFrameCaptureEnabled);
            }
        },
        actionShowStatusToast,
        actionApplyValidationScenario,
        // Backward-compatible aliases for transitional call sites.
        showStatusToast: actionShowStatusToast,
        applyValidationScenario: actionApplyValidationScenario,
        getEntityManager: () => game?.entityManager || null,
    };
    });
}

export class GameDebugApi {
    constructor(runtimeAccess = {}) {
        this.runtimeAccess = runtimeAccess && typeof runtimeAccess === 'object'
            ? runtimeAccess
            : {};
        this.validationService = new BotValidationService({
            getRecorder: () => this.runtimeAccess.getRecorder?.() || null,
        });
        this.botPlayAnalysis = new BotPlayAnalysisService({
            enabled: this.resolveAutoBotPlayAnalysisEnabledDefault(),
            roundInterval: this.resolveAutoBotPlayAnalysisRoundIntervalDefault(),
            logger: console,
            onReport: (report) => this._onBotPlayAnalysisReport(report),
        });
        this._unbindBotPlayAnalysisRecorder = null;
        this.trainingController = new DeveloperTrainingController();
        this.trainingAutomationState = {
            latestBatch: null,
            latestEval: null,
            latestGate: null,
        };
    }

    getRuntimePerformanceSnapshot(options = {}) {
        const profiler = this.runtimeAccess.getRuntimePerfProfiler?.() || null;
        const performance = typeof profiler?.getSnapshot === 'function'
            ? profiler.getSnapshot(options)
            : null;
        const recorder = this.runtimeAccess.getMediaRecorderSystem?.()?.getRecordingDiagnostics?.() || null;
        return {
            performance,
            recorder,
        };
    }

    resetRuntimePerformanceSamples() {
        const profiler = this.runtimeAccess.getRuntimePerfProfiler?.() || null;
        if (typeof profiler?.reset !== 'function') {
            return false;
        }
        profiler.reset();
        return true;
    }

    resolveRecorderFrameCaptureEnabledDefault() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const raw = params.get('recordframes') || params.get('recorderFrames');
            if (!raw) return false;
            const normalized = String(raw).trim().toLowerCase();
            return normalized === '1' || normalized === 'true' || normalized === 'on';
        } catch {
            return false;
        }
    }

    setRecorderFrameCaptureEnabled(enabled) {
        this.runtimeAccess.setRecorderFrameCaptureEnabled?.(enabled);
    }

    resolveAutoBotPlayAnalysisEnabledDefault() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const raw = params.get('botAnalysis') || params.get('botPlayAnalysis');
            if (raw == null) return true;
            const normalized = String(raw).trim().toLowerCase();
            return !['0', 'false', 'off', 'no'].includes(normalized);
        } catch {
            return true;
        }
    }

    resolveAutoBotPlayAnalysisRoundIntervalDefault() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const raw = Number(params.get('botAnalysisRounds') || params.get('botPlayAnalysisRounds'));
            return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 3;
        } catch {
            return 3;
        }
    }

    bindBotPlayAnalysisRecorder(recorder) {
        this._unbindBotPlayAnalysisRecorder?.();
        this._unbindBotPlayAnalysisRecorder = null;
        if (!recorder?.onRoundFinalized) return false;
        this._unbindBotPlayAnalysisRecorder = recorder.onRoundFinalized((roundSummary, sourceRecorder) => {
            this.botPlayAnalysis.handleRoundFinalized(sourceRecorder, roundSummary);
        });
        return true;
    }

    configureBotPlayAnalysis(options = {}) {
        return this.botPlayAnalysis.configure(options);
    }

    runBotPlayAnalysis(options = {}) {
        const recorder = this.runtimeAccess.getRecorder?.() || null;
        const limit = Number(options?.limit);
        const rounds = recorder?.getRoundSummaries?.(Number.isFinite(limit) ? limit : null) || [];
        return this.botPlayAnalysis.runAnalysis(rounds);
    }

    getBotPlayAnalysisStatus() {
        return this.botPlayAnalysis.getStatus();
    }

    _onBotPlayAnalysisReport(report) {
        const findingCount = Array.isArray(report?.findings) ? report.findings.length : 0;
        const highCount = Array.isArray(report?.findings)
            ? report.findings.filter((finding) => finding.severity === 'high').length
            : 0;
        if (findingCount > 0) {
            this.runtimeAccess.actionShowStatusToast?.(
                `Bot-Analyse: ${findingCount} Hinweise (${highCount} hoch)`,
                2600,
                highCount > 0 ? 'warning' : 'info'
            );
        }
    }

    captureBotBaseline(label = 'BASELINE') {
        const baseline = this.validationService.captureBaseline(label);
        const normalized = String(baseline?.label || label || 'BASELINE').toUpperCase();
        this.runtimeAccess.actionShowStatusToast?.(`Bot-Baseline gespeichert: ${normalized}`);
        console.log(`[Validation] Baseline gespeichert (${normalized}):`, baseline);
        return baseline;
    }

    printBotValidationReport(label = 'BASELINE') {
        const report = this.validationService.buildValidationReport(label);
        console.log('[Validation] report:', report);
        return report;
    }

    getBotValidationMatrix() {
        return this.validationService.getValidationMatrix();
    }

    printBotTestProtocol() {
        const protocol = this.validationService.buildTestProtocol();
        console.log('[Validation] Bot-Testprotokoll:', protocol);
        return protocol;
    }

    applyBotValidationScenario(idOrIndex = 0) {
        const scenario = this.runtimeAccess.actionApplyValidationScenario?.(
            this.validationService,
            idOrIndex
        ) || null;
        if (!scenario) return null;

        this.runtimeAccess.actionShowStatusToast?.(`Szenario ${scenario.id} geladen`);
        console.log('[Validation] scenario loaded:', scenario);
        return scenario;
    }

    resetTrainingSession(input = {}) {
        return this.trainingController.reset(input);
    }

    stepTrainingSession(input = {}) {
        return this.trainingController.step(input);
    }

    runTrainingAutoSteps(input = {}) {
        return this.trainingController.autoStep(input);
    }

    getTrainingSessionSnapshot() {
        return this.trainingController.getSnapshot();
    }

    runTrainingBatch(input = {}) {
        const result = this._runTrainingAutomation('run', input);
        this.trainingAutomationState.latestBatch = cloneSerializable(result);
        return result;
    }

    runTrainingEval(input = {}) {
        const result = this._runTrainingAutomation('eval', input);
        this.trainingAutomationState.latestEval = cloneSerializable(result);
        return result;
    }

    runTrainingGate(input = {}) {
        const payload = input && typeof input === 'object' ? input : {};
        const sourceThresholds = payload.gateThresholds && typeof payload.gateThresholds === 'object'
            ? payload.gateThresholds
            : payload;
        const thresholds = normalizeGateThresholds(sourceThresholds);

        let source = 'latest-eval';
        let evalResult = payload.evalResult && typeof payload.evalResult === 'object'
            ? payload.evalResult
            : this.trainingAutomationState.latestEval;
        if (payload.evalResult && typeof payload.evalResult === 'object') {
            source = 'provided-eval';
        }
        if (!evalResult) {
            evalResult = this.runTrainingEval(payload);
            source = 'auto-eval';
        }

        const kpis = evalResult?.kpis || buildTrainingKpis([], 0);
        const checks = [
            {
                kpiId: 'episodeReturnMean',
                operator: '>=',
                threshold: thresholds.minEpisodeReturnMean,
                actual: roundMetric(kpis.episodeReturnMean),
            },
            {
                kpiId: 'terminalRate',
                operator: '>=',
                threshold: thresholds.minTerminalRate,
                actual: roundMetric(kpis.terminalRate),
            },
            {
                kpiId: 'truncationRate',
                operator: '<=',
                threshold: thresholds.maxTruncationRate,
                actual: roundMetric(kpis.truncationRate),
            },
            {
                kpiId: 'invalidActionRate',
                operator: '<=',
                threshold: thresholds.maxInvalidActionRate,
                actual: roundMetric(kpis.invalidActionRate),
            },
            {
                kpiId: 'runtimeErrorCount',
                operator: '<=',
                threshold: thresholds.maxRuntimeErrorCount,
                actual: toInt(kpis.runtimeErrorCount, 0, 0, Number.MAX_SAFE_INTEGER),
            },
        ].map((entry) => ({
            ...entry,
            pass: entry.operator === '>='
                ? entry.actual >= entry.threshold
                : entry.actual <= entry.threshold,
        }));

        const pass = checks.every((entry) => !!entry.pass);
        const stamp = String(evalResult?.stamp || createRunStamp());
        const artifacts = evalResult?.artifacts && typeof evalResult.artifacts === 'object'
            ? { ...evalResult.artifacts }
            : createArtifactPaths(stamp);
        const result = {
            contractVersion: TRAINING_GATE_CONTRACT_VERSION,
            stamp,
            source,
            generatedAt: new Date().toISOString(),
            sourceArtifactPath: evalResult?.artifactPath || artifacts.eval,
            artifactPath: artifacts.gate,
            artifacts,
            thresholds,
            kpis,
            checks,
            pass,
            exitCode: pass ? 0 : 1,
        };

        this.trainingAutomationState.latestGate = cloneSerializable(result);
        return result;
    }

    getTrainingAutomationSnapshot() {
        return cloneSerializable(this.trainingAutomationState);
    }

    getTrainerBridgeRuntimeSnapshot() {
        const entityManager = this.runtimeAccess.getEntityManager?.() || null;
        if (!entityManager || !(entityManager.botByPlayer instanceof Map)) {
            return {
                available: false,
                reason: 'entity-manager-unavailable',
                bots: [],
                totals: null,
            };
        }
        const bots = [];
        const totals = {
            botCount: 0,
            bridgeEnabledCount: 0,
            timeoutCount: 0,
            fallbackCount: 0,
            failureCount: 0,
            actionRequestCount: 0,
            actionResponseCount: 0,
        };
        for (const [player, policy] of entityManager.botByPlayer.entries()) {
            const status = typeof policy?.getTrainerBridgeStatus === 'function'
                ? policy.getTrainerBridgeStatus()
                : null;
            const telemetry = status?.telemetry
                || (typeof policy?.getTrainerBridgeTelemetry === 'function'
                    ? policy.getTrainerBridgeTelemetry()
                    : null)
                || null;
            const botSnapshot = {
                index: Number(player?.index ?? -1),
                policyType: String(policy?.type || ''),
                bridgeEnabled: !!status?.enabled,
                resume: status?.resume || null,
                telemetry: telemetry || null,
            };
            bots.push(botSnapshot);
            totals.botCount += 1;
            if (botSnapshot.bridgeEnabled) {
                totals.bridgeEnabledCount += 1;
            }
            totals.timeoutCount += toInt(telemetry?.timeouts, 0, 0, Number.MAX_SAFE_INTEGER);
            totals.fallbackCount += toInt(telemetry?.fallbacks, 0, 0, Number.MAX_SAFE_INTEGER);
            totals.failureCount += toInt(telemetry?.failures, 0, 0, Number.MAX_SAFE_INTEGER);
            totals.actionRequestCount += toInt(telemetry?.actionRequests, 0, 0, Number.MAX_SAFE_INTEGER);
            totals.actionResponseCount += toInt(telemetry?.actionResponses, 0, 0, Number.MAX_SAFE_INTEGER);
        }
        totals.timeoutRate = roundMetric(
            totals.actionRequestCount > 0 ? (totals.timeoutCount / totals.actionRequestCount) : 0
        );
        totals.fallbackRate = roundMetric(
            totals.actionRequestCount > 0 ? (totals.fallbackCount / totals.actionRequestCount) : 0
        );
        totals.actionCoverage = roundMetric(
            totals.actionRequestCount > 0 ? (totals.actionResponseCount / totals.actionRequestCount) : 0
        );

        return {
            available: true,
            generatedAt: new Date().toISOString(),
            bots,
            totals,
        };
    }

    _runTrainingAutomation(kind = 'run', input = {}) {
        const config = normalizeAutomationConfig(input);
        const stamp = createRunStamp();
        const artifacts = createArtifactPaths(stamp);
        const artifactPath = kind === 'eval' ? artifacts.eval : artifacts.run;
        const episodes = [];
        let runtimeErrorCount = 0;
        let episodeIndex = 0;

        for (const modeId of config.modes) {
            const domainMode = normalizeDomainMode(modeId);
            if (!domainMode) continue;
            for (const seed of config.seeds) {
                for (let episodeOffset = 0; episodeOffset < config.episodes; episodeOffset += 1) {
                    const episodeSeed = seed + episodeOffset;
                    const episodeResult = this._runTrainingAutomationEpisode({
                        ...domainMode,
                        seed: episodeSeed,
                        episodeIndex,
                        maxSteps: config.maxSteps,
                        inventoryLength: config.inventoryLength,
                        timeoutMs: config.timeoutMs,
                    });
                    episodes.push(episodeResult);
                    if (episodeResult.runtimeError) {
                        runtimeErrorCount += 1;
                    }
                    episodeIndex += 1;
                }
            }
        }

        const kpis = buildTrainingKpis(episodes, runtimeErrorCount);
        return {
            contractVersion: TRAINING_AUTOMATION_CONTRACT_VERSION,
            kind,
            generatedAt: new Date().toISOString(),
            stamp,
            config: {
                ...config,
                seeds: [...config.seeds],
                modes: [...config.modes],
            },
            artifactPath,
            artifacts,
            kpis,
            episodes,
            summary: {
                episodesTotal: kpis.episodesTotal,
                stepsTotal: kpis.stepsTotal,
                runtimeErrorCount: kpis.runtimeErrorCount,
            },
        };
    }

    _runTrainingAutomationEpisode({
        mode,
        planarMode,
        domainId,
        seed,
        episodeIndex,
        maxSteps,
        inventoryLength,
        timeoutMs,
    }) {
        let latestTransition = null;
        let episodeReturn = 0;
        let stepsExecuted = 0;
        let invalidActionCount = 0;

        try {
            this.trainingController.reset({
                mode,
                planarMode,
                maxSteps,
                seed,
                inventoryLength,
            });

            const startedAt = Date.now();
            for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
                if ((Date.now() - startedAt) > timeoutMs) {
                    const timeoutSnapshot = this.trainingController.step({
                        mode,
                        planarMode,
                        maxSteps,
                        seed: seed + stepIndex + 1,
                        inventoryLength,
                        action: {},
                        rewardSignals: {
                            survival: false,
                        },
                        truncated: true,
                        truncatedReason: 'timeout',
                    });
                    latestTransition = timeoutSnapshot?.latestTransition || null;
                    episodeReturn += toFiniteNumber(latestTransition?.reward, 0);
                    stepsExecuted += 1;
                    break;
                }

                const stepPayload = buildDeterministicStepPayload({
                    mode,
                    planarMode,
                    seed,
                    stepIndex,
                    maxSteps,
                    inventoryLength,
                });
                const snapshot = this.trainingController.step({
                    mode,
                    planarMode,
                    maxSteps,
                    seed: seed + stepIndex + 1,
                    inventoryLength,
                    action: stepPayload.action,
                    rewardSignals: stepPayload.rewardSignals,
                    done: stepPayload.done,
                    terminalReason: stepPayload.terminalReason,
                });
                latestTransition = snapshot?.latestTransition || null;
                episodeReturn += toFiniteNumber(latestTransition?.reward, 0);
                stepsExecuted += 1;
                if (stepPayload.invalidAction) {
                    invalidActionCount += 1;
                }
                if (latestTransition?.done || latestTransition?.truncated) {
                    break;
                }
            }

            return {
                episodeId: latestTransition?.episodeId || `episode-${episodeIndex + 1}`,
                episodeIndex,
                seed,
                domainId,
                mode,
                planarMode,
                stepsExecuted,
                episodeReturn: roundMetric(episodeReturn),
                invalidActionCount,
                done: !!latestTransition?.done,
                truncated: !!latestTransition?.truncated,
                terminalReason: latestTransition?.terminalReason || null,
                truncatedReason: latestTransition?.truncatedReason || null,
                runtimeError: false,
            };
        } catch (error) {
            return {
                episodeId: `episode-${episodeIndex + 1}`,
                episodeIndex,
                seed,
                domainId,
                mode,
                planarMode,
                stepsExecuted,
                episodeReturn: roundMetric(episodeReturn),
                invalidActionCount,
                done: false,
                truncated: false,
                terminalReason: null,
                truncatedReason: null,
                runtimeError: true,
                runtimeErrorMessage: String(error?.message || 'training-automation-error'),
            };
        }
    }
}

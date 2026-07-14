// ============================================
// MenuRuntimeDeveloperTrainingService.js - developer-panel training actions
// ============================================

function setTrainingOutput(ui, snapshot) {
    if (!ui?.developerTrainingOutput) return;
    if (!snapshot || typeof snapshot !== 'object') {
        ui.developerTrainingOutput.textContent = 'Kein Training ausgefuehrt.';
        return;
    }
    ui.developerTrainingOutput.textContent = JSON.stringify(snapshot, null, 2);
}

function syncSeedInput(ui, seed) {
    if (!ui?.developerTrainingSeedInput) return;
    const numericSeed = Number(seed);
    if (!Number.isFinite(numericSeed)) return;
    ui.developerTrainingSeedInput.value = String(Math.max(0, Math.trunc(numericSeed)));
}

function resolveTransitionLabel(snapshot) {
    const transition = snapshot?.latestTransition;
    if (!transition) return 'Training';
    const operation = String(transition.operation || 'step');
    const stepIndex = Number.isFinite(Number(transition.stepIndex)) ? Number(transition.stepIndex) : 0;
    return `${operation} @ step ${stepIndex}`;
}

function ensureTrainingApi(game) {
    if (!game?.debugApi) return false;
    return typeof game.debugApi.resetTrainingSession === 'function'
        && typeof game.debugApi.stepTrainingSession === 'function';
}

function ensureTrainingAutomationApi(game) {
    if (!ensureTrainingApi(game)) return false;
    return typeof game.debugApi.runTrainingBatch === 'function'
        && typeof game.debugApi.runTrainingEval === 'function'
        && typeof game.debugApi.runTrainingGate === 'function';
}

function resolveArtifactPath(result, fallback = 'n/a') {
    const artifactPath = result?.artifactPath;
    if (typeof artifactPath === 'string' && artifactPath.trim().length > 0) {
        return artifactPath.trim();
    }
    return fallback;
}

function resolveKpiSummary(result) {
    const kpis = result?.kpis && typeof result.kpis === 'object'
        ? result.kpis
        : null;
    if (!kpis) return 'KPI n/a';
    const mean = Number(kpis.episodeReturnMean || 0).toFixed(3);
    const terminalRate = Number(kpis.terminalRate || 0).toFixed(3);
    const truncationRate = Number(kpis.truncationRate || 0).toFixed(3);
    const invalidActionRate = Number(kpis.invalidActionRate || 0).toFixed(3);
    const runtimeErrors = Number(kpis.runtimeErrorCount || 0);
    return `mean=${mean}, terminal=${terminalRate}, trunc=${truncationRate}, invalid=${invalidActionRate}, errors=${runtimeErrors}`;
}

function appendRuntimeBridgeSnapshot(game, result) {
    if (!result || typeof result !== 'object') return result;
    const bridgeSnapshot = typeof game?.debugApi?.getTrainerBridgeRuntimeSnapshot === 'function'
        ? game.debugApi.getTrainerBridgeRuntimeSnapshot()
        : null;
    if (!bridgeSnapshot) return result;
    return {
        ...result,
        runtimeBridge: bridgeSnapshot,
    };
}

export function handleDeveloperTrainingResetAction({ game, event }) {
    if (!ensureTrainingApi(game)) {
        game?._showStatusToast?.('Training-API nicht verfuegbar.', 1600, 'error');
        return null;
    }
    const snapshot = game.debugApi.resetTrainingSession(event || {});
    setTrainingOutput(game.ui, snapshot);
    syncSeedInput(game.ui, snapshot?.seed);
    const domainId = snapshot?.latestTransition?.domainId || 'unknown-domain';
    game?._showStatusToast?.(`Training reset: ${domainId}`, 1300, 'info');
    return snapshot;
}

export function handleDeveloperTrainingStepAction({ game, event }) {
    if (!ensureTrainingApi(game)) {
        game?._showStatusToast?.('Training-API nicht verfuegbar.', 1600, 'error');
        return null;
    }
    const snapshot = game.debugApi.stepTrainingSession(event || {});
    setTrainingOutput(game.ui, snapshot);
    syncSeedInput(game.ui, snapshot?.seed);
    const transition = snapshot?.latestTransition;
    if (transition?.done || transition?.truncated) {
        const reason = transition?.terminalReason || transition?.truncatedReason || 'terminal';
        game?._showStatusToast?.(`Training episode beendet: ${reason}`, 1500, 'info');
        return snapshot;
    }
    game?._showStatusToast?.(`${resolveTransitionLabel(snapshot)} reward=${Number(transition?.reward || 0).toFixed(3)}`, 1300, 'info');
    return snapshot;
}

export function handleDeveloperTrainingAutoStepAction({ game, event }) {
    if (!ensureTrainingApi(game) || typeof game?.debugApi?.runTrainingAutoSteps !== 'function') {
        game?._showStatusToast?.('Training-API nicht verfuegbar.', 1600, 'error');
        return null;
    }
    const snapshot = game.debugApi.runTrainingAutoSteps(event || {});
    setTrainingOutput(game.ui, snapshot);
    syncSeedInput(game.ui, snapshot?.seed);

    const autoSummary = snapshot?.autoStep && typeof snapshot.autoStep === 'object'
        ? snapshot.autoStep
        : null;
    const transition = snapshot?.latestTransition || null;
    if (transition?.done || transition?.truncated) {
        const reason = transition?.terminalReason || transition?.truncatedReason || 'terminal';
        const executed = Number(autoSummary?.executedSteps || 0);
        game?._showStatusToast?.(`Auto Step beendet (${executed}): ${reason}`, 1500, 'info');
        return snapshot;
    }

    const executed = Number(autoSummary?.executedSteps || 0);
    game?._showStatusToast?.(`Auto Step: ${executed} Schritte, reward=${Number(transition?.reward || 0).toFixed(3)}`, 1500, 'info');
    return snapshot;
}

export function handleDeveloperTrainingRunBatchAction({ game, event }) {
    if (!ensureTrainingAutomationApi(game)) {
        game?._showStatusToast?.('Training-Automation nicht verfuegbar.', 1700, 'error');
        return null;
    }
    const result = game.debugApi.runTrainingBatch(event || {});
    const output = appendRuntimeBridgeSnapshot(game, result);
    setTrainingOutput(game.ui, output);
    const firstSeed = Array.isArray(output?.config?.seeds) ? output.config.seeds[0] : null;
    syncSeedInput(game.ui, firstSeed);
    const episodesTotal = Number(output?.summary?.episodesTotal || 0);
    const artifactPath = resolveArtifactPath(output);
    game?._showStatusToast?.(`Run Batch abgeschlossen (${episodesTotal} Episoden) | ${resolveKpiSummary(output)} | ${artifactPath}`, 2600, 'info');
    return output;
}

export function handleDeveloperTrainingRunEvalAction({ game, event }) {
    if (!ensureTrainingAutomationApi(game)) {
        game?._showStatusToast?.('Training-Automation nicht verfuegbar.', 1700, 'error');
        return null;
    }
    const result = game.debugApi.runTrainingEval(event || {});
    const output = appendRuntimeBridgeSnapshot(game, result);
    setTrainingOutput(game.ui, output);
    const firstSeed = Array.isArray(output?.config?.seeds) ? output.config.seeds[0] : null;
    syncSeedInput(game.ui, firstSeed);
    const episodesTotal = Number(output?.summary?.episodesTotal || 0);
    const artifactPath = resolveArtifactPath(output);
    game?._showStatusToast?.(`Run Eval abgeschlossen (${episodesTotal} Episoden) | ${resolveKpiSummary(output)} | ${artifactPath}`, 2600, 'info');
    return output;
}

export function handleDeveloperTrainingRunGateAction({ game, event }) {
    if (!ensureTrainingAutomationApi(game)) {
        game?._showStatusToast?.('Training-Automation nicht verfuegbar.', 1700, 'error');
        return null;
    }
    const result = game.debugApi.runTrainingGate(event || {});
    const output = appendRuntimeBridgeSnapshot(game, result);
    setTrainingOutput(game.ui, output);
    const tone = output?.pass ? 'success' : 'error';
    const label = output?.pass ? 'PASS' : 'FAIL';
    const artifactPath = resolveArtifactPath(output);
    const exitCode = Number(output?.exitCode || 1);
    game?._showStatusToast?.(`Run Gate ${label} (exit=${exitCode}) | ${resolveKpiSummary(output)} | ${artifactPath}`, 2800, tone);
    return output;
}

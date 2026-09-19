import { createSurfacePolicyPort } from './SurfacePolicyPort.js';

function resolveCallback(callback, fallback) {
    return typeof callback === 'function' ? callback : fallback;
}

export function createStartSetupControllerPort(deps = {}) {
    const getSettings = resolveCallback(deps.getSettings, () => null);
    const getSettingsManager = resolveCallback(deps.getSettingsManager, () => null);
    const getMapDefinitions = resolveCallback(deps.getMapDefinitions, () => ({}));
    const getMultiplayerSessionState = resolveCallback(deps.getMultiplayerSessionState, () => null);
    const resolveSurfacePolicy = resolveCallback(deps.resolveSurfacePolicy, () => null);
    const getProductSurfaceId = resolveCallback(deps.getProductSurfaceId, () => '');
    const refreshLocalMapCatalog = resolveCallback(deps.refreshLocalMapCatalog, () => false);

    const surfacePolicyPort = createSurfacePolicyPort({
        getProductSurfaceId,
        getSettings,
    });

    return Object.freeze({
        getSettings: () => getSettings(),
        getSettingsManager: () => getSettingsManager(),
        getMapDefinitions: () => getMapDefinitions() || {},
        getMultiplayerSessionState: () => getMultiplayerSessionState() || null,
        resolveSurfacePolicy: (settings = undefined) => resolveSurfacePolicy(settings) || null,
        refreshLocalMapCatalog: () => refreshLocalMapCatalog() === true,
        surfacePolicyPort,
    });
}

export function createNavigationLifecyclePort(deps = {}) {
    const getSettings = resolveCallback(deps.getSettings, () => null);
    const getActiveSubmenu = resolveCallback(deps.getActiveSubmenu, () => null);
    const setActiveSubmenu = resolveCallback(deps.setActiveSubmenu, () => null);
    const persistMenuState = resolveCallback(deps.persistMenuState, () => null);
    const getExpertLoginRuntime = resolveCallback(deps.getExpertLoginRuntime, () => null);
    const getSettingsDirty = resolveCallback(deps.getSettingsDirty, () => false);
    const getActiveProfileName = resolveCallback(deps.getActiveProfileName, () => '');
    const updateToolsState = resolveCallback(deps.updateToolsState, () => null);
    const normalizeProfileName = resolveCallback(
        deps.normalizeProfileName,
        (profileName) => String(profileName || '').trim()
    );

    return Object.freeze({
        getSettings: () => getSettings(),
        getActiveSubmenu: () => getActiveSubmenu() || null,
        setActiveSubmenu: (panelId) => setActiveSubmenu(panelId || null),
        persistMenuState: (state, transition = null) => persistMenuState(state, transition),
        getExpertLoginRuntime: () => getExpertLoginRuntime() || null,
        getSettingsDirty: () => getSettingsDirty() === true,
        getActiveProfileName: () => String(getActiveProfileName() || '').trim(),
        updateToolsState: (patch = null) => updateToolsState(patch && typeof patch === 'object' ? patch : null),
        normalizeProfileName: (profileName) => normalizeProfileName(profileName),
    });
}

export function createStartSetupControllerPortFromManager({
    manager = null,
    game = null,
    settingsManager = null,
    getMapDefinitions = null,
} = {}) {
    return createStartSetupControllerPort({
        getSettings: () => manager?.settings || null,
        getSettingsManager: () => settingsManager || manager?.settingsManager || null,
        getMapDefinitions: () => (typeof getMapDefinitions === 'function' ? getMapDefinitions() : {}),
        getMultiplayerSessionState: () => game?.menuMultiplayerBridge?.getSessionState?.() || null,
        resolveSurfacePolicy: (settings = manager?.settings) => manager?.resolveSurfacePolicy?.(settings || manager?.settings) || null,
        getProductSurfaceId: () => game?.uiManager?._runtimeFeatureFlags?.surfacePolicy?.productSurfaceId || manager?.settings?.localSettings?.toolsState?.surfacePolicy?.productSurfaceId || '',
        refreshLocalMapCatalog: () => game?.runtimeCoordinator?.refreshLocalMapCatalog?.() === true,
    });
}

export function createNavigationLifecyclePortFromManager({
    manager = null,
    game = null,
    menuExpertLoginRuntime = null,
    profileManager = null,
} = {}) {
    return createNavigationLifecyclePort({
        getSettings: () => manager?.settings || null,
        getActiveSubmenu: () => game?._activeSubmenu || null,
        setActiveSubmenu: (panelId) => { if (game) game._activeSubmenu = panelId || null; },
        persistMenuState: (state, transition = null) => {
            if (!game) return;
            game._menuState = state || null;
            game._menuTransition = transition || null;
        },
        getExpertLoginRuntime: () => menuExpertLoginRuntime || manager?.menuExpertLoginRuntime || null,
        getSettingsDirty: () => game?.settingsDirty === true,
        getActiveProfileName: () => game?.activeProfileName || profileManager?.getActiveProfileName?.() || '',
        updateToolsState: (patch = null) => {
            const settings = manager?.settings;
            if (!settings) return;
            if (!settings.localSettings || typeof settings.localSettings !== 'object') {
                settings.localSettings = {};
            }
            if (!settings.localSettings.toolsState || typeof settings.localSettings.toolsState !== 'object') {
                settings.localSettings.toolsState = {};
            }
            if (patch && typeof patch === 'object') {
                Object.assign(settings.localSettings.toolsState, patch);
            }
        },
        normalizeProfileName: (profileName) => profileManager?.normalizeProfileName?.(profileName) || String(profileName || '').trim(),
    });
}

export function createMatchFlowUiControllerPort(ports = null) {
    const renderPort = ports?.renderPort || null;
    const lifecyclePort = ports?.lifecyclePort || null;
    const arcadePort = ports?.arcadePort || null;
    const recordingPort = ports?.recordingPort || null;
    const runtimeIntentPort = ports?.runtimeIntentPort || null;
    const runtimeProjectionPort = ports?.runtimeProjectionPort || null;
    const uiFeedbackPort = ports?.uiFeedbackPort || null;
    const matchStatePort = ports?.matchStatePort || null;
    const inputPort = ports?.inputPort || null;
    const controllerPort = {};

    if (typeof inputPort?.clearJustPressed === 'function') {
        controllerPort.clearJustPressed = () => inputPort.clearJustPressed();
    }
    if (typeof matchStatePort?.applyLifecycleTransition === 'function') {
        controllerPort.applyLifecycleTransition = (transition) => matchStatePort.applyLifecycleTransition(transition);
    }
    if (typeof matchStatePort?.enterRoundEnd === 'function') {
        controllerPort.enterRoundEnd = (roundPause) => matchStatePort.enterRoundEnd(roundPause);
    }
    if (typeof matchStatePort?.applyRoundEndTransition === 'function') {
        controllerPort.applyRoundEndTransition = (transition) => matchStatePort.applyRoundEndTransition(transition);
    }
    if (typeof matchStatePort?.setRoundPause === 'function') {
        controllerPort.setRoundPause = (value) => matchStatePort.setRoundPause(value);
    }

    if (typeof renderPort?.setSplitScreen === 'function') {
        controllerPort.setSplitScreen = (isEnabled) => renderPort.setSplitScreen(!!isEnabled);
    }
    if (typeof renderPort?.setViewportLayout === 'function') {
        controllerPort.setViewportLayout = (layout) => renderPort.setViewportLayout(layout);
    }
    if (typeof lifecyclePort?.initializeSession === 'function') {
        controllerPort.initializeSession = () => lifecyclePort.initializeSession();
    }
    if (typeof lifecyclePort?.waitForAllPlayersLoaded === 'function') {
        controllerPort.waitForAllPlayersLoaded = () => lifecyclePort.waitForAllPlayersLoaded();
    }
    if (typeof lifecyclePort?.getNetworkMatchInputContext === 'function') {
        controllerPort.getNetworkMatchInputContext = () => lifecyclePort.getNetworkMatchInputContext();
    }
    if (typeof lifecyclePort?.startArcadeRunIfEnabled === 'function') {
        controllerPort.startArcadeRunIfEnabled = () => lifecyclePort.startArcadeRunIfEnabled();
    }
    if (typeof arcadePort?.getMenuSurfaceState === 'function') {
        controllerPort.getArcadeMenuSurfaceState = () => arcadePort.getMenuSurfaceState();
    }
    if (typeof arcadePort?.getPostMatchProgression === 'function') {
        controllerPort.getArcadePostMatchProgression = () => arcadePort.getPostMatchProgression();
    }
    if (typeof arcadePort?.selectIntermissionChoice === 'function') {
        controllerPort.selectArcadeIntermissionChoice = (choiceId) => arcadePort.selectIntermissionChoice(choiceId);
    }
    if (typeof arcadePort?.resolveVictoryChoice === 'function') {
        controllerPort.resolveArcadeVictoryChoice = (choice) => arcadePort.resolveVictoryChoice(choice);
        controllerPort.setArcadeIntermissionPaused = (paused) => arcadePort.setIntermissionPaused(paused);
    }
    if (typeof arcadePort?.selectReward === 'function') {
        controllerPort.selectArcadeReward = (rewardId) => arcadePort.selectReward(rewardId);
    }
    if (typeof arcadePort?.requestReplayPlayback === 'function') {
        controllerPort.requestArcadeReplayPlayback = () => arcadePort.requestReplayPlayback();
    }
    if (typeof arcadePort?.applyParcoursEvent === 'function') {
        controllerPort.applyArcadeParcoursEvent = (data = null) => arcadePort.applyParcoursEvent(data);
    }
    // Transition adapters keep recorder/arcade follow-up work behind narrow UI seams.
    if (typeof recordingPort?.finalizeRound === 'function') {
        controllerPort.finalizeRoundRecording = (winner, players, options = undefined) => recordingPort.finalizeRound(winner, players, options);
    }
    if (typeof recordingPort?.dump === 'function') {
        controllerPort.dumpRoundRecording = () => recordingPort.dump();
    }
    if (typeof recordingPort?.getLastRoundMetrics === 'function') {
        controllerPort.getLastRoundRecordingMetrics = () => recordingPort.getLastRoundMetrics();
    }
    if (typeof recordingPort?.getAggregateMetrics === 'function') {
        controllerPort.getAggregateRecordingMetrics = () => recordingPort.getAggregateMetrics();
    }
    if (typeof recordingPort?.getLastRoundGhostClip === 'function') {
        controllerPort.getLastRoundGhostClip = (players, options = undefined) => recordingPort.getLastRoundGhostClip(players, options);
    }
    if (typeof recordingPort?.recordRoundEndTelemetry === 'function') {
        controllerPort.recordRoundEndTelemetry = (payload = null) => recordingPort.recordRoundEndTelemetry(payload);
    }
    if (typeof recordingPort?.recordMatchEndTelemetry === 'function') {
        controllerPort.recordMatchEndTelemetry = (payload = null) => recordingPort.recordMatchEndTelemetry(payload);
    }
    if (typeof runtimeProjectionPort?.getSessionRuntimeSnapshot === 'function') {
        controllerPort.getSessionRuntimeSnapshot = () => runtimeProjectionPort.getSessionRuntimeSnapshot();
    }
    if (typeof runtimeProjectionPort?.getMatchRuntimeProjection === 'function') {
        controllerPort.getMatchRuntimeProjection = () => runtimeProjectionPort.getMatchRuntimeProjection();
    }
    if (typeof runtimeIntentPort?.startMatch === 'function') {
        controllerPort.startMatch = (options = undefined) => runtimeIntentPort.startMatch(options);
    }
    if (typeof runtimeIntentPort?.returnToMenu === 'function') {
        controllerPort.returnToMenu = (options = undefined) => runtimeIntentPort.returnToMenu(options);
    } else if (typeof lifecyclePort?.returnToMenu === 'function') {
        controllerPort.returnToMenu = (options = undefined) => lifecyclePort.returnToMenu(options);
    }
    if (typeof uiFeedbackPort?.showMenuPanel === 'function') {
        controllerPort.showMenuPanel = (panelId, options = undefined) => uiFeedbackPort.showMenuPanel(panelId, options);
    }
    if (typeof uiFeedbackPort?.toggleP2Hud === 'function') {
        controllerPort.toggleP2Hud = (isVisible) => uiFeedbackPort.toggleP2Hud(isVisible);
    }
    if (typeof uiFeedbackPort?.syncAll === 'function') {
        controllerPort.syncUi = () => uiFeedbackPort.syncAll();
    }
    if (typeof uiFeedbackPort?.showStatusToast === 'function') {
        controllerPort.showStatusToast = (message, durationMs, tone) => uiFeedbackPort.showStatusToast(message, durationMs, tone);
    }
    if (typeof uiFeedbackPort?.showPlayerFeedback === 'function') {
        controllerPort.showPlayerFeedback = (player, message) => uiFeedbackPort.showPlayerFeedback(player, message);
    }
    if (typeof uiFeedbackPort?.getDeathMessage === 'function') {
        controllerPort.getDeathMessage = (cause) => uiFeedbackPort.getDeathMessage(cause);
    }

    return Object.freeze(controllerPort);
}

export function createPauseOverlayControllerPort(ports = null) {
    const settingsPort = ports?.settingsPort || null;
    const inputPort = ports?.inputPort || null;
    const lifecyclePort = ports?.lifecyclePort || null;
    const runtimeIntentPort = ports?.runtimeIntentPort || null;
    const runtimeProjectionPort = ports?.runtimeProjectionPort || null;
    const actionDispatcher = ports?.actionDispatcher || null;
    const controllerPort = {};

    if (typeof runtimeProjectionPort?.getMatchFlowSnapshot === 'function') {
        controllerPort.getMatchFlowSnapshot = () => runtimeProjectionPort.getMatchFlowSnapshot();
    }
    if (typeof runtimeProjectionPort?.getSessionRuntimeSnapshot === 'function') {
        controllerPort.getSessionRuntimeSnapshot = () => runtimeProjectionPort.getSessionRuntimeSnapshot();
    }
    if (typeof runtimeIntentPort?.pauseMatch === 'function') {
        controllerPort.pauseMatch = () => runtimeIntentPort.pauseMatch();
    }
    if (typeof runtimeIntentPort?.resumeMatch === 'function') {
        controllerPort.resumeMatch = (options = undefined) => runtimeIntentPort.resumeMatch(options);
    }
    if (typeof runtimeIntentPort?.returnToMenu === 'function') {
        controllerPort.returnToMenu = (options = undefined) => runtimeIntentPort.returnToMenu(options);
    } else if (typeof lifecyclePort?.returnToMenu === 'function') {
        controllerPort.returnToMenu = (options = undefined) => lifecyclePort.returnToMenu(options);
    }
    if (typeof settingsPort?.applyAutoRoll === 'function') {
        controllerPort.applyAutoRoll = (checked) => settingsPort.applyAutoRoll(checked);
    }
    if (typeof inputPort?.startKeyCapture === 'function') {
        controllerPort.startKeyCapture = (playerKey, action) => inputPort.startKeyCapture(playerKey, action);
    }
    if (typeof inputPort?.clearJustPressed === 'function') {
        controllerPort.clearJustPressed = () => inputPort.clearJustPressed();
    }
    if (typeof actionDispatcher?.dispatch === 'function') {
        controllerPort.dispatchAction = (action) => actionDispatcher.dispatch(action);
    }

    return Object.freeze(controllerPort);
}

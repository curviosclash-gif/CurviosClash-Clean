import { UIManager } from '../../composition/core-ui/CoreUiAppPorts.js';
import { bootstrapGameRuntime } from '../GameBootstrap.js';
import { GameRuntimeFacade } from '../GameRuntimeFacade.js';
import {
    clearGameRuntimeState,
    getSessionRuntimeHandle,
    getSessionRuntimeState,
    setSessionRuntimeHandle,
} from './GameRuntimeBundle.js';
import { refreshLocalMapCatalog as refreshDesktopLocalMaps } from './LocalMapCatalogRefresh.js';

export class GameRuntimeCoordinator {
    constructor({ runtime } = {}) {
        this.runtime = runtime || null;
        this.runtimeBundle = null;
        this.runtimeFacade = null;
        this.uiManager = null;
        if (this.runtime) {
            this.runtime.runtimeCoordinator = this;
        }
    }

    initialize({
        appVersion = undefined,
        buildId = undefined,
        buildTime = undefined,
        showStatusToast = undefined,
        initialBindings = undefined,
    } = {}) {
        const game = this.runtime;
        const runtimeBundle = bootstrapGameRuntime(game, {
            appVersion,
            buildId,
            buildTime,
            showStatusToast,
        });
        this.runtimeBundle = runtimeBundle || null;
        setSessionRuntimeHandle(runtimeBundle, 'runtimeCoordinator', this);

        const runtimeFacade = new GameRuntimeFacade({
            runtime: game,
            runtimeBundle,
        });
        this.runtimeFacade = runtimeFacade;
        setSessionRuntimeHandle(runtimeBundle, 'runtimeFacade', runtimeFacade);

        const uiManager = new UIManager({
            game,
            ports: this.getPorts(),
        });
        this.uiManager = uiManager;
        setSessionRuntimeHandle(runtimeBundle, 'uiManager', uiManager);
        uiManager.init();
        this.getRuntimeHandle('keybindEditorController')?.renderEditor?.();

        runtimeFacade.applySettingsToRuntime();
        this.getRuntimeHandle('input')?.setBindings?.(initialBindings);

        return runtimeBundle;
    }

    getRuntimeState() {
        return getSessionRuntimeState(this.runtimeBundle || this.runtime);
    }

    getRuntimeHandle(key) {
        return getSessionRuntimeHandle(this.runtimeBundle || this.runtime, key);
    }

    getPorts() {
        return this.getRuntimeHandle('runtimePorts')
            || this.runtimeBundle?.ports
            || null;
    }

    getRuntimeFacade() {
        return this.runtimeFacade
            || this.getRuntimeHandle('runtimeFacade')
            || null;
    }

    getUiManager() {
        return this.uiManager
            || this.getRuntimeHandle('uiManager')
            || null;
    }

    applySettingsToRuntime(options = undefined) {
        return this.getRuntimeFacade()?.applySettingsToRuntime?.(options);
    }

    refreshLocalMapCatalog() {
        return refreshDesktopLocalMaps({
            gameState: this.runtime?.state,
            applySettings: () => this.applySettingsToRuntime({ schedulePrewarm: false }),
        });
    }

    setupMenuListeners() {
        return this.getRuntimeFacade()?.setupMenuListeners?.();
    }

    handleMenuControllerEvent(event) {
        return this.getRuntimeFacade()?.handleMenuControllerEvent?.(event);
    }

    onSettingsChanged(event = null) {
        return this.getRuntimeFacade()?.onSettingsChanged?.(event);
    }

    markSettingsDirty(isDirty) {
        return this.getRuntimeFacade()?.markSettingsDirty?.(isDirty);
    }

    updateSaveButtonState() {
        return this.getRuntimeFacade()?.updateSaveButtonState?.();
    }

    initializeSession() {
        return this.getRuntimeFacade()?.initializeSession?.();
    }

    waitForAllPlayersLoaded() {
        return this.getRuntimeFacade()?.waitForAllPlayersLoaded?.();
    }

    getNetworkMatchInputContext() {
        return this.getRuntimeFacade()?.getNetworkMatchInputContext?.();
    }

    teardownRuntimeSession() {
        return this.getRuntimeFacade()?.teardownRuntimeSession?.();
    }

    startArcadeRunIfEnabled() {
        return this.getRuntimeFacade()?.startArcadeRunIfEnabled?.();
    }

    applyArcadeParcoursEvent(data = null) {
        return this.getRuntimeFacade()?.applyArcadeParcoursEvent?.(data);
    }

    restartRound() {
        return this.getRuntimeFacade()?.restartRound?.();
    }

    handleMenuPanelChanged(previousPanelId, nextPanelId, transitionMetadata = undefined) {
        return this.getRuntimeFacade()?.handleMenuPanelChanged?.(previousPanelId, nextPanelId, transitionMetadata);
    }

    getArcadeMenuSurfaceState() {
        return this.getRuntimeFacade()?.getArcadeMenuSurfaceState?.();
    }

    selectArcadeIntermissionChoice(choiceId) {
        return this.getRuntimeFacade()?.selectArcadeIntermissionChoice?.(choiceId);
    }

    resolveArcadeVictoryChoice(choice) { return this.getRuntimeFacade()?.resolveArcadeVictoryChoice(choice); }
    setArcadeIntermissionPaused(paused) { return this.getRuntimeFacade()?.setArcadeIntermissionPaused(paused); }
    selectArcadeReward(rewardId) {
        return this.getRuntimeFacade()?.selectArcadeReward?.(rewardId);
    }

    requestArcadeReplayPlayback() {
        return this.getRuntimeFacade()?.requestArcadeReplayPlayback?.();
    }

    toggleCinematicRecordingFromHotkey(command = 'toggle') {
        return this.getRuntimeFacade()?.toggleCinematicRecordingFromHotkey?.(command);
    }

    finalizeRoundRecording(winner, players, options = undefined) {
        return this.getRuntimeFacade()?.finalizeRoundRecording?.(winner, players, options);
    }

    dumpRoundRecording() {
        return this.getRuntimeFacade()?.dumpRoundRecording?.();
    }

    getLastRoundRecordingMetrics() {
        return this.getRuntimeFacade()?.getLastRoundRecordingMetrics?.();
    }

    getAggregateRecordingMetrics() {
        return this.getRuntimeFacade()?.getAggregateRecordingMetrics?.();
    }

    getLastRoundGhostClip(players, options = undefined) {
        return this.getRuntimeFacade()?.getLastRoundGhostClip?.(players, options);
    }

    recordRoundEndTelemetry(payload = null) {
        return this.getRuntimeFacade()?.recordRoundEndTelemetry?.(payload);
    }

    recordMatchEndTelemetry(payload = null) {
        return this.getRuntimeFacade()?.recordMatchEndTelemetry?.(payload);
    }

    startMatch(options = undefined) {
        return this.getRuntimeFacade()?.startMatch?.(options);
    }

    pauseMatch(options = undefined) {
        return this.getRuntimeFacade()?.pauseMatch?.(options);
    }

    resumeMatch(options = undefined) {
        return this.getRuntimeFacade()?.resumeMatch?.(options);
    }

    returnToMenu(options = undefined) {
        return this.getRuntimeFacade()?.returnToMenu?.(options);
    }

    finalizeMatch(options = undefined) {
        return this.getRuntimeFacade()?.finalizeMatch?.(options);
    }

    hostLobby(options = undefined) {
        return this.getRuntimeFacade()?.hostLobby?.(options);
    }

    joinLobby(options = undefined) {
        return this.getRuntimeFacade()?.joinLobby?.(options);
    }

    renderBuildInfo() {
        const rendered = this.getRuntimeHandle('buildInfoController')?.renderBuildInfo?.();
        const clipboardText = typeof rendered === 'string' ? rendered : '';
        const runtimeState = this.getRuntimeState();
        if (runtimeState) {
            runtimeState._buildInfoClipboardText = clipboardText;
        }
        return clipboardText;
    }

    finishStartup() {
        this.renderBuildInfo();
        const ui = this.getRuntimeHandle('ui');
        if (ui?.mainMenu) {
            ui.mainMenu.dataset.shellReady = 'true';
            ui.mainMenu.style.visibility = '';
        }
        this.getUiManager()?.menuNavigationRuntime?.focusMainAction?.({ onlyIfFocusLost: true });
        this.getRuntimeHandle('gameLoop')?.start?.();
    }

    async disposeRuntime() {
        const game = this.runtime;
        const runtimeBundle = this.runtimeBundle || game?.runtimeBundle;
        const runtimeFacade = this.getRuntimeFacade();
        let firstError = null;
        const disposeSafely = async (callback) => {
            try {
                await Promise.resolve(callback?.());
            } catch (error) {
                firstError ||= error;
            }
        };

        await disposeSafely(() => this.getRuntimeHandle('gameLoop')?.stop?.());
        try {
            await disposeSafely(() => runtimeFacade?.dispose?.());
        } finally {
            await disposeSafely(() => this.getRuntimeHandle('matchFlowUiController')?.dispose?.());
            await disposeSafely(() => this.getRuntimeHandle('huntHud')?.dispose?.());
            await disposeSafely(() => this.getRuntimeHandle('hudRuntimeSystem')?.dispose?.());
            await disposeSafely(() => this.getUiManager()?.dispose?.());
            await disposeSafely(() => this.getRuntimeHandle('runtimeDiagnosticsSystem')?.dispose?.());
            await disposeSafely(() => this.getRuntimeHandle('mediaRecorderSystem')?.dispose?.());
            await disposeSafely(() => this.getRuntimeHandle('input')?.dispose?.());
            await disposeSafely(() => this.getRuntimeHandle('audio')?.dispose?.());
            await disposeSafely(() => this.getRuntimeHandle('renderer')?.dispose?.());
            clearGameRuntimeState(runtimeBundle);
            this.runtimeBundle = null;
            this.runtimeFacade = null;
            this.uiManager = null;
        }
        if (firstError) throw firstError;
    }
}

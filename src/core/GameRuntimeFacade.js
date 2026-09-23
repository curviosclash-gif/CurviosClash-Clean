import { createLogger } from '../shared/logging/Logger.js';
import { SessionRuntimeCommandExecutor } from '../application/session-runtime/SessionRuntimeCommandExecutor.js';
import { prewarmMatchArenaSession } from '../state/MatchSessionFactory.js';
import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';
import { MATCH_LIFECYCLE_CONTRACT_VERSION } from '../shared/contracts/MatchLifecycleContract.js';
import { MENU_CONTROLLER_EVENT_CONTRACT_VERSION } from '../shared/contracts/MenuControllerContract.js';
import { GAME_MODE_TYPES } from '../hunt/HuntMode.js';
import { createApplySettingsCommand, createFinalizeMatchCommand, createHostLobbyCommand, createInitializeSessionCommand, createJoinLobbyCommand } from '../shared/contracts/SessionRuntimeCommandContract.js';
import { createPauseMatchCommand, createResumeMatchCommand, createReturnToMenuCommand, createStartMatchCommand } from '../shared/contracts/SessionRuntimeCommandContract.js';
import { createRuntimeClock } from '../shared/contracts/RuntimeClockContract.js';
import {
    guardMenuRuntimeEvent,
    MenuController,
    resolveMenuAccessContext,
} from '../composition/core-ui/CoreUiMenuPorts.js';
import { SETTINGS_CHANGE_KEYS } from '../shared/settings/SettingsChangeKeys.js';
import { CONFIG_BASE } from './Config.js';
import { applyRuntimeConfigCompatibility } from './RuntimeConfig.js';
import { createEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';
import {
    applyRuntimeSettingsState,
    getSessionRuntimeHandle,
    getSessionRuntimeState,
} from './runtime/GameRuntimeBundle.js';
import { GameRuntimeMenuActionHandler } from './runtime/GameRuntimeMenuActionHandler.js';
import { GameRuntimeSessionHandler } from './runtime/GameRuntimeSessionHandler.js';
import { GameRuntimeSettingsHandler } from './runtime/GameRuntimeSettingsHandler.js';
import { createSessionRuntimeCommandBackends } from './runtime/SessionRuntimeCommandBackendFactory.js';
import { createMenuEventHandlerRegistry } from './runtime/menu-handlers/CreateMenuEventHandlerRegistry.js';
import { createMenuMultiplayerBridge } from './runtime/MenuRuntimeMultiplayerService.js';
import { createPlayerProfileMenuRuntimeAccess } from './runtime/PlayerProfileRuntimeAccess.js';
import { ProfileLifecycleController } from './runtime/ProfileLifecycleController.js';
import {
    createGameRuntimeRecordingFacadeSupport,
} from './runtime/GameRuntimeRecordingSupport.js';
import { GameRuntimeArcadeSupport } from './runtime/GameRuntimeArcadeSupport.js';
import { observeLobbySessionStateChange } from './runtime/RuntimeLobbySessionObservability.js';
import { syncRuntimeMultiplayerContext } from './runtime/RuntimeMultiplayerFlowService.js';
import {
    setupRuntimeClientStateReceiver,
    startRuntimeStateBroadcast,
    stopRuntimeStateBroadcast,
    teardownRuntimeSession as teardownRuntimeSessionState,
} from './runtime/RuntimeSessionLifecycleService.js';
import { resolveRuntimeNetworkPlayerSlotContext } from './runtime/RuntimeNetworkPlayerSlots.js';

const logger = createLogger('GameRuntimeFacade');

export class GameRuntimeFacade {
    constructor(deps = {}) {
        this.runtime = deps.runtime || deps.game || null;
        this.runtimeBundle = deps.runtimeBundle || this.runtime?.runtimeBundle || null;
        this.runtimeClock = createRuntimeClock({
            runtime: deps.runtimeClockRuntime || null,
            nowMs: deps.nowMs,
            nowHighRes: deps.nowHighRes,
        });
        this._explicitPorts = deps.ports || null;
        this.menuMultiplayerBridge = null;
        this._matchPrewarmTimer = null;
        this.profileLifecycleController = new ProfileLifecycleController({ game: this.game });
        this.menuActionHandler = new GameRuntimeMenuActionHandler({ facade: this });
        this.settingsHandler = new GameRuntimeSettingsHandler({ facade: this });
        this.sessionHandler = new GameRuntimeSessionHandler({ facade: this, logger });
        this.sessionRuntimeCommandExecutor = new SessionRuntimeCommandExecutor({
            facade: this,
            backends: createSessionRuntimeCommandBackends({ facade: this }),
        });
        this._menuEventHandlers = createMenuEventHandlerRegistry(this);

        /** @type {import('./session/SessionAdapter.js').SessionAdapter|null} */
        this.session = null;
        /** @type {import('../network/StateReconciler.js').StateReconciler|null} */
        this._stateReconciler = null;
        this._stateBroadcastTimer = null;
        this._arenaLoadedPeers = new Set();
        this._onStateUpdateHandler = null;
        this._onPlayerLoadedHandler = null;
        this._onRoundStartGateHandler = null;
        this._onFullStateSyncNeededHandler = null;
        this._lifecycleKernelHandlers = null;
        this._playerDepartureHandlers = null;
        this._pendingStateUpdates = [];
        this._pendingMatchFinalize = null;
        this._pendingMatchFinalizePlan = null;
        this._lastObservedMultiplayerSessionState = null;
        this._arcadeSupport = new GameRuntimeArcadeSupport({
            getGame: () => this.game,
            getRuntimeState: () => this.getRuntimeState(),
            nowMs: this.runtimeClock.nowMs,
            logger: console,
            applySectorRuntimeProfile: (profile) => this._applyArcadeSectorRuntimeProfile(profile),
            requestRunAdvance: () => queueMicrotask(() => this.restartRound()),
        });
        this._recordingSupport = createGameRuntimeRecordingFacadeSupport({
            getGame: () => this.game,
            getRuntimeHandle: (key) => this.getRuntimeHandle(key),
            showStatusToast: (message, durationMs, tone) => this.game?._showStatusToast?.(message, durationMs, tone),
        });
    }

    get game() { return this.runtime; }
    get arcadeRunRuntime() { return this._arcadeSupport?.arcadeRunRuntime || null; }
    getRuntimeBundle() { return this.runtimeBundle || this.game?.runtimeBundle || null; }
    getRuntimeState() { return getSessionRuntimeState(this.getRuntimeBundle() || this.game); }
    getRuntimeHandle(key) { return getSessionRuntimeHandle(this.getRuntimeBundle() || this.game, key); }
    getPorts() { return this.getRuntimeHandle('runtimePorts') || this._explicitPorts || null; }
    get ports() { return this.getPorts(); }
    getUiManager() { return this.getRuntimeHandle('uiManager') || null; }

    _clearMatchPrewarmTimer() {
        if (!this._matchPrewarmTimer) return;
        clearTimeout(this._matchPrewarmTimer);
        this._matchPrewarmTimer = null;
    }
    scheduleMatchPrewarm() {
        const game = this.game;
        const renderer = this.getRuntimeHandle('renderer');
        if (!renderer || !game?.settingsManager) return;
        if (game.state !== GAME_STATE_IDS.MENU) return;
        if (this.getRuntimeState()?.entityManager) return;
        this._clearMatchPrewarmTimer();
        this._matchPrewarmTimer = setTimeout(() => {
            this._matchPrewarmTimer = null;
            const runtimeState = this.getRuntimeState();
            if (game.state !== GAME_STATE_IDS.MENU) return;
            if (runtimeState?.entityManager) return;
            const runtimeConfig = game.settingsManager.createRuntimeConfig(game.settings);
            Promise.resolve(prewarmMatchArenaSession({
                renderer,
                settings: game.settings,
                runtimeConfig,
                baseConfig: runtimeState?.config || game.config || CONFIG_BASE,
                requestedMapKey: runtimeConfig?.session?.mapKey || runtimeState?.mapKey || game.mapKey,
            })).catch((error) => {
                logger.warn('Match prewarm skipped:', error);
            });
        }, 50);
    }

    executeSessionRuntimeCommand(command = null) { return this.sessionRuntimeCommandExecutor.execute(command); }
    executeSessionRuntimeCommandResult(command = null) { return this.sessionRuntimeCommandExecutor.executeResult(command); }

    _applySettingsToRuntimeInternal(options = {}) {
        const game = this.game;
        const runtimeBundle = this.getRuntimeBundle();
        const runtimeState = this.getRuntimeState();
        const renderer = this.getRuntimeHandle('renderer');
        const mediaRecorderSystem = this.getRuntimeHandle('mediaRecorderSystem');
        const input = this.getRuntimeHandle('input');
        if (!game?.settingsManager) return;
        const schedulePrewarm = options?.schedulePrewarm !== false;
        const runtimeConfig = game.settingsManager.createRuntimeConfig(game.settings);
        const compatibilityConfig = applyRuntimeConfigCompatibility(runtimeConfig, CONFIG_BASE);

        renderer?.setShadowQuality?.(game.settings?.localSettings?.shadowQuality); renderer?.setBloomQuality?.(game.settings?.localSettings?.bloomQuality);
        renderer?.setRecordingCaptureSettings?.(runtimeConfig?.recording);
        renderer?.setCameraPerspectiveSettings?.(runtimeConfig?.cameraPerspective);
        mediaRecorderSystem?.setRecordingCaptureSettings?.(runtimeConfig?.recording);

        applyRuntimeSettingsState(runtimeBundle, {
            runtimeConfig,
            config: compatibilityConfig,
            session: {
                numHumans: runtimeConfig?.session?.numHumans,
                numBots: runtimeConfig?.session?.numBots,
                mapKey: runtimeConfig?.session?.mapKey,
                winsNeeded: runtimeConfig?.session?.winsNeeded,
                activeGameMode: runtimeConfig?.session?.activeGameMode || GAME_MODE_TYPES.CLASSIC,
            },
        });

        runtimeState?.arena?.toggleBeams?.(runtimeConfig.gameplay.portalBeams);
        runtimeState?.entityManager?.setBotDifficulty?.(runtimeConfig.bot.activeDifficulty);

        // Live-apply updated player tuning to existing players without a restart.
        if (typeof runtimeState?.entityManager?.applyLiveRuntimeConfig === 'function') {
            const liveErc = createEntityRuntimeConfig(runtimeConfig, compatibilityConfig);
            runtimeState.entityManager.applyLiveRuntimeConfig(liveErc, runtimeConfig);
        }

        input?.setBindings?.(runtimeConfig.controls);
        this._syncArcadeRuntimeConfig();
        if (schedulePrewarm) {
            this.scheduleMatchPrewarm();
        }
    }

    applySettingsToRuntime(options = {}) { return this.executeSessionRuntimeCommand(createApplySettingsCommand(options)); }
    toggleCinematicRecordingFromHotkey(command = 'toggle') {
        return this._recordingSupport.toggleCinematicRecordingFromHotkey(command);
    }

    _syncArcadeRuntimeConfig() {
        this._arcadeSupport.syncRuntimeConfig();
    }

    _applyArcadeSectorRuntimeProfile(profile = null) {
        if (!profile || typeof profile !== 'object') return null;
        const runtimeState = this.getRuntimeState();
        const currentRuntimeConfig = runtimeState?.runtimeConfig;
        if (!runtimeState || !currentRuntimeConfig) return null;
        const fallbackMapKey = currentRuntimeConfig?.session?.mapKey || 'standard';
        const mapKey = String(profile.mapKey || profile.toMap || fallbackMapKey).trim() || 'standard';
        const numBots = Math.max(0, Math.trunc(Number(profile.botCount) || 0));
        const activeDifficulty = String(profile.botDifficulty
            || currentRuntimeConfig?.bot?.activeDifficulty
            || 'NORMAL').trim().toUpperCase() || 'NORMAL';
        const nextRuntimeConfig = {
            ...currentRuntimeConfig,
            session: { ...currentRuntimeConfig.session, mapKey, numBots },
            bot: { ...currentRuntimeConfig.bot, activeDifficulty, arcadeAggressiveness: Math.max(0, Math.min(1, Number(profile.aggressiveness) || 0)) },
        };
        const nextCompatibilityConfig = applyRuntimeConfigCompatibility(nextRuntimeConfig, CONFIG_BASE);
        applyRuntimeSettingsState(this.getRuntimeBundle(), {
            runtimeConfig: nextRuntimeConfig,
            config: nextCompatibilityConfig,
            session: {
                mapKey,
                numBots,
                numHumans: currentRuntimeConfig?.session?.numHumans,
                winsNeeded: currentRuntimeConfig?.session?.winsNeeded,
                activeGameMode: currentRuntimeConfig?.session?.activeGameMode,
            },
        });
        const entityManager = runtimeState.entityManager;
        entityManager?.applyLiveRuntimeConfig?.(
            createEntityRuntimeConfig(nextRuntimeConfig, nextCompatibilityConfig),
            nextRuntimeConfig
        );
        entityManager?.setBotDifficulty?.(activeDifficulty);
        return nextRuntimeConfig;
    }

    startArcadeRunIfEnabled() { return this._arcadeSupport.startRunIfEnabled(); }
    prepareArcadeMatchStartRuntime() { return this._arcadeSupport.prepareMatchStartRuntime(); }
    consumePendingArcadeSectorTransition() { return this._arcadeSupport.consumePendingSectorTransition(); }
    applyArcadeParcoursEvent(data = null) { return this._arcadeSupport.applyParcoursEvent(data); }

    _resetArcadeRunState(options = undefined) { this._arcadeSupport.resetRunState({ preserveRecords: true, ...(options || {}) }); }
    getArcadeRunState() { return this._arcadeSupport.getRunState(); }
    getArcadePostMatchProgression() { return this._arcadeSupport.getPostMatchProgression(); }
    getArcadeMenuSurfaceState() {
        const state = this._arcadeSupport.getMenuSurfaceState();
        if (state?.runType !== 'arena_waves') return state;
        const records = state.records && typeof state.records === 'object'
            ? { ...state.records, bestScore: state.records.bestScore ?? state.records.bestTotal, lastScore: state.records.lastScore ?? state.records.lastTotal }
            : state.records;
        const postRunSummary = state.postRunSummary && typeof state.postRunSummary === 'object'
            ? { ...state.postRunSummary, score: state.postRunSummary.score ?? state.postRunSummary.total }
            : state.postRunSummary;
        return { ...state, records, postRunSummary };
    }
    tickArcadeSuddenDeath(dt = 0) { return this._arcadeSupport.tickSuddenDeath(dt); }
    selectArcadeIntermissionChoice(choiceId) { return this._arcadeSupport.selectIntermissionChoice(choiceId); }
    resolveArcadeVictoryChoice(choice) { return this.arcadeRunRuntime?.resolveVictoryChoice(choice); }
    setArcadeIntermissionPaused(paused) { return this.arcadeRunRuntime?.setIntermissionPaused(paused); }
    selectArcadeReward(rewardId) { return this._arcadeSupport.selectReward(rewardId); }
    requestArcadeReplayPlayback() { return this._arcadeSupport.requestReplayPlayback(); }
    _createMenuRuntimeAccess() {
        const game = this.game;
        const playerProfileAccess = createPlayerProfileMenuRuntimeAccess(game);
        const getMediaRecorder = () => this.getRuntimeHandle('mediaRecorderSystem');
        return Object.freeze({
            getArcadeMenuSurfaceState: () => this.getArcadeMenuSurfaceState(),
            requestArcadeReplayPlayback: () => this.requestArcadeReplayPlayback(),
            showStatusToast: (message, duration, tone) => game?._showStatusToast?.(message, duration, tone),
            ...playerProfileAccess,
            listCinematicReplayRecordings: () => getMediaRecorder()?.listCinematicReplayRecordings?.() || [],
            subscribeCinematicReplayRecordings: (listener) => (
                getMediaRecorder()?.subscribeCinematicReplayRecordings?.(listener) || (() => {})
            ),
            renderCinematicReplayRecording: (recordingId) => (
                getMediaRecorder()?.renderCinematicReplayRecording?.(recordingId)
                || Promise.resolve({ saved: false, reason: 'recorder_unavailable' })
            ),
            discardCinematicReplayRecording: (recordingId) => (
                getMediaRecorder()?.discardCinematicReplayRecording?.(recordingId)
                || { removed: false, reason: 'recorder_unavailable' }
            ),
        });
    }

    setupMenuListeners() {
        const game = this.game;
        const runtimeState = this.getRuntimeState();
        const ui = this.getRuntimeHandle('ui');
        if (!game || !runtimeState || !ui) return;
        runtimeState.menuMultiplayerBridge = createMenuMultiplayerBridge({
            existingBridge: runtimeState.menuMultiplayerBridge,
            contractVersion: game?.menuLifecycleContractVersion || MATCH_LIFECYCLE_CONTRACT_VERSION,
            onEvent: (lifecycleEvent) => game._handleMenuLifecycleEvent?.(lifecycleEvent),
            onStatus: null,
            onStateChanged: (sessionState) => this._handleMultiplayerSessionStateChanged(sessionState),
            onMatchStart: (command) => this._handleMultiplayerMatchStart(command),
        });
        this.menuMultiplayerBridge = runtimeState.menuMultiplayerBridge;
        game.menuMultiplayerBridge = this.menuMultiplayerBridge;
        this.menuMultiplayerBridge?.syncActorIdentity?.(game.playerProfileManager?.getActiveProfile?.()?.id || this._resolveMenuAccessContext()?.actorId);
        this._handleMultiplayerSessionStateChanged(this.menuMultiplayerBridge?.getSessionState?.());
        runtimeState.menuController?.dispose?.();

        runtimeState.menuController = new MenuController({
            ui,
            game,
            settings: game.settings,
            runtimeAccess: this._createMenuRuntimeAccess(),
            onEvent: (event) => this.handleMenuControllerEvent(event),
        });
        runtimeState.menuController.setupListeners();
    }

    _captureMultiplayerMatchSettings() {
        return this.settingsHandler.captureMultiplayerMatchSettings();
    }

    _syncMultiplayerUiState() {
        const game = this.game;
        const uiManager = this.getUiManager();
        uiManager?.syncStartSetupState?.(game?.settings);
        uiManager?.syncMultiplayerState?.(game?.settings);
        uiManager?.updateContext?.();
    }

    _handleMultiplayerSessionStateChanged(sessionState = null) {
        const ui = this.getRuntimeHandle('ui');
        const previousLobbyCode = String(this._lastObservedMultiplayerSessionState?.lobbyCode || '').trim();
        const inputValue = String(ui?.multiplayerLobbyCodeInput?.value || '').trim();
        if (ui?.multiplayerLobbyCodeInput) {
            if (sessionState?.joined) {
                ui.multiplayerLobbyCodeInput.value = String(sessionState.lobbyCode || '');
            } else if (previousLobbyCode && inputValue === previousLobbyCode) {
                ui.multiplayerLobbyCodeInput.value = '';
            }
        }
        this._syncMultiplayerUiState();
        this._lastObservedMultiplayerSessionState = observeLobbySessionStateChange(
            this.getRuntimeBundle() || this.game,
            this._lastObservedMultiplayerSessionState,
            sessionState
        );
    }

    _applyAuthoritativeMultiplayerMatchSettings(snapshot) {
        this.settingsHandler.applyAuthoritativeMultiplayerMatchSettings(snapshot);
    }

    _handleMultiplayerMatchStart(command = null) {
        return this.startMatch({ commandId: command?.commandId, hostPeerId: command?.hostPeerId, issuedAt: command?.issuedAt, lobbyCode: command?.lobbyCode, settingsSnapshot: command?.settingsSnapshot, source: 'menu_multiplayer_bridge' });
    }

    _syncMultiplayerRuntimeContext(changedKeys = null) {
        syncRuntimeMultiplayerContext({
            game: this.game,
            changedKeys,
            menuMultiplayerBridge: this.menuMultiplayerBridge,
            resolveMenuAccessContext: () => this._resolveMenuAccessContext(),
            captureSettingsSnapshot: () => this._captureMultiplayerMatchSettings(),
            syncUiState: () => this._syncMultiplayerUiState(),
        });
    }

    handleMenuControllerEvent(event) {
        const game = this.game;
        if (!event?.type) return;
        if (event.contractVersion && event.contractVersion !== MENU_CONTROLLER_EVENT_CONTRACT_VERSION) {
            game._showStatusToast('Menu-Event-Contract mismatch.', 1800, 'error');
            return;
        }
        const accessResult = guardMenuRuntimeEvent(event.type, this._resolveMenuAccessContext());
        if (!accessResult.allowed) {
            game._showStatusToast('Aktion gesperrt (nur Host).', 1600, 'error');
            return;
        }

        const handler = this._menuEventHandlers.get(event.type);
        if (typeof handler === 'function') {
            handler(event);
        }
    }

    _resolveMenuAccessContext() {
        return resolveMenuAccessContext(this.game?.settings);
    }

    _recordMenuTelemetry(eventType, payload = null) {
        const game = this.game;
        const uiManager = this.getUiManager();
        const telemetrySnapshot = game?.settingsManager?.recordMenuTelemetry?.(game.settings, eventType, payload);
        if (uiManager && typeof uiManager.syncDeveloperState === 'function') {
            if (typeof uiManager.syncByChangeKeys === 'function') {
                uiManager.syncByChangeKeys([SETTINGS_CHANGE_KEYS.MENU_TELEMETRY]);
            } else {
                uiManager.syncDeveloperState(game.settings);
            }
        }
        return telemetrySnapshot;
    }

    finalizeRoundRecording(winner, players, options = undefined) { return this._recordingSupport.finalizeRound(winner, players, options); }
    dumpRoundRecording() { return this._recordingSupport.dump(); }
    getLastRoundRecordingMetrics() { return this._recordingSupport.getLastRoundMetrics(); }
    getAggregateRecordingMetrics() { return this._recordingSupport.getAggregateMetrics(); }
    getLastRoundGhostClip(players, options = undefined) { return this._recordingSupport.getLastRoundGhostClip(players, options); }

    recordRoundEndTelemetry(payload = null) {
        return this._arcadeSupport.recordRoundEndTelemetry(payload, {
            recordMenuTelemetry: (eventType, value) => this._recordMenuTelemetry(eventType, value),
        });
    }

    recordMatchEndTelemetry(payload = null) {
        return this._arcadeSupport.recordMatchEndTelemetry(payload, {
            recordMenuTelemetry: (eventType, value) => this._recordMenuTelemetry(eventType, value),
        });
    }

    handleMenuPanelChanged(previousPanelId, nextPanelId, transitionMetadata = null) {
        return this.menuActionHandler.handleMenuPanelChanged(previousPanelId, nextPanelId, transitionMetadata);
    }

    handleSessionTypeChange(event) {
        return this.menuActionHandler.handleSessionTypeChange(event);
    }

    handleModePathChange(event) {
        return this.menuActionHandler.handleModePathChange(event);
    }

    handleQuickStartLastStart() {
        return this.menuActionHandler.handleQuickStartLastStart();
    }

    handleQuickStartEventPlaylistStart() {
        return this.menuActionHandler.handleQuickStartEventPlaylistStart();
    }

    handleQuickStartRandomStart() {
        return this.menuActionHandler.handleQuickStartRandomStart();
    }

    handleLevel3Reset() {
        return this.menuActionHandler.handleLevel3Reset();
    }

    handleLevel4Open(event) {
        return this.menuActionHandler.handleLevel4Open(event);
    }

    handleLevel4Close() {
        return this.menuActionHandler.handleLevel4Close();
    }

    handleLevel4Reset() {
        return this.menuActionHandler.handleLevel4Reset();
    }

    handleConfigExportCode() {
        return this.menuActionHandler.handleConfigExportCode();
    }

    handleConfigExportJson() {
        return this.menuActionHandler.handleConfigExportJson();
    }

    handleConfigImport(event) {
        return this.menuActionHandler.handleConfigImport(event);
    }

    applyMenuPreset(event) {
        return this.menuActionHandler.applyMenuPreset(event);
    }

    saveMenuPreset(event, kind) { return this.menuActionHandler.saveMenuPreset(event, kind); }
    deleteMenuPreset(event) { return this.menuActionHandler.deleteMenuPreset(event); }
    _didHostChangeMatchSettings(changedKeys) { return this.settingsHandler.didHostChangeMatchSettings(changedKeys); }
    _invalidateMultiplayerReadyIfHostChangedSettings(changedKeys) { return this.settingsHandler.invalidateMultiplayerReadyIfHostChangedSettings(changedKeys); }
    handleMultiplayerHost(event) { return this.menuActionHandler.handleMultiplayerHost(event); }
    handleMultiplayerJoin(event) { return this.menuActionHandler.handleMultiplayerJoin(event); }
    handleMultiplayerLobbyListRefresh(event) { return this.menuActionHandler.handleMultiplayerLobbyListRefresh(event); }
    handleMultiplayerLeaveLobby(event) { return this.menuActionHandler.handleMultiplayerLeaveLobby(event); }
    handleMultiplayerReadyToggle(event) { return this.menuActionHandler.handleMultiplayerReadyToggle(event); }
    handleDeveloperModeToggle(event) { return this.menuActionHandler.handleDeveloperModeToggle(event); }
    handleDeveloperThemeChange(event) { return this.menuActionHandler.handleDeveloperThemeChange(event); }
    handleDeveloperVisibilityChange(event) { return this.menuActionHandler.handleDeveloperVisibilityChange(event); }
    handleDeveloperFixedPresetLockToggle(event) { return this.menuActionHandler.handleDeveloperFixedPresetLockToggle(event); }
    handleDeveloperActorChange(event) { return this.menuActionHandler.handleDeveloperActorChange(event); }
    handleDeveloperReleasePreviewToggle(event) { return this.menuActionHandler.handleDeveloperReleasePreviewToggle(event); }
    handleDeveloperTextOverrideSet(event) { return this.menuActionHandler.handleDeveloperTextOverrideSet(event); }
    handleDeveloperTextOverrideClear(event) { return this.menuActionHandler.handleDeveloperTextOverrideClear(event); }
    startKeyCapture(event) { return this.menuActionHandler.startKeyCapture(event); }
    resetKeys() { return this.menuActionHandler.resetKeys(); }
    saveKeys() { return this.menuActionHandler.saveKeys(); }
    showStatusToast(event) { return this.menuActionHandler.showStatusToast(event); }
    _resolveStartValidationIssue() { return this.settingsHandler.resolveStartValidationIssue(); }
    onSettingsChanged(event = null) { return this.settingsHandler.onSettingsChanged(event); }
    markSettingsDirty(isDirty) { return this.settingsHandler.markSettingsDirty(isDirty); }
    cancelPendingSettingsAutoSave() { return this.settingsHandler.cancelPendingSettingsAutoSave(); }
    updateSaveButtonState() { return this.settingsHandler.updateSaveButtonState(); }
    async _initSession(options = undefined) { return this.executeSessionRuntimeCommand(createInitializeSessionCommand(options)); }
    initializeSession(options = undefined) { return this._initSession(options); }
    _startStateBroadcast() { startRuntimeStateBroadcast(this); }
    _stopStateBroadcast() { stopRuntimeStateBroadcast(this); }
    _setupClientStateReceiver() { setupRuntimeClientStateReceiver(this); }
    async _waitForAllPlayersLoaded() { return this.sessionHandler.waitForAllPlayersLoaded(); }
    waitForAllPlayersLoaded() { return this._waitForAllPlayersLoaded(); }
    _teardownSession() { return teardownRuntimeSessionState(this); }
    teardownRuntimeSession() { return this._teardownSession(); }
    isNetworkSession() { return this.sessionHandler.isNetworkSession(); }
    isHost() { return this.sessionHandler.isHost(); }
    getNetworkMatchInputContext() {
        const session = this.session || null;
        return {
            session,
            ...resolveRuntimeNetworkPlayerSlotContext(this),
        };
    }
    startMatch(options = undefined) { return this.executeSessionRuntimeCommand(createStartMatchCommand(options)); }
    pauseMatch(options = undefined) { return this.executeSessionRuntimeCommand(createPauseMatchCommand(options)); }
    resumeMatch(options = undefined) { return this.executeSessionRuntimeCommand(createResumeMatchCommand(options)); }
    restartRound() { return this.sessionHandler.restartRound(); }
    returnToMenu(options = {}) { return this.executeSessionRuntimeCommand(createReturnToMenuCommand(options)); }
    finalizeMatch(options = {}) { return this.executeSessionRuntimeCommand(createFinalizeMatchCommand(options)); }
    hostLobby(options = {}) { return this.executeSessionRuntimeCommand(createHostLobbyCommand(options)); }
    joinLobby(options = {}) { return this.executeSessionRuntimeCommand(createJoinLobbyCommand(options)); }
    syncP2HudVisibility() { return this.sessionHandler.syncP2HudVisibility(); }
    dispose() {
        if (this._disposePromise) return this._disposePromise;
        this._disposed = true;
        this._clearMatchPrewarmTimer();
        this._arcadeSupport?.arcadeRunRuntime?.flushPersistenceSaves?.();
        this.settingsHandler?.dispose?.();
        const runtimeState = this.getRuntimeState();
        runtimeState?.menuController?.dispose?.();
        if (runtimeState && runtimeState.menuController) {
            runtimeState.menuController = null;
        }
        if (this.game?.menuMultiplayerBridge === this.menuMultiplayerBridge) {
            this.game.menuMultiplayerBridge = null;
        }
        this.menuMultiplayerBridge = null;
        this._lastObservedMultiplayerSessionState = null;
        this._disposePromise = Promise.resolve()
            .then(() => this.sessionHandler.dispose())
            .then((result) => Promise.resolve(this._pendingRuntimeSessionTeardown).then(() => result));
        return this._disposePromise;
    }
}

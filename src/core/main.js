// ============================================
// main.js - entry point and game controller
// ============================================

import { RoundRecorder } from '../state/RoundRecorder.js';
import { CUSTOM_MAP_KEY } from '../entities/MapSchema.js';
import { ProfileUiController } from '../composition/core-ui/CoreUiAppPorts.js';
import { createCoreRuntimeAccess } from '../composition/core-ui/CoreRuntimeAccessFactory.js';
import { SettingsManager } from './SettingsManager.js';
import { ProfileManager } from './ProfileManager.js';
import { createRoundStateController } from '../state/RoundStateController.js';
import { PlayingStateSystem } from './PlayingStateSystem.js';
import { RoundStateTickSystem } from '../state/RoundStateTickSystem.js';
import { GameDebugApi } from './GameDebugApi.js';
import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';
import {
    MATCH_LIFECYCLE_CONTRACT_VERSION,
} from '../shared/contracts/MatchLifecycleContract.js';
import { RuntimePerfProfiler } from './perf/RuntimePerfProfiler.js';
import {
    initializeGameApp,
    releasePublishedRuntimeHandles,
} from './AppInitializer.js';
import {
    isPlaytestLaunchRequested,
    readPlaytestLaunchBoolParam,
    readPlaytestSessionType,
} from './PlaytestLaunchParams.js';
import { installPlaytestReturnControl } from './PlaytestReturnControl.js';
import { ensureInteractiveMatchRuntime } from './InteractiveMatchRuntimeGuard.js';
import { GameRuntimeCoordinator } from './runtime/GameRuntimeCoordinator.js';
import { isPersistenceSuccess } from './settings/SettingsDomainUtils.js';
import {
    applyMobileClassicDocumentState,
    applyMobileClassicSettings,
    applyMobileClassicUiLocks,
    isMobileClassicAppTarget,
} from '../mobile-classic/MobileClassicApp.js';
import { installDesktopTuningRuntimeBridge } from '../dev/tuning/TuningRuntimeIpcBridge.js';

/* global __APP_VERSION__, __BUILD_TIME__, __BUILD_ID__ */
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : new Date().toISOString();
const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';

export class Game {
    constructor() {
        this.settingsManager = new SettingsManager();
        this.profileManager = new ProfileManager(this.settingsManager.getProfileStorePort());

        this.profileDataOps = this.profileManager.getProfileDataOps();

        this.settings = this._loadSettings();
        this._mobileClassicAppTarget = isMobileClassicAppTarget();
        if (this._mobileClassicAppTarget) {
            applyMobileClassicDocumentState(document);
            applyMobileClassicSettings(this.settings);
        }
        this.settingsDirty = false;
        this.menuLifecycleContractVersion = MATCH_LIFECYCLE_CONTRACT_VERSION;
        this.menuLifecycleEvents = [];
        this.huntState = {
            overheatByPlayer: {},
            killFeed: [],
            damageIndicator: null,
            damageIndicatorsByPlayer: {},
        };

        this.state = GAME_STATE_IDS.MENU;
        this.roundPause = 0;
        this.roundStateController = createRoundStateController({ defaultRoundPause: 3.0 });
        const runtimeAccess = createCoreRuntimeAccess(this);
        this.playingStateSystem = new PlayingStateSystem(runtimeAccess.playingState);
        this.roundStateTickSystem = new RoundStateTickSystem({
            game: this,
            getLifecyclePort: () => this.runtimeCoordinator?.getPorts?.()?.lifecyclePort || null,
            getRuntimeIntentPort: () => this.runtimeCoordinator?.getPorts?.()?.runtimeIntentPort || null,
        });
        this._hudTimer = 0;
        this._renderAlpha = 1;
        this._renderDelta = 1 / 60;
        this._missingInteractiveMatchRuntimeReported = false;
        this.runtimePerfProfiler = new RuntimePerfProfiler({
            spikeThresholdMs: 30,
        });
        this.keyCapture = null;
        this._disposed = false;
        this._disposePromise = null;
        this._playtestStartTimeoutId = null;
        this.runtimeCoordinator = new GameRuntimeCoordinator({ runtime: this });
        this._boundKeyCaptureHandler = (event) => this.runtimeCoordinator?.getRuntimeHandle?.('keybindEditorController')?.handleKeyCapture?.(event);

        this.runtimeCoordinator.initialize({
            appVersion: APP_VERSION,
            buildId: BUILD_ID,
            buildTime: BUILD_TIME,
            showStatusToast: (message, durationMs, tone) => this._showStatusToast(message, durationMs, tone),
            initialBindings: this.settings.controls,
        });
        this.debugApi = new GameDebugApi(runtimeAccess.gameDebug);

        // Debug Recorder
        this.recorder = new RoundRecorder();
        this._recorderFrameCaptureEnabled = this.debugApi.resolveRecorderFrameCaptureEnabledDefault();
        this.recorder.setFrameCaptureEnabled(this._recorderFrameCaptureEnabled);

        this.profileUiController = new ProfileUiController({
            profileManager: this.profileManager,
            settingsManager: this.settingsManager,
            getUi: () => this.runtimeCoordinator?.getRuntimeHandle?.('ui') || this.ui,
            getUiManager: () => this.runtimeCoordinator?.getUiManager?.() || this.uiManager,
            getSettings: () => this.settings,
            setSettings: (s) => { this.settings = s; },
            showStatusToast: (msg, ms, tone) => this._showStatusToast(msg, ms, tone),
            onSettingsChanged: () => this._onSettingsChanged(),
            markSettingsDirty: (dirty) => this._markSettingsDirty(dirty),
            profileControlStateOps: this.profileManager.getProfileControlStateOps(),
            profileUiStateOps: this.profileManager.getProfileUiStateOps(),
        });

        // Backward-compat aliases — still referenced by UINavigationLifecycleController and GameRuntimeFacade
        this.activeProfileName = this.profileUiController.activeProfileName;
        this.selectedProfileName = this.profileUiController.selectedProfileName;

        this._setupMenuListeners();
        this._syncProfileControls();
        this._markSettingsDirty(false);
        this.runtimeCoordinator.finishStartup();
        if (this._mobileClassicAppTarget) {
            applyMobileClassicUiLocks(this);
        }

        window.addEventListener('keydown', this._boundKeyCaptureHandler, true);

        this._autoStartPlaytestIfRequested();
    }

    // update() ist weiter unten definiert (einzelne Methode für alles)

    _autoStartPlaytestIfRequested() {
        if (!isPlaytestLaunchRequested()) {
            return;
        }

        this._disposePlaytestReturnControl = installPlaytestReturnControl();

        const playtestSessionType = readPlaytestSessionType();
        if (playtestSessionType) {
            this.settingsManager.switchSessionType(this.settings, playtestSessionType);
        }
        this.settings.mapKey = CUSTOM_MAP_KEY;
        const planarRequested = readPlaytestLaunchBoolParam('planar');
        if (typeof planarRequested === 'boolean') {
            if (!this.settings.gameplay) this.settings.gameplay = {};
            this.settings.gameplay.planarMode = planarRequested;
            if (planarRequested) {
                if ((this.settings.gameplay.portalCount || 0) === 0) {
                    this.settings.gameplay.portalCount = 4;
                }
                this.settings.portalsEnabled = true;
            }
        }
        this._onSettingsChanged();

        this._playtestStartTimeoutId = window.setTimeout(() => {
            this._playtestStartTimeoutId = null;
            if (this.state !== GAME_STATE_IDS.MENU) return;
            this.startMatch();
        }, 0);
    }

    _clearPlaytestStartTimeout() {
        if (this._playtestStartTimeoutId == null) return;
        clearTimeout(this._playtestStartTimeoutId);
        this._playtestStartTimeoutId = null;
    }

    _showMainNav() {
        this.runtimeCoordinator?.getUiManager?.()?.showMainNav?.();
    }

    _renderBuildInfo() {
        this.runtimeCoordinator.renderBuildInfo();
    }

    _loadSettings() {
        return this.settingsManager.loadSettings();
    }

    _saveSettings() {
        const persisted = this.settingsManager.saveSettings(this.settings);
        if (isPersistenceSuccess(persisted)) {
            this._markSettingsDirty(false);
        }
    }

    _applySettingsToRuntime(options = undefined) {
        this.runtimeCoordinator.applySettingsToRuntime(options);
    }

    _setupMenuListeners() {
        this.runtimeCoordinator.setupMenuListeners();
    }

    _handleMenuControllerEvent(event) {
        this.runtimeCoordinator.handleMenuControllerEvent(event);
    }

    _onSettingsChanged(event = null) {
        this.runtimeCoordinator.onSettingsChanged(event);
    }

    _markSettingsDirty(isDirty) {
        this.runtimeCoordinator.markSettingsDirty(isDirty);
    }

    _updateSaveButtonState() {
        this.runtimeCoordinator.updateSaveButtonState();
    }

    _syncProfileControls(options = null) {
        this.profileUiController?.syncProfileControls(options || undefined);
    }

    _syncProfileActionState() {
        this.profileUiController?.syncProfileActionState();
    }

    _setProfileTransferStatus(message, tone) {
        this.profileUiController?.setProfileTransferStatus(message, tone);
    }

    _saveProfile(profileName) {
        return this.profileUiController?.saveProfile(profileName) ?? false;
    }

    _duplicateProfile(sourceProfileName, targetProfileName) {
        return this.profileUiController?.duplicateProfile(sourceProfileName, targetProfileName) ?? false;
    }

    _loadProfile(profileName) {
        return this.profileUiController?.loadProfile(profileName) ?? false;
    }

    _exportProfile(profileName) {
        return this.profileUiController?.exportProfile(profileName) ?? false;
    }

    _importProfile(inputValue, requestedProfileName) {
        return this.profileUiController?.importProfile(inputValue, requestedProfileName) ?? false;
    }

    _setDefaultProfile(profileName) {
        return this.profileUiController?.setDefaultProfile(profileName) ?? false;
    }

    _deleteProfile(profileName) {
        return this.profileUiController?.deleteProfile(profileName) ?? false;
    }

    _showStatusToast(message, durationMs = 1200, tone = 'info') {
        const uiManager = this.runtimeCoordinator?.getUiManager?.();
        if (!uiManager || typeof uiManager.showToast !== 'function') return;
        uiManager.showToast(message, durationMs, tone);
    }

    _toggleCinematicCameraFromGlobalHotkey() {
        const renderer = this.renderer;
        if (!renderer || typeof renderer.getCinematicEnabled !== 'function' || typeof renderer.setCinematicEnabled !== 'function') {
            return;
        }
        const currentlyEnabled = !!renderer.getCinematicEnabled();
        const nextEnabled = !currentlyEnabled;
        renderer.setCinematicEnabled(nextEnabled);
        this.gameLoop?.requestDeltaReset?.('cinematic-toggle');
        this._showStatusToast(
            nextEnabled ? 'Cinematic Kamera: aktiv' : 'Cinematic Kamera: deaktiviert',
            1400,
            'info'
        );
    }

    _toggleRecordingFromGlobalHotkey() {
        return this.runtimeCoordinator?.toggleCinematicRecordingFromHotkey?.();
    }

    _handleGlobalInputHotkeys() {
        if (this.keyCapture) return;
        if (this.input?.wasGlobalActionPressed?.('CINEMATIC_TOGGLE')) {
            this._toggleCinematicCameraFromGlobalHotkey();
        }
        if (this.input?.wasGlobalActionPressed?.('RECORDING_TOGGLE')) {
            this._toggleRecordingFromGlobalHotkey();
        }
    }

    _handleMenuLifecycleEvent(event) {
        const sourceEvent = event && typeof event === 'object' ? event : {};
        const contractVersion = String(sourceEvent.contractVersion || sourceEvent.version || '').trim();
        const type = String(sourceEvent.eventType || sourceEvent.type || '').trim();
        if (!type) return;

        const payload = sourceEvent.payload && typeof sourceEvent.payload === 'object'
            ? { ...sourceEvent.payload }
            : (sourceEvent.context && typeof sourceEvent.context === 'object' ? { ...sourceEvent.context } : {});
        const normalizedEvent = {
            contractVersion: contractVersion || this.menuLifecycleContractVersion,
            type,
            timestampMs: Number(sourceEvent.timestampMs || Date.now()),
            payload,
        };

        this.menuLifecycleEvents.push(normalizedEvent);
        if (this.menuLifecycleEvents.length > 60) {
            this.menuLifecycleEvents.shift();
        }

        if (normalizedEvent.contractVersion !== this.menuLifecycleContractVersion) {
            this._showStatusToast(`Lifecycle-Contract mismatch: ${normalizedEvent.contractVersion}`, 1800, 'error');
            return;
        }

        if (normalizedEvent.type === 'multiplayer_host') {
            const lobbyCode = String(normalizedEvent.payload?.lobbyCode || 'local-lobby');
            this._showStatusToast(`Lobby erstellt: ${lobbyCode}`, 1200, 'info');
            return;
        }
        if (normalizedEvent.type === 'multiplayer_join') {
            const lobbyCode = String(normalizedEvent.payload?.lobbyCode || 'local-lobby');
            this._showStatusToast(`Lobby beigetreten: ${lobbyCode}`, 1200, 'info');
            return;
        }
        if (normalizedEvent.type === 'multiplayer_ready_toggle') {
            const ready = !!normalizedEvent.payload?.ready;
            this._showStatusToast(ready ? 'Ready gesetzt' : 'Ready entfernt', 1000, 'info');
            return;
        }
        if (normalizedEvent.type === 'multiplayer_ready_invalidated') {
            this._showStatusToast('Ready zurueckgesetzt: Host-Settings geaendert', 1500, 'info');
            return;
        }
        if (normalizedEvent.type === 'multiplayer_match_start') {
            const lobbyCode = String(normalizedEvent.payload?.lobbyCode || 'Lobby');
            this._showStatusToast(`Lobby startet Match: ${lobbyCode}`, 1400, 'info');
        }
    }

    getMenuLifecycleEvents() {
        return this.menuLifecycleEvents.slice();
    }

    _showPlayerFeedback(player, message) {
        if (!player) return;
        const prefix = player.isBot ? `Bot ${player.index + 1}` : `P${player.index + 1}`;
        this._showStatusToast(`${prefix}: ${message}`);
    }

    _getDeathMessage(cause) {
        const messages = {
            'WALL': 'Kollision mit der Wand!',
            'TRAIL_SELF': 'Eigener Schweif getroffen!',
            'TRAIL_OTHER': 'Gegnerischer Schweif getroffen!',
            'PROJECTILE': 'Abgeschossen!',
            'OUT_OF_BOUNDS': 'Arena verlassen!',
            'UNKNOWN': 'Unbekannte Todesursache'
        };
        return messages[cause] || messages['UNKNOWN'];
    }

    startMatch() {
        if (this._mobileClassicAppTarget) {
            applyMobileClassicSettings(this.settings);
            applyMobileClassicUiLocks(this);
        }
        this.runtimeCoordinator.startMatch();
    }

    _onRoundEnd(winner = null, outcome = null) {
        this.matchFlowUiController?.onRoundEnd?.(winner, outcome);
        if (
            outcome?.state === GAME_STATE_IDS.MATCH_END
            && this.mediaRecorderSystem?.isCinematicReplayRecording?.() === true
        ) {
            this.mediaRecorderSystem.stopRecording({
                type: 'match_completed',
                context: {
                    winnerIndex: Number.isInteger(winner?.index) ? winner.index : null,
                    outcome,
                },
            }).catch((error) => {
                console.warn('[Game] automatic cinematic replay queueing failed', error);
            });
        }
    }

    _getPlanarAimAxis(playerIndex) {
        return this.planarAimAssistSystem.getPlanarAimAxis(playerIndex);
    }

    _updatePlanarAimAssist(dt) {
        this.planarAimAssistSystem.updatePlanarAimAssist(dt);
    }

    _applyPlayingTimeScaleFromEffects() {
        this.planarAimAssistSystem.applyPlayingTimeScaleFromEffects();
    }

    _updatePlayingState(dt) {
        this.playingStateSystem.update(dt);
    }

    _updateRoundEndState(dt) {
        this.roundStateTickSystem.updateRoundEnd(dt);
    }

    _updateMatchEndState(dt) {
        this.roundStateTickSystem.updateMatchEnd(dt);
    }

    _updatePausedState(_dt) {
        if (this.input?.wasPressed?.('Escape')) {
            this.matchFlowUiController?.resumeFromPause?.();
        }
    }

    update(dt) {
        this.runtimeDiagnosticsSystem.update(dt);
        this._handleGlobalInputHotkeys();
        const requiresInteractiveMatchRuntime = this.state === GAME_STATE_IDS.PLAYING || this.state === GAME_STATE_IDS.PAUSED;
        const hasInteractiveMatchRuntime = !requiresInteractiveMatchRuntime || ensureInteractiveMatchRuntime(this);

        // Debug Recording
        if (this.state === GAME_STATE_IDS.PLAYING && hasInteractiveMatchRuntime && this.entityManager && this.recorder?.shouldCaptureFrames?.()) {
            this.recorder.recordFrame(this.entityManager.players);
        }

        const replayCaptureStateActive = this.state === GAME_STATE_IDS.PLAYING
            || this.state === GAME_STATE_IDS.PAUSED
            || this.state === GAME_STATE_IDS.ROUND_END;
        if (replayCaptureStateActive && hasInteractiveMatchRuntime && this.entityManager) {
            this._updatePlayingState(dt);
        } else if (this.state === GAME_STATE_IDS.PAUSED && hasInteractiveMatchRuntime) {
            this._updatePausedState(dt);
        } else if (this.state === GAME_STATE_IDS.ROUND_END) {
            this._updateRoundEndState(dt);
        } else if (this.state === GAME_STATE_IDS.MATCH_END) {
            this._updateMatchEndState(dt);
        }

        if (this.state === GAME_STATE_IDS.PLAYING && hasInteractiveMatchRuntime) {
            this.mediaRecorderSystem?.captureReplayState?.({
                entityManager: this.entityManager,
                roundState: this.roundStateController,
                particles: this.particles,
                dt,
                metadata: {
                    gameStateId: this.state,
                    mapKey: this.mapKey,
                    activeGameMode: this.activeGameMode,
                    numHumans: this.numHumans,
                    numBots: this.numBots,
                    winsNeeded: this.winsNeeded,
                    runtimeConfig: this.runtimeConfig,
                    randomSeed: this.runtimeConfig?.session?.seed
                        ?? this.runtimeConfig?.seed
                        ?? this.settings?.seed
                        ?? null,
                    settings: this.settings,
                },
            });
        }

        if (this.huntHud) {
            const runtimeProjection = this.state === GAME_STATE_IDS.PLAYING || this.state === GAME_STATE_IDS.PAUSED
                ? this.playingStateSystem.getMatchRuntimeProjection()
                : null;
            this.huntHud.update(dt, runtimeProjection);
        }
    }

    // Legacy compatibility hook retained for runtime/tests.
    _returnToMenu() {
        return this.runtimeCoordinator.returnToMenu();
    }

    render(alpha = this.gameLoop?.renderAlpha ?? 1, renderDelta = this.gameLoop?.renderDelta ?? this.gameLoop?.fixedStep ?? (1 / 60)) {
        const numericAlpha = Number(alpha);
        const numericRenderDelta = Number(renderDelta);
        this._renderAlpha = Number.isFinite(numericAlpha) ? Math.max(0, Math.min(1, numericAlpha)) : 1;
        this._renderDelta = Number.isFinite(numericRenderDelta) ? Math.max(0, Math.min(0.05, numericRenderDelta)) : (1 / 60);
        let matchRenderProjection = null;

        if (this.state === GAME_STATE_IDS.PLAYING || this.state === GAME_STATE_IDS.PAUSED) {
            this.playingStateSystem.render(this._renderAlpha, this._renderDelta);
            matchRenderProjection = this.playingStateSystem.getMatchRenderProjection();
        }
        const renderStart = this.runtimePerfProfiler?.startSample?.();
        this.renderer.render();
        if (this.mediaRecorderSystem?.isLiveRecording?.() === true) {
            this.renderer.prepareRecordingCaptureFrame({
                recordingActive: true,
                renderProjection: matchRenderProjection,
                arena: this.arena,
                renderAlpha: this._renderAlpha,
                renderDelta: this._renderDelta,
                splitScreen: this.renderer?.splitScreen === true,
            });
        }
        this.runtimePerfProfiler?.endSample?.('render', renderStart);
        this.mediaRecorderSystem?.captureRenderedFrame?.(this._renderDelta);
    }

    dispose() {
        if (this._disposePromise) return this._disposePromise;
        if (this._disposed) return Promise.resolve();
        this._disposed = true;

        this._clearPlaytestStartTimeout();
        this._disposePlaytestReturnControl?.();
        this._disposePlaytestReturnControl = null;
        if (this._boundKeyCaptureHandler) {
            window.removeEventListener('keydown', this._boundKeyCaptureHandler, true);
            this._boundKeyCaptureHandler = null;
        }

        this.keyCapture = null;
        const runtimeCoordinator = this.runtimeCoordinator;
        const runtimeFacade = runtimeCoordinator?.getRuntimeFacade?.();

        this._disposePromise = Promise.resolve()
            .then(() => runtimeCoordinator?.disposeRuntime?.())
            .finally(() => {
                releasePublishedRuntimeHandles(this, runtimeFacade, this.debugApi);
            });
        return this._disposePromise;
    }

}
installDesktopTuningRuntimeBridge();
initializeGameApp({ createGame: () => new Game() });

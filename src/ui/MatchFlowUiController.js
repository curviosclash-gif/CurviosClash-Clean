import { MatchFeedbackAdapter } from './MatchFeedbackAdapter.js';
import { PauseOverlayController } from './PauseOverlayController.js';
import { MatchFlowArcadeOverlayController } from './MatchFlowArcadeOverlayController.js';
import { MatchFlowLifecycleController } from './MatchFlowLifecycleController.js';
import { MatchFlowTelemetryController } from './MatchFlowTelemetryController.js';
import { resolveArenaMapSelection } from '../entities/CustomMapLoader.js';
import { hasGLBMapSource, resolveGLBMapSourceFootprint } from '../entities/GLBMapLoader.js';
import { deriveMatchLoadingUiState } from '../shared/contracts/MatchUiStateContract.js';
import { createPreferredMatchInputSource } from './MatchInputSourceResolver.js';
import {
    createNetworkLocalInputSource,
    createNetworkRemoteInputSource,
    createPassiveNetworkInputSource,
} from './NetworkMatchInputSources.js';
import {
    deriveMatchStartTransition,
    deriveReturnToMenuTransition,
    deriveRoundStartTransition,
} from '../shared/contracts/MatchFlowTransitionContract.js';
import { coordinateRoundEnd } from './MatchFlowRoundEndCoordinator.js';
import { createPostMatchContinuePrompt } from './postmatch/PostMatchContinuePrompt.js';
import { createMatchFlowUiControllerPort } from '../shared/runtime/UiControllerRuntimePorts.js';
import {
    getMatchSessionAccessSnapshot,
    syncMatchP2HudVisibility,
} from './MatchFlowTransitionHotspots.js';
import { VIEWPORT_LAYOUTS } from '../shared/contracts/ViewportLayoutContract.js';
import { resolveThreePlayerSplitInputDevice, SPLIT_SCREEN_VARIANTS } from '../four-player-planar/FourPlayerPlanarContract.js';

function hasOwnProperty(source, key) {
    return !!source && Object.prototype.hasOwnProperty.call(source, key);
}

export class MatchFlowUiController {
    constructor(deps = {}) {
        this.runtime = deps.runtime || deps.game || null;
        this.runtimePort = deps.runtimePort || createMatchFlowUiControllerPort(deps.ports || null);
        if (!deps.sessionOrchestrator) {
            throw new TypeError('MatchFlowUiController requires sessionOrchestrator');
        }
        this.sessionOrchestrator = deps.sessionOrchestrator;
        this.feedbackAdapter = new MatchFeedbackAdapter({
            showToast: (message, durationMs, tone) => {
                if (this.runtimePort?.showStatusToast) {
                    this.runtimePort.showStatusToast(message, durationMs, tone);
                    return;
                }
                this.game?._showStatusToast?.(message, durationMs, tone);
            },
            logger: console,
        });
        this.pauseOverlayController = new PauseOverlayController({
            matchFlowUiController: this,
            runtime: this.game,
            ports: deps.ports || null,
        });
        this.arcadeOverlayController = new MatchFlowArcadeOverlayController({
            matchFlowUiController: this,
            runtime: this.game,
            runtimePort: this.runtimePort,
        });
        this.telemetryController = new MatchFlowTelemetryController({
            matchFlowUiController: this,
            runtime: this.game,
            runtimePort: this.runtimePort,
        });
        this.lifecycleController = new MatchFlowLifecycleController({
            matchFlowUiController: this,
            runtime: this.game,
            runtimePort: this.runtimePort,
            sessionOrchestrator: this.sessionOrchestrator,
            telemetryController: this.telemetryController,
            coordinateRoundEnd,
            deriveRoundStartTransition,
            deriveReturnToMenuTransition,
        });
    }

    get game() {
        return this.runtime;
    }

    _resolveMessageStatsContainer() {
        return this.game?.ui?.messageStats || null;
    }

    _getMatchRuntimeProjection() {
        return this.runtimePort?.getMatchRuntimeProjection?.() || null;
    }

    _clearMessageStatsUi() {
        this.arcadeOverlayController.clearMessageStatsUi();
    }

    _renderMessageStatsUi(overlayStats) {
        this.arcadeOverlayController.renderMessageStatsUi(overlayStats);
    }

    /** The prompt lives next to the board and is built on the first result screen of a session. */
    _applyContinuePromptUi(promptState) {
        if (!this.continuePrompt) {
            const container = this.game?.ui?.messageActions || null;
            if (!container) return;
            this.continuePrompt = createPostMatchContinuePrompt({
                container,
                runtimePort: this.runtimePort,
                getControls: () => this.game?.settings?.controls || null,
            });
        }
        this.continuePrompt.apply(promptState);
    }

    _clearArcadeOverlayPanel() {
        this.arcadeOverlayController.clearArcadeOverlayPanel();
    }

    _syncArcadeOverlayPanel() {
        this.arcadeOverlayController.syncArcadeOverlayPanel();
    }

    applyMatchUiState(uiState) {
        const game = this.game;
        const visibility = uiState?.visibility || {};
        const hasOwn = (key) => hasOwnProperty(visibility, key);
        if (game.ui.mainMenu && hasOwn('mainMenuHidden')) {
            game.ui.mainMenu.classList.toggle('hidden', visibility.mainMenuHidden !== false);
        }
        if (game.ui.hud && hasOwn('hudHidden')) {
            game.ui.hud.classList.toggle('hidden', visibility.hudHidden === true);
        }
        if (game.ui.messageOverlay) {
            if (typeof uiState?.messageText === 'string' && game.ui.messageText) {
                game.ui.messageText.textContent = uiState.messageText;
            }
            if (typeof uiState?.messageSub === 'string' && game.ui.messageSub) {
                game.ui.messageSub.textContent = uiState.messageSub;
            }
            if (hasOwn('messageOverlayHidden')) {
                game.ui.messageOverlay.classList.toggle('hidden', visibility.messageOverlayHidden !== false);
                // style.css hides the frozen Fight HUD behind the result through this flag.
                game.ui.hud?.classList.toggle('result-overlay-open', visibility.messageOverlayHidden === false);
            }
        }
        if (hasOwnProperty(uiState, 'overlayStats')) {
            this._renderMessageStatsUi(uiState.overlayStats);
        }
        if (hasOwnProperty(uiState, 'continuePrompt')) {
            this._applyContinuePromptUi(uiState.continuePrompt);
        }
        if (game.ui.pauseOverlay && hasOwn('pauseOverlayHidden')) {
            game.ui.pauseOverlay.classList.toggle('hidden', visibility.pauseOverlayHidden !== false);
        }
        if (game.ui.statusToast && hasOwn('statusToastHidden')) {
            game.ui.statusToast.classList.toggle('hidden', visibility.statusToastHidden !== false);
        }

        if (typeof uiState?.viewportLayout === 'string') {
            const splitScreenEnabled = uiState.viewportLayout !== VIEWPORT_LAYOUTS.SINGLE;
            game.ui.hud?.classList.toggle('split-screen', splitScreenEnabled);
            if (this.runtimePort?.setViewportLayout) {
                this.runtimePort.setViewportLayout(uiState.viewportLayout);
            } else if (this.runtimePort?.setSplitScreen) {
                this.runtimePort.setSplitScreen(splitScreenEnabled);
            } else if (game.renderer?.setViewportLayout) {
                game.renderer.setViewportLayout(uiState.viewportLayout);
            } else {
                game.renderer?.setSplitScreen?.(splitScreenEnabled);
            }
            if (uiState.viewportLayout === VIEWPORT_LAYOUTS.FOUR_GRID) {
                game.fourPlayerPlanar?.activateMatch?.();
            } else {
                game.fourPlayerPlanar?.deactivateMatch?.();
            }
            if (uiState.viewportLayout === VIEWPORT_LAYOUTS.THREE_COLUMNS) {
                game.threePlayerSplit?.activateMatch?.();
            } else {
                game.threePlayerSplit?.deactivateMatch?.();
            }
        } else if (typeof uiState?.splitScreenEnabled === 'boolean') {
            game.ui.hud?.classList.toggle('split-screen', uiState.splitScreenEnabled);
            if (this.runtimePort?.setSplitScreen) {
                this.runtimePort.setSplitScreen(uiState.splitScreenEnabled);
            } else {
                game.renderer.setSplitScreen(uiState.splitScreenEnabled);
            }
        }
        if (typeof uiState?.p2HudVisible === 'boolean') {
            if (game.ui.p2Hud) {
                game.ui.p2Hud.classList.toggle('hidden', !uiState.p2HudVisible);
            } else {
                syncMatchP2HudVisibility(this.runtimePort, game, uiState.p2HudVisible);
            }
        }
        this._syncArcadeOverlayPanel();
    }

    applyMatchStartUiState(uiState) {
        this.applyMatchUiState(uiState);
    }

    applyLifecycleTransition(transition) {
        return this.runtimePort?.applyLifecycleTransition?.(transition) === true;
    }

    resetCrosshairElementUi(element) {
        if (!element) return;
        element.style.display = 'none';
        element.style.left = '50%';
        element.style.top = '50%';
        element.style.transform = 'translate(-50%, -50%) rotate(0deg)';
    }

    resetCrosshairUi() {
        const game = this.game;
        this.resetCrosshairElementUi(game.ui.crosshairP1);
        this.resetCrosshairElementUi(game.ui.crosshairP2);
    }

    _handleHuntDamageEvent(event) {
        this.telemetryController.handleHuntDamageEvent(event);
    }

    _pushHuntFeedEntry(entry) {
        this.telemetryController.pushHuntFeedEntry(entry);
    }

    _resolveMatchLoadingUiState() {
        const requestedMapKey = this.game?.runtimeConfig?.session?.mapKey || this.game?.mapKey || 'standard';
        const mapSelection = resolveArenaMapSelection(requestedMapKey);
        const mapDefinition = mapSelection?.mapDefinition || null;
        const mapName = String(mapDefinition?.name || requestedMapKey || 'Arena');
        if (!hasGLBMapSource(mapDefinition)) {
            return deriveMatchLoadingUiState({
                messageText: `Lade ${mapName}...`,
                messageSub: 'Arena wird vorbereitet',
            });
        }
        const footprint = resolveGLBMapSourceFootprint(mapDefinition);
        const COLLIDER_LABELS = {
            fallbackOnly: 'Box-Collider',
            dynamic: 'Box- und Animations-Collider',
        };
        const colliderLabel = COLLIDER_LABELS[footprint.colliderMode] || 'Szenen-Collider';
        const sourceLabel = footprint.sourceKind === 'embedded'
            ? 'eingebettet'
            : (footprint.sourceKind === 'collection' ? `${footprint.modelCount} Modelle` : footprint.sourceKind);
        return deriveMatchLoadingUiState({
            messageText: `Lade ${mapName}...`,
            messageSub: `GLB-Umgebung wird vorbereitet (${sourceLabel}, ${colliderLabel})`,
        });
    }

    waitForMatchLoadingFrame() {
        return new Promise((resolve) => {
            const requestFrame = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
                ? window.requestAnimationFrame.bind(window)
                : null;
            if (requestFrame) {
                requestFrame(() => requestFrame(resolve));
                return;
            }
            resolve();
        });
    }

    _buildRoundEndTelemetryPayload(roundEndPlan) {
        return this.telemetryController.buildRoundEndTelemetryPayload(roundEndPlan);
    }

    _recordRoundEndTelemetry(roundEndPlan) {
        this.telemetryController.recordRoundEndTelemetry(roundEndPlan);
    }

    completeMatchStartProjection(initializedMatch) {
        if (!initializedMatch) return false;
        this.feedbackAdapter.applyFeedbackPlan(initializedMatch?.feedbackPlan);
        return true;
    }

    bindMatchStartRuntime() {
        this.telemetryController.bindHuntEventHandlers(this.sessionOrchestrator);
    }

    _createPreferredInputSource(playerIndex, localHumanCount, options = {}) {
        return createPreferredMatchInputSource({
            inputManager: this.game?.input,
            game: this.game,
            playerIndex,
            localHumanCount,
            inputDeviceIndex: options.inputDeviceIndex ?? playerIndex,
            assignedInputDevice: options.assignedInputDevice || null,
            getMatchRuntimeProjection: () => this.runtimePort?.getMatchRuntimeProjection?.() || null,
        });
    }

    _resolveNetworkPlayerSlots(sessionConfig, networkContext) {
        if (Array.isArray(sessionConfig?.networkPlayerSlots) && sessionConfig.networkPlayerSlots.length > 0) {
            return sessionConfig.networkPlayerSlots;
        }
        return Array.isArray(networkContext?.slots) ? networkContext.slots : [];
    }

    _configureNetworkInputSourcesForMatch(input) {
        const game = this.game;
        const sessionConfig = game?.runtimeConfig?.session || null;
        if (sessionConfig?.networkEnabled !== true) return false;

        // Session-Handle und Slot-Fallback kommen ueber den Runtime-Port
        // (Facade-Besitz bleibt im Core; UI liest keine Runtime-Globals).
        const networkContext = this.runtimePort?.getNetworkMatchInputContext?.() || null;
        const session = networkContext?.session || null;
        const slots = this._resolveNetworkPlayerSlots(sessionConfig, networkContext);
        if (!Array.isArray(slots) || slots.length <= 0) return false;

        const localPlayerIndex = Number.isInteger(sessionConfig.localPlayerIndex)
            ? sessionConfig.localPlayerIndex
            : 0;
        const localHumanCount = Math.max(1, Number(sessionConfig.localHumanCount) || 1);

        for (const slot of slots) {
            const playerIndex = Number.isInteger(slot?.playerIndex) ? slot.playerIndex : -1;
            if (playerIndex < 0) continue;

            if (playerIndex === localPlayerIndex) {
                const preferredSource = this._createPreferredInputSource(playerIndex, localHumanCount, {
                    inputDeviceIndex: 0,
                });
                const isGuest = session?.isHost !== true;
                input.setPlayerSource(playerIndex, createNetworkLocalInputSource({
                    source: preferredSource,
                    session,
                    playerId: slot.peerId || slot.playerId || slot.id || '',
                    sendToSession: isGuest,
                    // Only a guest ramps here. Its slot is reconciled against the host, and the
                    // host cannot know this machine's smooth steering setting, so the guest ships
                    // the smoothed axis instead of the raw keys. The host steers its own slot
                    // through PlayerController, where nothing reconciles it.
                    steeringRamp: {
                        enabled: isGuest && game?.settings?.localSettings?.smoothSteering === true,
                    },
                }));
                continue;
            }

            const remoteSource = session?.isHost === true
                ? createNetworkRemoteInputSource({
                    session,
                    peerId: slot.peerId || slot.playerId || slot.id || '',
                    playerId: slot.peerId || slot.playerId || slot.id || '',
                })
                : createPassiveNetworkInputSource();
            input.setPlayerSource(playerIndex, remoteSource);
        }
        return true;
    }

    _configureInputSourcesForMatch() {
        const game = this.game;
        const input = game?.input;
        if (!input?.setPlayerSource || !input?.clearPlayerSources) return;

        input.clearPlayerSources();
        if (this._configureNetworkInputSourcesForMatch(input)) {
            return;
        }
        if (game.fourPlayerPlanar?.configureInputSources?.(input)) {
            return;
        }
        const session = game?.runtimeConfig?.session;
        const localHumanCount = Math.max(1, Number(session?.numHumans) || 1);
        const threePlayerAssignment = session?.splitScreenVariant === SPLIT_SCREEN_VARIANTS.THREE_PLAYER
            && localHumanCount === 3 ? (session.threePlayerSplit?.deviceAssignment || []) : null;
        for (let playerIndex = 0; playerIndex < localHumanCount; playerIndex += 1) {
            const source = this._createPreferredInputSource(playerIndex, localHumanCount, {
                assignedInputDevice: threePlayerAssignment
                    ? resolveThreePlayerSplitInputDevice(threePlayerAssignment, playerIndex)
                    : null,
            });
            if (source) {
                input.setPlayerSource(playerIndex, source);
            }
        }
    }

    prepareMatchStartProjection() {
        const game = this.game;
        game.keyCapture = null;

        const matchStartTransition = deriveMatchStartTransition({
            numHumans: game.numHumans,
            viewportLayout: game?.runtimeConfig?.session?.viewportLayout,
        });
        this.applyLifecycleTransition(matchStartTransition);
        this.applyMatchStartUiState(matchStartTransition.uiState);
        const loadingUiState = this._resolveMatchLoadingUiState();
        this.applyMatchUiState(loadingUiState);

        return true;
    }

    configureMatchInputSources() {
        this._configureInputSourcesForMatch();
    }

    startMatch(options = undefined) {
        if (this.runtimePort?.startMatch) {
            return this.runtimePort.startMatch(options);
        }
        return false;
    }

    startRound() {
        return this.lifecycleController.startRound();
    }

    onRoundEnd(winner, outcome = null) {
        return this.lifecycleController.onRoundEnd(winner, outcome);
    }

    buildRoundEndCoordinatorRequest(winner, outcome = null) {
        return this.lifecycleController.buildRoundEndCoordinatorRequest(winner, outcome);
    }

    applyRoundEndCoordinatorPlan(roundEndPlan) {
        return this.lifecycleController.applyRoundEndCoordinatorPlan(roundEndPlan);
    }

    applyRoundEndCoordinatorEffects(effectsPlan) {
        return this.lifecycleController.applyRoundEndCoordinatorEffects(effectsPlan);
    }

    applyRoundEndCoordinatorUiState(uiState) {
        return this.lifecycleController.applyRoundEndCoordinatorUiState(uiState);
    }

    applyRoundEndControllerTransitionState(roundEndTransition) {
        return this.lifecycleController.applyRoundEndControllerTransitionState(roundEndTransition);
    }

    applyReturnToMenuUi(options = {}) {
        return this.lifecycleController.applyReturnToMenuUi(options);
    }

    returnToMenu(options = {}) {
        return this.lifecycleController.returnToMenu(options);
    }

    /**
     * Returns true if the current match is a network session.
     */
    _isNetworkMatch() {
        return getMatchSessionAccessSnapshot(this.runtimePort, this.game)?.isNetworkSession === true;
    }

    /**
     * Returns true if the local client is the host.
     */
    _isHost() {
        return getMatchSessionAccessSnapshot(this.runtimePort, this.game)?.isHost !== false;
    }
    pause() { this.pauseOverlayController.pause(); }
    resumeFromPause() { this.pauseOverlayController.resumeFromPause(); }
    closePauseSettingsIfOpen() { return this.pauseOverlayController.closeSettingsIfOpen(); }
    returnToMenuFromPause() { this.pauseOverlayController.returnToMenuFromPause(); }
    applyPauseProjection() { return this.pauseOverlayController.applyPauseProjection(); }
    applyResumeProjection(options = undefined) { return this.pauseOverlayController.applyResumeProjection(options); }
    applyDisconnectConfirmationProjection() { return this.pauseOverlayController.applyDisconnectConfirmationProjection(); }
    setupPauseOverlayListeners() { this.pauseOverlayController.setupListeners(); }
    dispose() {
        this.continuePrompt?.dispose?.();
        this.continuePrompt = null;
        this.arcadeOverlayController?.dispose?.();
        this.pauseOverlayController?.dispose?.();
    }
}

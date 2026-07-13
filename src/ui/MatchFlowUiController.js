import { createLogger } from '../shared/logging/Logger.js';
import { MatchFeedbackAdapter } from './MatchFeedbackAdapter.js';

const logger = createLogger('MatchFlowUiController');
import {
    createMatchSessionPort,
    MatchLifecycleSessionOrchestrator,
} from '../state/MatchLifecycleSessionOrchestrator.js';
import { PauseOverlayController } from './PauseOverlayController.js';
import { MatchFlowArcadeOverlayController } from './MatchFlowArcadeOverlayController.js';
import { MatchFlowLifecycleController } from './MatchFlowLifecycleController.js';
import { MatchFlowTelemetryController } from './MatchFlowTelemetryController.js';
import { resolveArenaMapSelection } from '../entities/CustomMapLoader.js';
import { resolveGLBFootprint } from '../entities/GLBMapLoader.js';
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
} from './MatchFlowLifecycleTransitions.js';
import { coordinateRoundEnd } from './MatchFlowRoundEndCoordinator.js';
import {
    GAME_STATE_IDS,
    normalizeGameStateId,
} from '../shared/contracts/GameStateIds.js';
import { createMatchFlowUiControllerPort } from '../shared/runtime/UiControllerRuntimePorts.js';
import { executeAtomicUiIntent } from '../shared/runtime/UiIntentAtomicity.js';
import {
    getMatchSessionAccessSnapshot,
    initializeMatchSession,
    startArcadeRunIfEnabled,
    syncMatchP2HudVisibility,
    waitForMatchPlayersLoaded,
} from './MatchFlowTransitionHotspots.js';

function isPromiseLike(value) {
    return !!value && typeof value.then === 'function';
}

function hasOwnProperty(source, key) {
    return !!source && Object.prototype.hasOwnProperty.call(source, key);
}

export class MatchFlowUiController {
    constructor(deps = {}) {
        this.runtime = deps.runtime || deps.game || null;
        this.runtimePort = deps.runtimePort || createMatchFlowUiControllerPort(deps.ports || null);
        this.sessionOrchestrator = deps.sessionOrchestrator
            || new MatchLifecycleSessionOrchestrator(createMatchSessionPort(this.game));
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
        this._startMatchPromise = null;
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
            }
        }
        if (hasOwnProperty(uiState, 'overlayStats')) {
            this._renderMessageStatsUi(uiState.overlayStats);
        }
        if (game.ui.pauseOverlay && hasOwn('pauseOverlayHidden')) {
            game.ui.pauseOverlay.classList.toggle('hidden', visibility.pauseOverlayHidden !== false);
        }
        if (game.ui.statusToast && hasOwn('statusToastHidden')) {
            game.ui.statusToast.classList.toggle('hidden', visibility.statusToastHidden !== false);
        }

        if (typeof uiState?.splitScreenEnabled === 'boolean') {
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
        const game = this.game;
        if (!transition) return;

        if (typeof transition.state === 'string' && transition.state.length > 0) {
            game.state = normalizeGameStateId(transition.state, game?.state || GAME_STATE_IDS.MENU);
        }
        if (typeof transition.roundPause === 'number') {
            game.roundPause = transition.roundPause;
        }
        if (typeof transition.hudTimer === 'number') {
            game._hudTimer = transition.hudTimer;
        }
        if (transition.huntStatePatch && game.huntState) {
            // Safe mutation: shallow-copy the patch to prevent stale closure references
            // from corrupting shared state. Patch ordering is guaranteed to be sequential
            // within the same frame; patches buffered across frames apply in FIFO order.
            Object.assign(game.huntState, { ...transition.huntStatePatch });
        }
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
        if (!mapDefinition?.glbModel) return null;
        const footprint = resolveGLBFootprint(mapDefinition.glbModel, {
            colliderMode: mapDefinition?.glbColliderMode || 'scene',
        });
        const colliderLabel = footprint.colliderMode === 'fallbackOnly' ? 'Box-Collider' : 'Szenen-Collider';
        const sourceLabel = footprint.sourceKind === 'embedded' ? 'eingebettet' : footprint.sourceKind;
        return deriveMatchLoadingUiState({
            messageText: `Lade ${String(mapDefinition?.name || requestedMapKey)}...`,
            messageSub: `GLB-Umgebung wird vorbereitet (${sourceLabel}, ${colliderLabel})`,
        });
    }
    _buildRoundEndTelemetryPayload(roundEndPlan) {
        return this.telemetryController.buildRoundEndTelemetryPayload(roundEndPlan);
    }

    _recordRoundEndTelemetry(roundEndPlan) {
        this.telemetryController.recordRoundEndTelemetry(roundEndPlan);
    }

    _completeStartedMatch(initializedMatch) {
        startArcadeRunIfEnabled(this.runtimePort, this.game);
        this.telemetryController.bindHuntEventHandlers(this.sessionOrchestrator);
        this.startRound();
        this.feedbackAdapter.applyFeedbackPlan(initializedMatch?.feedbackPlan);
        return true;
    }

    _handleStartMatchFailure(error) {
        logger.error('startMatch failed:', error);
        if (this.runtimePort?.showStatusToast) {
            this.runtimePort.showStatusToast('Map-Start fehlgeschlagen. Fallback oder Menue wird geladen.', 2600, 'error');
        } else {
            this.game?._showStatusToast?.('Map-Start fehlgeschlagen. Fallback oder Menue wird geladen.', 2600, 'error');
        }
        this.returnToMenu({ reason: 'match_start_failure', trigger: 'match_start_failure' });
        return false;
    }

    _createPreferredInputSource(playerIndex, localHumanCount, options = {}) {
        return createPreferredMatchInputSource({
            inputManager: this.game?.input,
            game: this.game,
            playerIndex,
            localHumanCount,
            inputDeviceIndex: options.inputDeviceIndex ?? playerIndex,
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
                input.setPlayerSource(playerIndex, createNetworkLocalInputSource({
                    source: preferredSource,
                    session,
                    playerId: slot.peerId || slot.playerId || slot.id || '',
                    sendToSession: session?.isHost !== true,
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
        const localHumanCount = Math.max(1, Number(game?.runtimeConfig?.session?.numHumans) || 1);
        for (let playerIndex = 0; playerIndex < localHumanCount; playerIndex += 1) {
            const source = this._createPreferredInputSource(playerIndex, localHumanCount);
            if (source) {
                input.setPlayerSource(playerIndex, source);
            }
        }
    }

    _startMatchInternal() {
        const game = this.game;
        game.keyCapture = null;

        const matchStartTransition = deriveMatchStartTransition({ numHumans: game.numHumans });
        this.applyLifecycleTransition(matchStartTransition);
        this.applyMatchStartUiState(matchStartTransition.uiState);
        const loadingUiState = this._resolveMatchLoadingUiState();
        if (loadingUiState) {
            this.applyMatchUiState(loadingUiState);
        }

        // Initialize session adapter (Local/LAN/Online)
        const sessionInitPromise = initializeMatchSession(this.runtimePort, game);

        const createMatch = () => {
            this._configureInputSourcesForMatch();
            const initializedMatch = this.sessionOrchestrator.createMatchSession({
                onPlayerFeedback: (player, message) => {
                    if (this.runtimePort?.showPlayerFeedback) {
                        this.runtimePort.showPlayerFeedback(player, message);
                    } else {
                        game._showPlayerFeedback?.(player, message);
                    }
                },
                onPlayerDied: (player, cause) => {
                    if (!player.isBot) {
                        const deathMessage = this.runtimePort?.getDeathMessage
                            ? this.runtimePort.getDeathMessage(cause)
                            : game._getDeathMessage?.(cause);
                        if (this.runtimePort?.showStatusToast) {
                            this.runtimePort.showStatusToast(deathMessage, 2500, 'error');
                        } else {
                            game._showStatusToast?.(deathMessage, 2500, 'error');
                        }
                    }
                },
                onRoundEnd: (winner, outcome) => {
                    this.onRoundEnd(winner, outcome);
                },
            });
            return initializedMatch;
        };

        const completeWithLoadGate = (resolvedMatch) => {
            const loadGate = waitForMatchPlayersLoaded(this.runtimePort, game);
            if (isPromiseLike(loadGate)) {
                return Promise.resolve(loadGate).then(() => this._completeStartedMatch(resolvedMatch));
            }
            return this._completeStartedMatch(resolvedMatch);
        };

        if (isPromiseLike(sessionInitPromise)) {
            return Promise.resolve(sessionInitPromise).then(() => {
                const initializedMatch = createMatch();
                if (isPromiseLike(initializedMatch)) {
                    return Promise.resolve(initializedMatch).then((r) => completeWithLoadGate(r));
                }
                return completeWithLoadGate(initializedMatch);
            });
        }

        const initializedMatch = createMatch();
        if (isPromiseLike(initializedMatch)) {
            return Promise.resolve(initializedMatch).then((resolvedMatch) => completeWithLoadGate(resolvedMatch));
        }
        return completeWithLoadGate(initializedMatch);
    }

    applyStartMatchProjection() {
        return executeAtomicUiIntent({
            currentPromise: this._startMatchPromise,
            assignPendingPromise: (promise) => {
                this._startMatchPromise = promise;
            },
            clearPendingPromise: (promise) => {
                if (this._startMatchPromise === promise) {
                    this._startMatchPromise = null;
                }
            },
            execute: () => this._startMatchInternal(),
            handleError: (error) => this._handleStartMatchFailure(error),
        });
    }

    startMatch(options = undefined) {
        if (this.runtimePort?.startMatch) {
            return this.runtimePort.startMatch(options);
        }
        return this.applyStartMatchProjection();
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
    returnToMenuFromPause() { this.pauseOverlayController.returnToMenuFromPause(); }
    applyPauseProjection() { return this.pauseOverlayController.applyPauseProjection(); }
    applyResumeProjection(options = undefined) { return this.pauseOverlayController.applyResumeProjection(options); }
    applyDisconnectConfirmationProjection() { return this.pauseOverlayController.applyDisconnectConfirmationProjection(); }
    setupPauseOverlayListeners() { this.pauseOverlayController.setupListeners(); }
    dispose() {
        this.arcadeOverlayController?.dispose?.();
        this.pauseOverlayController?.dispose?.();
    }
}

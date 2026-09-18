import { GAME_STATE_IDS } from '../../shared/contracts/GameStateIds.js';
import { SESSION_FINALIZE_TRIGGERS } from '../../shared/contracts/MatchLifecycleContract.js';
import { RUNTIME_SESSION_TYPES, resolveRuntimeSessionContract } from '../../shared/contracts/RuntimeSessionContract.js';
import { SESSION_RUNTIME_EVENT_TYPES } from '../../shared/contracts/SessionRuntimeEventContract.js';
import { recordSessionRuntimeEvent } from '../../shared/runtime/SessionRuntimeObservability.js';
import {
    canExecutePauseOverlayIntent,
    createDeferred,
    PAUSE_OVERLAY_INTENT_TYPES,
} from '../../shared/runtime/UiIntentAtomicity.js';
import { applyCommandRuntimeSettings } from './RuntimeCommandSettingsService.js';
import { requestRuntimeMultiplayerMatchStart } from './RuntimeMultiplayerFlowService.js';
import { MatchStartRuntimeService } from './MatchStartRuntimeService.js';
import {
    initRuntimeSession,
    teardownRuntimeSession,
    waitForRuntimePlayersLoaded,
} from './RuntimeSessionLifecycleService.js';

const TERMINAL_START_BLOCKING_FINALIZE_REASONS = new Set([
    SESSION_FINALIZE_TRIGGERS.GAME_DISPOSE,
    SESSION_FINALIZE_TRIGGERS.WINDOW_SHUTDOWN,
]);
const TERMINAL_DISPOSE_FINALIZE_STATES = new Set([
    'idle',
    'finalized',
    'error',
]);
const MATCH_START_COMMAND_SOURCE = 'menu_multiplayer_bridge';

function blurFocusedTextInput(docRef = globalThis?.document) {
    const activeElement = docRef?.activeElement;
    if (!activeElement || typeof activeElement.blur !== 'function') {
        return false;
    }

    const tagName = String(activeElement.tagName || '').toUpperCase();
    const inputType = String(activeElement.getAttribute?.('type') || 'text').toLowerCase();
    const isTextInput = tagName === 'TEXTAREA'
        || (tagName === 'INPUT' && (
            inputType === 'text'
            || inputType === 'search'
            || inputType === 'url'
            || inputType === 'email'
            || inputType === 'number'
            || inputType === 'password'
        ))
        || activeElement.isContentEditable === true;

    if (!isTextInput) {
        return false;
    }

    activeElement.blur();
    return true;
}

export class GameRuntimeSessionHandler {
    constructor({ facade = null, logger = console } = {}) {
        this._facade = facade || null;
        this._logger = logger;
        this._pendingStartMatch = null;
        this._pendingDispose = null;
        this._matchStartRuntime = new MatchStartRuntimeService({ facade: this._facade });
    }

    _getPorts() {
        return this._facade?.getPorts?.() || this._facade?.ports || null;
    }

    _getMatchFlowSnapshot() {
        return this._getPorts()?.runtimeProjectionPort?.getMatchFlowSnapshot?.() || null;
    }

    _canExecutePauseIntent(intentType, pauseLease = null) {
        return canExecutePauseOverlayIntent(this._getMatchFlowSnapshot(), pauseLease, intentType);
    }

    async initializeSession(_options = undefined) {
        return initRuntimeSession(this._facade);
    }

    async waitForAllPlayersLoaded() {
        return waitForRuntimePlayersLoaded(this._facade);
    }

    teardownRuntimeSession() {
        teardownRuntimeSession(this._facade);
    }

    isNetworkSession() {
        return !!this._facade?.game?.runtimeConfig?.session?.networkEnabled;
    }

    isHost() {
        return this._facade?.session?.isHost ?? true;
    }

    _getSessionRuntimeSnapshot() {
        return this._facade?.getPorts?.()?.runtimeProjectionPort?.getSessionRuntimeSnapshot?.() || null;
    }

    _isTerminalStartBarrier(reason = '') {
        return TERMINAL_START_BLOCKING_FINALIZE_REASONS.has(String(reason || '').trim());
    }

    _recordBlockedStart(telemetryPayload, reason, extra = undefined) {
        this._facade?._recordMenuTelemetry?.('abort', {
            ...telemetryPayload,
            reason,
            ...(extra && typeof extra === 'object' ? extra : {}),
        });
    }

    _getRuntimeEventSource() {
        return this._facade?.getRuntimeBundle?.() || this._facade?.game || null;
    }

    _clearPendingFinalize(pendingFinalize = null) {
        if (!pendingFinalize || this._facade?._pendingMatchFinalize !== pendingFinalize) {
            return;
        }
        this._facade._pendingMatchFinalize = null;
        this._facade._pendingMatchFinalizePlan = null;
    }

    _recordStartBarrierFinalizeFailure(pendingReason, error) {
        recordSessionRuntimeEvent(this._getRuntimeEventSource(), {
            type: SESSION_RUNTIME_EVENT_TYPES.MATCH_FINALIZE_FAILED,
            source: 'game_runtime_session_handler',
            payload: {
                phase: 'start_barrier',
                reason: pendingReason || SESSION_FINALIZE_TRIGGERS.RETURN_TO_MENU,
                errorMessage: error instanceof Error ? error.message : 'pending_finalize_rejected',
            },
        });
    }

    _awaitPendingFinalizeForStart(telemetryPayload, continueAfterBarrier = null) {
        const facade = this._facade;
        const proceed = () => (
            typeof continueAfterBarrier === 'function'
                ? continueAfterBarrier()
                : true
        );
        const sessionSnapshot = this._getSessionRuntimeSnapshot();
        if (sessionSnapshot?.lifecycleState === 'disposed') {
            this._recordBlockedStart(telemetryPayload, 'start_blocked_by_runtime_state', {
                lifecycleState: sessionSnapshot?.lifecycleState || '',
                finalizeState: sessionSnapshot?.finalizeState || '',
            });
            return false;
        }
        const pendingFinalize = facade?._pendingMatchFinalize;
        const pendingReason = String(facade?._pendingMatchFinalizePlan?.reason || sessionSnapshot?.pendingFinalizeTrigger || '').trim();
        if (!pendingFinalize) {
            return proceed();
        }
        if (this._isTerminalStartBarrier(pendingReason)) {
            this._recordBlockedStart(telemetryPayload, 'start_blocked_by_terminal_finalize', {
                pendingFinalizeReason: pendingReason,
            });
            return false;
        }
        return Promise.resolve(pendingFinalize)
            .then((finalizeResult) => {
                const nextSnapshot = this._getSessionRuntimeSnapshot();
                if (finalizeResult === false || nextSnapshot?.finalizeState === 'error' || nextSnapshot?.lifecycleState === 'disposed') {
                    this._recordBlockedStart(telemetryPayload, 'start_blocked_after_finalize_wait', {
                    pendingFinalizeReason: pendingReason,
                        finalizeResult: finalizeResult === false ? 'false' : 'ok',
                        lifecycleState: nextSnapshot?.lifecycleState || '',
                        finalizeState: nextSnapshot?.finalizeState || '',
                    });
                    return false;
                }
                return proceed();
            })
            .catch((error) => {
                this._logger?.error?.('startMatch finalize barrier failed:', error);
                this._clearPendingFinalize(pendingFinalize);
                this._recordStartBarrierFinalizeFailure(pendingReason, error);
                this._recordBlockedStart(telemetryPayload, 'start_blocked_after_finalize_rejection', {
                    pendingFinalizeReason: pendingReason,
                    errorMessage: error instanceof Error ? error.message : 'pending_finalize_rejected',
                });
                return false;
            });
    }

    _startMatchAfterGuards(options = undefined) {
        const facade = this._facade;
        const game = facade?.game;
        if (!game) {
            return false;
        }
        if (options?.settingsSnapshot && game.state !== null && game.state !== undefined && game.state !== GAME_STATE_IDS.MENU) {
            return false;
        }
        facade?._clearMatchPrewarmTimer?.();
        const buildTelemetryPayload = () => {
            const sessionContract = resolveRuntimeSessionContract(game?.settings?.localSettings);
            return {
                sessionType: sessionContract.sessionType,
                multiplayerTransport: sessionContract.multiplayerTransport,
                modePath: game?.settings?.localSettings?.modePath || 'normal',
            };
        };
        const runStartAttempt = () => {
            applyCommandRuntimeSettings(facade, {
                ...(options && typeof options === 'object' ? options : {}),
                schedulePrewarm: false,
            });
            facade?.settingsHandler?.applySurfacePolicyStartDefaults?.();
            facade?.settingsHandler?.applyMapScenarioStartDefaults?.();
            if (options?.arcadeSectorTransition?.fivePortals === true) {
                facade?._applyArcadeSectorRuntimeProfile?.(options.arcadeSectorTransition);
            }
            const sessionContract = resolveRuntimeSessionContract(game?.settings?.localSettings);
            const telemetryPayload = buildTelemetryPayload();
            const isReceivedMultiplayerStartCommand = sessionContract.sessionType === RUNTIME_SESSION_TYPES.MULTIPLAYER
                && options?.source === MATCH_START_COMMAND_SOURCE;
            facade?._recordMenuTelemetry?.('start_attempt', telemetryPayload);
            const validationIssue = isReceivedMultiplayerStartCommand
                ? null
                : facade?._resolveStartValidationIssue?.();
            if (validationIssue) {
                facade?.game?.uiManager?.showStartValidationError?.(validationIssue, { focusField: true });
                this._recordBlockedStart(telemetryPayload, 'start_validation_failed', {
                    fieldKey: validationIssue.fieldKey,
                });
                facade?.game?._showStatusToast?.(validationIssue.message, 1700, 'error');
                return false;
            }

            facade?.prepareArcadeMatchStartRuntime?.();
            facade?.getUiManager?.()?.clearStartValidationError?.();
            blurFocusedTextInput(globalThis?.document);
            if (sessionContract.sessionType === RUNTIME_SESSION_TYPES.MULTIPLAYER && !isReceivedMultiplayerStartCommand) {
                return requestRuntimeMultiplayerMatchStart({
                    game: facade?.game,
                    menuMultiplayerBridge: facade?.menuMultiplayerBridge,
                    captureSettingsSnapshot: () => facade?._captureMultiplayerMatchSettings?.(),
                    recordMenuTelemetry: (eventType, payload) => facade?._recordMenuTelemetry?.(eventType, payload),
                });
            }
            const startResult = this._matchStartRuntime.executeSafely();
            if (startResult === undefined || startResult === null) {
                facade?.game?._showStatusToast?.('Start nicht moeglich: Match-Controller nicht verfuegbar.', 2000, 'error');
                return false;
            }
            if (typeof startResult.then === 'function') {
                return Promise.resolve(startResult).then((resolvedResult) => resolvedResult !== false);
            }
            return startResult !== false;
        };
        return this._awaitPendingFinalizeForStart(buildTelemetryPayload(), runStartAttempt);
    }

    startMatch(options = undefined) {
        if (this._pendingStartMatch) {
            if (options?.source === MATCH_START_COMMAND_SOURCE) {
                const pendingStartMatch = this._pendingStartMatch;
                return Promise.resolve(pendingStartMatch).then(() => this.startMatch(options));
            }
            return this._pendingStartMatch;
        }
        const deferred = createDeferred();
        this._pendingStartMatch = deferred.promise;
        const clearPending = () => {
            if (this._pendingStartMatch === deferred.promise) {
                this._pendingStartMatch = null;
            }
        };
        try {
            Promise.resolve(this._startMatchAfterGuards(options))
                .then((resolvedResult) => {
                    clearPending();
                    deferred.resolve(resolvedResult);
                })
                .catch((error) => {
                    clearPending();
                    deferred.reject(error);
                });
        } catch (error) {
            clearPending();
            deferred.reject(error);
        }
        return deferred.promise;
    }

    pauseMatch() {
        const facade = this._facade;
        if (this.isNetworkSession() && !this.isHost()) {
            facade?.ports?.matchUiPort?.applyDisconnectConfirmationProjection?.();
            return false;
        }
        facade?.ports?.matchUiPort?.applyPauseMatchProjection?.();
        return true;
    }

    resumeMatch(options = undefined) {
        if (!this._canExecutePauseIntent(
            PAUSE_OVERLAY_INTENT_TYPES.RESUME_MATCH,
            options?.pauseLease || null
        )) {
            return false;
        }
        this._getPorts()?.matchUiPort?.applyResumeMatchProjection?.(options);
        return true;
    }

    restartRound() {
        const sectorTransition = this._facade?.consumePendingArcadeSectorTransition?.() || null;
        if (sectorTransition?.requiresSessionRebuild === true) {
            return this.startMatch({
                source: 'arcade_sector_transition',
                arcadeSectorTransition: sectorTransition,
            });
        }
        this._facade?.ports?.matchUiPort?.startRound?.();
        return true;
    }

    returnToMenu(options = {}) {
        if (options?.pauseLease && !this._canExecutePauseIntent(
            PAUSE_OVERLAY_INTENT_TYPES.RETURN_TO_MENU,
            options.pauseLease
        )) {
            return false;
        }
        this._matchStartRuntime.cancel();
        this._facade?.settingsHandler?.restoreMapScenarioBotCount?.();
        // Order matters: the scenario bot count goes back first, so this restore compares
        // against the value the quickstart preset wrote and may hand the player value back.
        this._facade?.settingsHandler?.restoreSessionSettings?.();
        return this._facade?.finalizeMatch?.({
            ...options,
            reason: options?.reason || SESSION_FINALIZE_TRIGGERS.RETURN_TO_MENU,
            notifyMenuOpened: true,
            applyReturnToMenuUi: true,
            schedulePrewarm: true,
        }, SESSION_FINALIZE_TRIGGERS.RETURN_TO_MENU);
    }

    syncP2HudVisibility() {
        const game = this._facade?.game;
        game?.ui?.p2Hud?.classList?.toggle('hidden', game.numHumans !== 2);
    }

    _disposeMenuRefs() {
        const facade = this._facade;
        this._matchStartRuntime.cancel();
        facade?.game?.menuController?.dispose?.();
        facade?.game?.menuMultiplayerBridge?.dispose?.();
        if (facade?.game) {
            facade.game.menuController = null;
            facade.game.menuMultiplayerBridge = null;
        }
    }

    _isDisposeFinalizeTerminal(sessionSnapshot = null) {
        const lifecycleState = String(sessionSnapshot?.lifecycleState || '').trim();
        const finalizeState = String(sessionSnapshot?.finalizeState || '').trim();
        return lifecycleState === 'disposed' || TERMINAL_DISPOSE_FINALIZE_STATES.has(finalizeState);
    }

    dispose() {
        if (this._pendingDispose) {
            return this._pendingDispose;
        }
        this._matchStartRuntime.cancel();
        const facade = this._facade;
        facade?._clearMatchPrewarmTimer?.();
        const trackedDispose = (async () => {
            let finalizeResult = false;
            try {
                if (typeof facade?.finalizeMatch !== 'function') {
                    return false;
                }
                finalizeResult = await facade.finalizeMatch({
                    reason: SESSION_FINALIZE_TRIGGERS.GAME_DISPOSE,
                    notifyMenuOpened: false,
                    applyReturnToMenuUi: false,
                    schedulePrewarm: false,
                });
            } catch (error) {
                this._logger?.error?.('dispose finalize failed:', error);
                finalizeResult = false;
            }
            const sessionSnapshot = this._getSessionRuntimeSnapshot();
            if (sessionSnapshot && !this._isDisposeFinalizeTerminal(sessionSnapshot)) {
                this._logger?.warn?.('dispose settled without terminal runtime state', {
                    lifecycleState: sessionSnapshot.lifecycleState || '',
                    finalizeState: sessionSnapshot.finalizeState || '',
                    finalizeErrorMessage: sessionSnapshot.finalizeErrorMessage || '',
                });
            }
            this._disposeMenuRefs();
            return finalizeResult !== false;
        })()
            .finally(() => {
                if (this._pendingDispose === trackedDispose) {
                    this._pendingDispose = null;
                }
            });
        this._pendingDispose = trackedDispose;
        return trackedDispose;
    }
}

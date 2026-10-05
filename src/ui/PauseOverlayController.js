import {
    derivePauseTransition,
    deriveResumeTransition,
} from '../shared/contracts/MatchFlowTransitionContract.js';
import { createPauseOverlayControllerPort } from '../shared/runtime/UiControllerRuntimePorts.js';
import { armConfirmButton } from './ConfirmButtonArming.js';
import {
    applyResumeProjectionIntent,
    isPauseOverlayActive,
    resumeFromPauseIntent,
    returnToMenuFromPauseIntent,
} from './PauseOverlayIntentActions.js';

export class PauseOverlayController {
    constructor(deps = {}) {
        this.matchFlowUiController = deps.matchFlowUiController;
        this.runtime = deps.runtime || deps.game || this.matchFlowUiController?.game || null;
        this.runtimePort = deps.runtimePort || createPauseOverlayControllerPort(deps.ports || null);
        this._listenersInitialized = false;
        this._hostPausedOverlay = null;
        this._managedListeners = [];
        this._boundHandlers = null;
        this._menuConfirmation = null;
    }

    get game() {
        return this.runtime;
    }

    _getMatchFlowSnapshot() {
        return this.runtimePort?.getMatchFlowSnapshot?.() || null;
    }

    _getSessionRuntimeSnapshot() {
        return this.runtimePort?.getSessionRuntimeSnapshot?.() || null;
    }

    _isPauseActive() {
        return isPauseOverlayActive(this._getMatchFlowSnapshot(), this.game?.state);
    }

    _isHost() {
        return this._getSessionRuntimeSnapshot()?.isHost !== false;
    }

    _addManagedListener(target, type, handler) {
        if (!target || typeof target.addEventListener !== 'function' || typeof handler !== 'function') {
            return;
        }
        target.addEventListener(type, handler);
        this._managedListeners.push({ target, type, handler });
    }

    _removeManagedListeners() {
        for (const listener of this._managedListeners) {
            listener.target?.removeEventListener?.(listener.type, listener.handler);
        }
        this._managedListeners.length = 0;
    }

    setupListeners() {
        if (this._listenersInitialized) {
            return;
        }

        const game = this.game;
        if (!game?.ui) return;

        this._listenersInitialized = true;
        if (!this._boundHandlers) {
            this._boundHandlers = {
                onPauseResumeClick: () => {
                    this.resumeFromPause();
                },
                onPauseSettingsClick: () => {
                    if (this._isPauseActive()) {
                        this._showSettings();
                    }
                },
            };
        }

        this._addManagedListener(game.ui.pauseResumeButton, 'click', this._boundHandlers.onPauseResumeClick);
        this._addManagedListener(game.ui.pauseSettingsButton, 'click', this._boundHandlers.onPauseSettingsClick);
        // Leaving ends the running match: same two-step button as the other destructive actions.
        if (typeof game.ui.pauseMenuButton?.addEventListener === 'function') {
            this._menuConfirmation = armConfirmButton(game.ui.pauseMenuButton, {
                confirmLabel: 'Erneut klicken: Match verlassen',
                onConfirm: () => this.returnToMenuFromPause(),
            });
        }
    }

    pause() {
        if (this.runtimePort?.pauseMatch) {
            return this.runtimePort.pauseMatch();
        }
        return this.applyPauseProjection();
    }

    applyPauseProjection() {
        const controller = this.matchFlowUiController;
        const pauseTransition = derivePauseTransition();
        this._restorePauseButtonLabels();
        controller.applyLifecycleTransition(pauseTransition);
        controller.applyMatchUiState(pauseTransition.uiState);
        this.runtimePort?.clearJustPressed?.();
        this._hideSettings();
        return true;
    }

    /**
     * Shows a "Host hat pausiert" overlay for network clients.
     * Called when a host-pause event is received from the session.
     */
    showHostPausedOverlay() {
        if (this._isHost()) return;
        const controller = this.matchFlowUiController;
        const pauseTransition = derivePauseTransition();
        controller.applyLifecycleTransition(pauseTransition);
        controller.applyMatchUiState(pauseTransition.uiState);

        if (!this._hostPausedOverlay) {
            this._hostPausedOverlay = document.createElement('div');
            this._hostPausedOverlay.className = 'host-paused-overlay';
            this._hostPausedOverlay.textContent = 'Host hat pausiert';
        }
        const overlay = this.game?.ui?.pauseOverlay;
        if (overlay && !overlay.contains(this._hostPausedOverlay)) {
            overlay.appendChild(this._hostPausedOverlay);
        }
    }

    /**
     * Hides the "Host hat pausiert" overlay.
     */
    hideHostPausedOverlay() {
        this._hostPausedOverlay?.remove?.();
    }

    /**
     * ESC on a network client: show disconnect confirmation instead of pause.
     */
    applyDisconnectConfirmationProjection() {
        const game = this.game;
        if (!game?.ui?.pauseOverlay) return;
        const pauseTransition = derivePauseTransition();
        this.matchFlowUiController.applyLifecycleTransition(pauseTransition);
        this.matchFlowUiController.applyMatchUiState(pauseTransition.uiState);

        // Replace pause overlay content with disconnect prompt
        this._menuConfirmation?.disarm();
        if (game.ui.pauseMenuButton) {
            game.ui.pauseMenuButton.textContent = 'Verbindung trennen';
        }
        if (game.ui.pauseResumeButton) {
            game.ui.pauseResumeButton.textContent = 'Weiter spielen';
        }
        this._hideSettings();
        return true;
    }

    showDisconnectConfirmation() {
        return this.applyDisconnectConfirmationProjection();
    }

    createResumeTransition() {
        return deriveResumeTransition();
    }

    resumeFromPause() {
        return resumeFromPauseIntent(this);
    }

    applyResumeProjection(options = undefined) {
        return applyResumeProjectionIntent(this, options);
    }

    returnToMenuFromPause() {
        return returnToMenuFromPauseIntent(this);
    }

    _restorePauseButtonLabels() {
        this._menuConfirmation?.disarm();
        const game = this.game;
        if (game?.ui?.pauseMenuButton) {
            game.ui.pauseMenuButton.textContent = 'Hauptmenü';
        }
        if (game?.ui?.pauseResumeButton) {
            game.ui.pauseResumeButton.textContent = 'Weiterspielen';
        }
    }

    // The pause opens the menu's own settings window, limited to the tabs that fit mid-match.
    _showSettings() {
        return this.game?.uiManager?.openPauseSettings?.() === true;
    }

    // Escape backs out of the pause settings first; only the next Escape resumes the match.
    closeSettingsIfOpen() {
        return this.game?.uiManager?.closePauseSettings?.() === true;
    }

    _hideSettings() {
        const game = this.game;
        if (game) {
            game.keyCapture = null;
        }
        this.closeSettingsIfOpen();
    }

    dispose() {
        this._removeManagedListeners();
        this._menuConfirmation?.dispose();
        this._menuConfirmation = null;
        this._listenersInitialized = false;
        this._hideSettings();
        this.hideHostPausedOverlay();
    }
}

import {
    derivePauseTransition,
    deriveResumeTransition,
} from './MatchFlowLifecycleTransitions.js';
import { createPauseOverlayControllerPort } from '../shared/runtime/UiControllerRuntimePorts.js';
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
                onPauseSettingsBackClick: () => {
                    if (this._isPauseActive()) {
                        this._hideSettings();
                    }
                },
                onPauseMenuClick: () => {
                    this.returnToMenuFromPause();
                },
                onPauseKeybindP1Click: (event) => this._handleKeybindClick(event, 'PLAYER_1'),
                onPauseKeybindP2Click: (event) => this._handleKeybindClick(event, 'PLAYER_2'),
                onAutoRollChange: () => {
                    if (!this._isPauseActive()) return;
                    const checked = !!game.ui.pauseAutoRollToggle?.checked;
                    this.runtimePort?.applyAutoRoll?.(checked);
                },
                onInvertP1Change: () => {
                    if (!this._isPauseActive()) return;
                    const checked = !!game.ui.pauseInvertP1?.checked;
                    this._applyInvertPitch(0, 'PLAYER_1', checked);
                },
                onInvertP2Change: () => {
                    if (!this._isPauseActive()) return;
                    const checked = !!game.ui.pauseInvertP2?.checked;
                    this._applyInvertPitch(1, 'PLAYER_2', checked);
                },
            };
        }

        this._addManagedListener(game.ui.pauseResumeButton, 'click', this._boundHandlers.onPauseResumeClick);
        this._addManagedListener(game.ui.pauseSettingsButton, 'click', this._boundHandlers.onPauseSettingsClick);
        this._addManagedListener(game.ui.pauseSettingsBackButton, 'click', this._boundHandlers.onPauseSettingsBackClick);
        this._addManagedListener(game.ui.pauseMenuButton, 'click', this._boundHandlers.onPauseMenuClick);
        this._addManagedListener(game.ui.pauseKeybindP1, 'click', this._boundHandlers.onPauseKeybindP1Click);
        this._addManagedListener(game.ui.pauseKeybindP2, 'click', this._boundHandlers.onPauseKeybindP2Click);
        this._addManagedListener(game.ui.pauseAutoRollToggle, 'change', this._boundHandlers.onAutoRollChange);
        this._addManagedListener(game.ui.pauseInvertP1, 'change', this._boundHandlers.onInvertP1Change);
        this._addManagedListener(game.ui.pauseInvertP2, 'change', this._boundHandlers.onInvertP2Change);
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
        const game = this.game;
        if (game?.ui?.pauseMenuButton) {
            game.ui.pauseMenuButton.textContent = 'Hauptmenue';
        }
        if (game?.ui?.pauseResumeButton) {
            game.ui.pauseResumeButton.textContent = 'Weiterspielen';
        }
    }

    _handleKeybindClick(event, playerKey) {
        if (!this._isPauseActive()) return;
        const button = event?.target?.closest?.('button.keybind-btn');
        if (!button) return;
        this.runtimePort?.startKeyCapture?.(playerKey, button.dataset.action);
    }

    _applyInvertPitch(playerIndex, playerKey, checked) {
        const game = this.game;
        if (this.runtimePort?.dispatchAction) {
            this.runtimePort.dispatchAction({
                type: 'settings.invertPitch',
                payload: { playerIndex, playerKey, value: checked },
            });
        } else {
            game.settings.invertPitch[playerKey] = checked;
            const players = game.entityManager?.players;
            if (players) {
                const human = players.find((player) => !player.isBot && player.index === playerIndex);
                human?.setControlOptions?.({ invertPitch: checked });
            }
        }
    }

    _syncSettingsToggles() {
        const game = this.game;
        if (game.ui.pauseAutoRollToggle) {
            game.ui.pauseAutoRollToggle.checked = !!game.settings.autoRoll;
        }
        if (game.ui.pauseInvertP1) {
            game.ui.pauseInvertP1.checked = !!game.settings.invertPitch?.PLAYER_1;
        }
        if (game.ui.pauseInvertP2) {
            game.ui.pauseInvertP2.checked = !!game.settings.invertPitch?.PLAYER_2;
        }
    }

    _showSettings() {
        const game = this.game;
        this._syncSettingsToggles();
        game.keybindEditorController?.renderPauseEditor?.();
        if (game.ui.pauseSettingsPanel) {
            game.ui.pauseSettingsPanel.classList.remove('hidden');
        }
        if (game.ui.pauseSettingsButton) {
            game.ui.pauseSettingsButton.classList.add('hidden');
        }
    }

    _hideSettings() {
        const game = this.game;
        if (game) {
            game.keyCapture = null;
        }
        if (!game?.ui) {
            return;
        }
        if (game.ui.pauseSettingsPanel) {
            game.ui.pauseSettingsPanel.classList.add('hidden');
        }
        if (game.ui.pauseSettingsButton) {
            game.ui.pauseSettingsButton.classList.remove('hidden');
        }
    }

    dispose() {
        this._removeManagedListeners();
        this._listenersInitialized = false;
        this._hideSettings();
        this.hideHostPausedOverlay();
    }
}

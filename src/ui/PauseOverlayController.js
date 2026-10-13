import {
    derivePauseTransition,
    deriveResumeTransition,
} from '../shared/contracts/MatchFlowTransitionContract.js';
import { resolveMenuVisibility } from '../shared/contracts/MenuVisibilityContract.js';
import { createPauseOverlayControllerPort } from '../shared/runtime/UiControllerRuntimePorts.js';
import { armConfirmButton } from './ConfirmButtonArming.js';
import { applyMenuVisibility } from './menu/MenuVisibilityApplier.js';
import { renderPauseControls } from './PauseControlsPanel.js';
import { movePauseFocus } from './PauseOverlayFocus.js';
import {
    PAUSE_LABELS,
    decideGamepadDisconnectPause,
    resolveMenuReturnTarget,
    resolvePauseControlRows,
    resolvePauseLobbyRole,
} from './PauseMenuText.js';
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
        this._restartConfirmation = null;
        this._pendingPauseNotice = '';
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

    _getSessionType() {
        return String(this.game?.settings?.localSettings?.sessionType || 'single').trim().toLowerCase();
    }

    _getWindow() {
        return this.game?.ui?.pauseOverlay?.ownerDocument?.defaultView || null;
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
                onPauseControlsClick: () => this._toggleControls(),
                // Arrow up and down move through the buttons like the D-pad; Tab keeps working.
                onPauseKeyDown: (event) => {
                    const step = event?.key === 'ArrowDown' ? 1 : (event?.key === 'ArrowUp' ? -1 : 0);
                    if (step === 0 || event.defaultPrevented || !this._isPauseActive()) return;
                    event.preventDefault?.();
                    movePauseFocus(this.game.ui.pauseOverlay, step);
                },
                onGamepadDisconnected: (event) => {
                    this._handleGamepadDisconnected(event);
                },
            };
        }

        this._addManagedListener(game.ui.pauseResumeButton, 'click', this._boundHandlers.onPauseResumeClick);
        this._addManagedListener(game.ui.pauseSettingsButton, 'click', this._boundHandlers.onPauseSettingsClick);
        this._addManagedListener(game.ui.pauseControlsButton, 'click', this._boundHandlers.onPauseControlsClick);
        this._addManagedListener(game.ui.pauseOverlay, 'keydown', this._boundHandlers.onPauseKeyDown);
        this._addManagedListener(this._getWindow(), 'gamepaddisconnected', this._boundHandlers.onGamepadDisconnected);
        // Leaving ends the running match: same two-step button as the other destructive actions.
        if (typeof game.ui.pauseMenuButton?.addEventListener === 'function') {
            this._menuConfirmation = armConfirmButton(game.ui.pauseMenuButton, {
                confirmLabel: PAUSE_LABELS.leaveConfirm,
                onConfirm: () => this.returnToMenuFromPause(),
            });
        }
        // So does a restart: it throws away the running round.
        if (typeof game.ui.pauseRestartButton?.addEventListener === 'function') {
            this._restartConfirmation = armConfirmButton(game.ui.pauseRestartButton, {
                confirmLabel: PAUSE_LABELS.restartConfirm,
                onConfirm: () => this.restartFromPause(),
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
        this._toggleControls(false);
        this._applyPauseNotice(this._pendingPauseNotice);
        this._syncPauseVisibility();
        controller.applyLifecycleTransition(pauseTransition);
        controller.applyMatchUiState(pauseTransition.uiState);
        this.runtimePort?.clearJustPressed?.();
        this._hideSettings();
        return true;
    }

    /**
     * W2: a pad of a local player drops out while the match runs, so the match pauses with a notice.
     * Network play never reaches this: the decision returns no pause for it.
     */
    _handleGamepadDisconnected(event) {
        const decision = decideGamepadDisconnectPause({
            settings: this.game?.settings,
            padIndex: event?.gamepad?.index,
            gameState: this.game?.state,
        });
        if (!decision.pause) return false;
        this._pendingPauseNotice = decision.notice;
        try {
            return this.pause() !== false;
        } finally {
            this._pendingPauseNotice = '';
        }
    }

    /** "Steuerung anzeigen" folds the key overview of the local players open and closed. */
    _toggleControls(open = undefined) {
        const ui = this.game?.ui;
        const button = ui?.pauseControlsButton;
        const panel = ui?.pauseControlsPanel;
        if (!button || !panel) return;
        const expand = open ?? button.getAttribute('aria-expanded') !== 'true';
        if (expand) renderPauseControls(panel, resolvePauseControlRows(this.game?.settings));
        panel.hidden = !expand;
        button.setAttribute('aria-expanded', String(expand));
        button.textContent = expand ? PAUSE_LABELS.controlsHide : PAUSE_LABELS.controlsShow;
    }

    _applyPauseNotice(text) {
        const notice = this.game?.ui?.pauseNotice;
        if (!notice) return;
        notice.textContent = text;
        notice.hidden = !text;
    }

    _resolvePauseVisibility() {
        const sessionType = this._getSessionType();
        return resolveMenuVisibility({
            sessionType,
            lobbyRole: resolvePauseLobbyRole(sessionType, this._getSessionRuntimeSnapshot()),
        });
    }

    /** Restart is for everyone but a network guest (MenuVisibilityContract key pauseRestart). */
    _syncPauseVisibility() {
        const overlay = this.game?.ui?.pauseOverlay;
        if (typeof overlay?.querySelectorAll !== 'function') return;
        applyMenuVisibility(overlay, this._resolvePauseVisibility());
    }

    _applyLeaveHint() {
        const hint = this.game?.ui?.pauseMenuHint;
        if (hint) hint.textContent = resolveMenuReturnTarget({ sessionType: this._getSessionType() }).pauseHint;
    }

    restartFromPause() {
        const visible = /** @type {Record<string, boolean>} */ (this._resolvePauseVisibility().visible);
        if (!this._isPauseActive() || visible.pauseRestart !== true) return false;
        if (typeof this.runtimePort?.startMatch !== 'function') return false;
        this._hideSettings();
        return this.runtimePort.startMatch({ source: 'pause_restart' });
    }

    /**
     * Shows a "Gastgeber hat pausiert" notice for network clients.
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
            this._hostPausedOverlay.setAttribute?.('role', 'status');
            this._hostPausedOverlay.textContent = PAUSE_LABELS.hostPaused;
        }
        const overlay = this.game?.ui?.pauseOverlay;
        const host = overlay?.querySelector?.('.menu-q-pause__card') || overlay;
        if (host && !host.contains(this._hostPausedOverlay)) {
            host.appendChild(this._hostPausedOverlay);
        }
    }

    /**
     * Hides the "Gastgeber hat pausiert" notice.
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
        this._restartConfirmation?.disarm();
        if (game.ui.pauseMenuButton) {
            game.ui.pauseMenuButton.textContent = PAUSE_LABELS.disconnect;
        }
        if (game.ui.pauseResumeButton) {
            game.ui.pauseResumeButton.textContent = PAUSE_LABELS.resume;
        }
        this._toggleControls(false);
        this._applyPauseNotice('');
        this._applyLeaveHint();
        this._syncPauseVisibility();
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
        this._restartConfirmation?.disarm();
        const game = this.game;
        if (game?.ui?.pauseMenuButton) {
            game.ui.pauseMenuButton.textContent = PAUSE_LABELS.leave;
        }
        if (game?.ui?.pauseResumeButton) {
            game.ui.pauseResumeButton.textContent = PAUSE_LABELS.resume;
        }
        this._applyLeaveHint();
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
        this._restartConfirmation?.dispose();
        this._restartConfirmation = null;
        this._listenersInitialized = false;
        this._hideSettings();
        this.hideHostPausedOverlay();
    }
}

// Continue prompt below the result board (P7c).
//
// It answers one question for the player: what can I do now? Two native buttons (continue / menu),
// the key hints that do the same thing, and the input lock drawn as a fill bar. The bar is one CSS
// custom property (`--progress`) that style.css turns into a gradient, so a running lock costs
// exactly one DOM write per frame and no layout work of our own.
//
// Everything else is written only when it actually changed - the board is redrawn every frame.
//
// Hooks for the desktop tests: `data-postmatch-action` on the buttons, `data-postmatch-hint` on the
// hints and the wait notice.

import { GAMEPAD_BUTTON_LABELS, normalizeGamepadControls } from '../../shared/contracts/GamepadControlsContract.js';
import {
    CONTINUE_PROMPT_PHASES,
    normalizeContinuePromptState,
    resolveContinuePromptProgress,
} from '../../shared/contracts/MatchUiStateContract.js';

const GAMEPAD_SLOT_COUNT = 4;

const CONTINUE_LABELS = {
    [CONTINUE_PROMPT_PHASES.ROUND_END]: 'Weiter',
    [CONTINUE_PROMPT_PHASES.MATCH_END]: 'Neues Match',
};

/**
 * Hint for the reserved menu button of the first connected pad. Empty while no pad is connected,
 * so a keyboard player never reads about a controller.
 * @param {ArrayLike<unknown> | null | undefined} pads
 * @param {Record<string, unknown> | null | undefined} controls
 * @returns {string}
 */
export function resolveGamepadPauseHintText(pads, controls) {
    for (let slot = 0; slot < GAMEPAD_SLOT_COUNT; slot++) {
        if (!pads?.[slot]) continue;
        const button = normalizeGamepadControls(controls?.[`GAMEPAD_${slot + 1}`]).PAUSE;
        return `(Pause-Knopf: ${GAMEPAD_BUTTON_LABELS[button] || `Knopf ${button + 1}`})`;
    }
    return '';
}

function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function setHidden(element, hidden) {
    if (hidden) element.classList.add('hidden');
    else element.classList.remove('hidden');
}

function createHint(name, keyLabel) {
    const hint = createElement('span', 'message-actions-hint');
    hint.setAttribute('data-postmatch-hint', name);
    hint.appendChild(createElement('kbd', 'message-actions-key', keyLabel));
    return hint;
}

export class PostMatchContinuePrompt {
    constructor(options = {}) {
        this.container = options.container || null;
        this._onMenu = typeof options.onMenu === 'function' ? options.onMenu : () => {};
        this._readGamepads = typeof options.getGamepads === 'function'
            ? options.getGamepads
            : () => globalThis.navigator?.getGamepads?.() || null;
        this._readControls = typeof options.getControls === 'function' ? options.getControls : () => null;
        this._state = normalizeContinuePromptState(null);
        // Memo of what the DOM already shows, so an unchanged frame writes nothing.
        this._shown = { hidden: null, phase: '', canContinue: null, waiting: null, progress: null, padHint: null };
        this._handleMenuClick = () => this._onMenu();
        this._build();
    }

    _build() {
        if (!this.container) return;
        const buttons = createElement('div', 'message-actions-buttons');
        this.continueButton = createElement('button', 'start-btn message-actions-btn message-actions-continue');
        this.continueButton.setAttribute('type', 'button');
        this.continueButton.setAttribute('data-postmatch-action', 'continue');
        // No click handler: ContinueIntentOps reads a press on this button as the continue intent,
        // so mouse and keys share the round state tick (lock, arcade sector advance, replica veto).
        this.menuButton = createElement('button', 'secondary-btn message-actions-btn', 'Menü');
        this.menuButton.setAttribute('type', 'button');
        this.menuButton.setAttribute('data-postmatch-action', 'menu');
        this.menuButton.addEventListener('click', this._handleMenuClick);
        buttons.appendChild(this.continueButton);
        buttons.appendChild(this.menuButton);

        const hints = createElement('p', 'message-actions-hints');
        this.continueHint = createHint('continue', 'Beliebige Taste');
        this.continueHintLabel = createElement('span', 'message-actions-hint-label');
        this.continueHint.appendChild(this.continueHintLabel);
        const menuHint = createHint('menu', 'Esc');
        menuHint.appendChild(createElement('span', 'message-actions-hint-label', ' – Menü'));
        this.gamepadHint = createElement('span', 'message-actions-hint');
        this.gamepadHint.setAttribute('data-postmatch-hint', 'gamepad');
        hints.appendChild(this.continueHint);
        hints.appendChild(menuHint);
        hints.appendChild(this.gamepadHint);

        this.hostNotice = createElement('p', 'message-actions-wait', 'Warte auf den Gastgeber');
        this.hostNotice.setAttribute('data-postmatch-hint', 'host');

        this.container.appendChild(buttons);
        this.container.appendChild(hints);
        this.container.appendChild(this.hostNotice);
    }

    /** Continue and its hint belong to the host; a replica reads the wait notice instead. */
    _applyWaitingForHost(waiting) {
        if (this._shown.waiting === waiting) return;
        this._shown.waiting = waiting;
        setHidden(this.continueButton, waiting);
        setHidden(this.continueHint, waiting);
        setHidden(this.hostNotice, !waiting);
    }

    _applyPhase(phase) {
        if (this._shown.phase === phase) return;
        this._shown.phase = phase;
        const label = CONTINUE_LABELS[phase] || CONTINUE_LABELS[CONTINUE_PROMPT_PHASES.ROUND_END];
        this.continueButton.textContent = label;
        this.continueHintLabel.textContent = ` – ${label}`;
    }

    /** The native disabled button already blocks clicks and focus; aria-disabled says why out loud. */
    _applyCanContinue(canContinue) {
        if (this._shown.canContinue === canContinue) return;
        this._shown.canContinue = canContinue;
        this.continueButton.disabled = !canContinue;
        this.continueButton.setAttribute('aria-disabled', canContinue ? 'false' : 'true');
    }

    _applyProgress(state) {
        const progress = String(Math.round(resolveContinuePromptProgress(state) * 100) / 100);
        if (this._shown.progress === progress) return;
        this._shown.progress = progress;
        this.continueButton.style.setProperty('--progress', progress);
    }

    _applyGamepadHint() {
        const text = resolveGamepadPauseHintText(this._readGamepads(), this._readControls());
        if (this._shown.padHint === text) return;
        const wasHidden = this._shown.padHint === '';
        this._shown.padHint = text;
        this.gamepadHint.textContent = text;
        if (wasHidden !== (text === '')) setHidden(this.gamepadHint, text === '');
    }

    /**
     * @param {Partial<import('../../shared/contracts/MatchUiStateContract.js').ContinuePromptUiState>|null} source
     */
    apply(source) {
        const state = normalizeContinuePromptState(source);
        this._state = state;
        if (!this.container) return state;
        if (this._shown.hidden !== !state.visible) {
            this._shown.hidden = !state.visible;
            setHidden(this.container, !state.visible);
        }
        if (!state.visible) return state;
        this._applyWaitingForHost(state.waitingForHost);
        this._applyPhase(state.phase);
        this._applyCanContinue(state.canContinue);
        this._applyProgress(state);
        this._applyGamepadHint();
        return state;
    }

    dispose() {
        this.menuButton?.removeEventListener('click', this._handleMenuClick);
        this.container?.replaceChildren();
    }
}

/**
 * Only the menu button needs the runtime port; continue travels as an input intent.
 */
export function createPostMatchContinuePrompt({ container, runtimePort, getControls }) {
    return new PostMatchContinuePrompt({
        container,
        getControls,
        onMenu: () => runtimePort?.returnToMenu?.({ reason: 'post_match_menu_button' }),
    });
}

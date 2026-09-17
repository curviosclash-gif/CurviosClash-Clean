// ============================================
// ContinueIntentOps.js - the "Continue" input intent (any key means continue)
// ============================================
//
// Round-end and match-end boards are dismissed with any key, click or pad button.
// Two exceptions stay reserved for the menu path and must never mean "continue":
// Escape on the keyboard and the bound PAUSE button on every gamepad.
// The helpers here are pure so the rules can be tested without a browser.

/** Key name for `wasPressed(...)`, so kernel and live game share one interface. */
export const CONTINUE_INTENT_KEY = 'Continue';

export const GAMEPAD_CONTINUE_SLOT_COUNT = 4;
export const GAMEPAD_CONTINUE_BUTTON_COUNT = 16;

// Modifiers alone are never a decision: holding Shift before a real key would
// otherwise skip the board on its own.
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock']);
const MODIFIER_CODES = new Set([
    'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
    'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
    'OSLeft', 'OSRight', 'CapsLock',
]);

// Escape is the reserved way back to the menu, on both the key and the code side.
const MENU_KEYS = new Set(['Escape']);

const INTERACTIVE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY', 'OPTION']);

/**
 * True when the element handles Enter or Space itself, so the press belongs to it.
 * Duck-typed on purpose: callers pass DOM elements, tests pass plain objects.
 * @param {{ tagName?: string, isContentEditable?: boolean } | null | undefined} element
 */
export function isInteractiveContinueTarget(element) {
    if (!element || typeof element !== 'object') return false;
    if (element.isContentEditable === true) return true;
    const tagName = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
    return INTERACTIVE_TAGS.has(tagName);
}

/**
 * @param {{ code?: string, key?: string, repeat?: boolean, targetIsInteractive?: boolean }} [event]
 * @returns {boolean}
 */
export function isContinueKeyEvent(event) {
    if (!event || typeof event !== 'object') return false;
    if (event.repeat === true) return false;
    if (event.targetIsInteractive === true) return false;
    const code = typeof event.code === 'string' ? event.code : '';
    const key = typeof event.key === 'string' ? event.key : '';
    if (MENU_KEYS.has(code) || MENU_KEYS.has(key)) return false;
    if (MODIFIER_CODES.has(code) || MODIFIER_KEYS.has(key)) return false;
    return code.length > 0 || key.length > 0;
}

/**
 * @param {{ button?: number, targetIsInteractive?: boolean }} [event]
 * @returns {boolean}
 */
export function isContinueMouseEvent(event) {
    if (!event || typeof event !== 'object') return false;
    if (event.targetIsInteractive === true) return false;
    return event.button === undefined || event.button === 0;
}

/** Edge memory for four pads with sixteen buttons each; reused, never reallocated. */
export function createGamepadContinueState() {
    return new Uint8Array(GAMEPAD_CONTINUE_SLOT_COUNT * GAMEPAD_CONTINUE_BUTTON_COUNT);
}

/**
 * Takes over the current hold state without reporting an edge. Used after a
 * rebinding, a focus loss or an explicit clear, so a button that was already
 * held down does not count as a fresh press afterwards.
 * @param {ArrayLike<{ buttons?: ArrayLike<{ pressed?: boolean }> } | null> | null | undefined} pads
 * @param {Uint8Array} previousState
 */
export function syncGamepadContinueState(pads, previousState) {
    for (let slot = 0; slot < GAMEPAD_CONTINUE_SLOT_COUNT; slot++) {
        const buttons = pads?.[slot]?.buttons;
        const base = slot * GAMEPAD_CONTINUE_BUTTON_COUNT;
        for (let button = 0; button < GAMEPAD_CONTINUE_BUTTON_COUNT; button++) {
            previousState[base + button] = buttons?.[button]?.pressed === true ? 1 : 0;
        }
    }
}

/**
 * Rising edge on any button of any pad, except that pad's bound PAUSE button.
 * Only `buttons[i].pressed` counts, so analogue sticks and triggers below the
 * browser's press threshold stay out - the same definition the gameplay source uses.
 * Allocation free: the caller owns `previousState`.
 * @param {ArrayLike<{ buttons?: ArrayLike<{ pressed?: boolean }> } | null> | null | undefined} pads
 * @param {ArrayLike<number> | null | undefined} pauseBindings
 * @param {Uint8Array} previousState
 * @returns {boolean}
 */
export function collectGamepadContinuePress(pads, pauseBindings, previousState) {
    let pressed = false;
    for (let slot = 0; slot < GAMEPAD_CONTINUE_SLOT_COUNT; slot++) {
        const buttons = pads?.[slot]?.buttons;
        const pauseButton = pauseBindings?.[slot];
        const base = slot * GAMEPAD_CONTINUE_BUTTON_COUNT;
        for (let button = 0; button < GAMEPAD_CONTINUE_BUTTON_COUNT; button++) {
            const index = base + button;
            const held = buttons?.[button]?.pressed === true ? 1 : 0;
            if (held && !previousState[index] && button !== pauseButton) pressed = true;
            previousState[index] = held;
        }
    }
    return pressed;
}

/**
 * Reads gamepad continue presses separately from gameplay polling, exactly like
 * GamepadPauseInput: the board is open, so nobody polls the players any more.
 * The bound PAUSE button comes from that same pause reader, so a rebinding moves
 * the menu reservation along without a second settings path.
 */
export class GamepadContinueInput {
    /** @param {{ enabled?: boolean, bindings?: ArrayLike<number> } | null} [pauseInput] */
    constructor(pauseInput = null) {
        this._pauseInput = pauseInput;
        this.previous = createGamepadContinueState();
    }

    clearInputState() {
        syncGamepadContinueState(globalThis.navigator?.getGamepads?.(), this.previous);
    }

    wasPressed() {
        if (this._pauseInput?.enabled === false) return false;
        if (globalThis.document?.hidden === true || globalThis.document?.hasFocus?.() === false) {
            this.clearInputState();
            return false;
        }
        const pads = globalThis.navigator?.getGamepads?.();
        return collectGamepadContinuePress(pads, this._pauseInput?.bindings, this.previous);
    }
}

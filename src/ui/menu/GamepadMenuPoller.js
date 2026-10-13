// Shared gamepad reader for DOM menus (main menu, hangar window): one rAF loop, edge-triggered
// buttons, optional hold-repeat and left-stick directions. The callers decide what a press means.

export const GAMEPAD_MENU_BUTTONS = Object.freeze({
    A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15,
});

const DIRECTIONS = Object.freeze([
    Object.freeze({ id: 'left', button: GAMEPAD_MENU_BUTTONS.LEFT, axis: 0, sign: -1 }),
    Object.freeze({ id: 'right', button: GAMEPAD_MENU_BUTTONS.RIGHT, axis: 0, sign: 1 }),
    Object.freeze({ id: 'up', button: GAMEPAD_MENU_BUTTONS.UP, axis: 1, sign: -1 }),
    Object.freeze({ id: 'down', button: GAMEPAD_MENU_BUTTONS.DOWN, axis: 1, sign: 1 }),
]);

const callback = (value) => (typeof value === 'function' ? value : null);

function firstConnectedPad(pads) {
    for (let index = 0; index < (pads?.length || 0); index += 1) {
        if (pads[index]) return pads[index];
    }
    return null;
}

function documentLacksFocus() {
    const doc = globalThis.document;
    return doc?.hidden === true || doc?.hasFocus?.() === false;
}

/**
 * @param {{
 *   onDirection?: (direction: 'left'|'right'|'up'|'down') => void,
 *   onConfirm?: () => void, onBack?: () => void, onPreviousTab?: () => void, onNextTab?: () => void, onStart?: () => void,
 *   onX?: () => void, onY?: () => void,
 *   isActive?: () => boolean, isEnabled?: () => boolean,
 *   repeat?: boolean, leftStick?: boolean, requireDocumentFocus?: boolean,
 *   repeatDelayMs?: number, repeatIntervalMs?: number, stickThreshold?: number,
 *   getGamepads?: () => any, requestFrame?: (tick: (time: number) => void) => any, cancelFrame?: (handle: any) => void,
 *   now?: () => number,
 * }} [options]
 */
export function createGamepadMenuPoller(options = {}) {
    const onDirection = callback(options.onDirection);
    const buttonActions = [
        [GAMEPAD_MENU_BUTTONS.A, callback(options.onConfirm)],
        [GAMEPAD_MENU_BUTTONS.B, callback(options.onBack)],
        [GAMEPAD_MENU_BUTTONS.X, callback(options.onX)],
        [GAMEPAD_MENU_BUTTONS.Y, callback(options.onY)],
        [GAMEPAD_MENU_BUTTONS.LB, callback(options.onPreviousTab)],
        [GAMEPAD_MENU_BUTTONS.RB, callback(options.onNextTab)],
        [GAMEPAD_MENU_BUTTONS.START, callback(options.onStart)],
    ].filter(([, action]) => action);
    const isActive = callback(options.isActive) || (() => true);
    const isEnabled = callback(options.isEnabled) || (() => true);
    const repeat = options.repeat !== false;
    const leftStick = options.leftStick !== false;
    const requireDocumentFocus = options.requireDocumentFocus !== false;
    const repeatDelayMs = Number.isFinite(options.repeatDelayMs) ? options.repeatDelayMs : 380;
    const repeatIntervalMs = Number.isFinite(options.repeatIntervalMs) ? options.repeatIntervalMs : 130;
    const stickThreshold = Number.isFinite(options.stickThreshold) ? options.stickThreshold : 0.55;
    const getGamepads = callback(options.getGamepads) || (() => globalThis.navigator?.getGamepads?.());
    const frameHost = () => globalThis.window ?? globalThis;
    const requestFrame = callback(options.requestFrame)
        || ((tick) => (typeof frameHost().requestAnimationFrame === 'function' ? frameHost().requestAnimationFrame(tick) : null));
    const cancelFrame = callback(options.cancelFrame) || ((handle) => frameHost().cancelAnimationFrame?.(handle));
    const now = callback(options.now) || (() => globalThis.performance?.now?.() ?? 0);

    /** Last seen pressed state per button index; a press counts once, on its rising edge. */
    const buttonState = new Map();
    const heldSince = new Map();
    const nextRepeatAt = new Map();
    let frameHandle = null;
    /** Set while the surface is hidden: its first visible frame only records what is held. */
    let needsSeed = false;

    function reset() {
        buttonState.clear();
        heldSince.clear();
        nextRepeatAt.clear();
    }

    function consumePress(pad, index) {
        const isPressed = !!pad.buttons?.[index]?.pressed;
        const wasPressed = !!buttonState.get(index);
        buttonState.set(index, isPressed);
        return isPressed && !wasPressed;
    }

    function isDirectionHeld(pad, direction) {
        const axisValue = leftStick ? Number(pad.axes?.[direction.axis]) * direction.sign : 0;
        return !!buttonState.get(direction.button) || axisValue > stickThreshold;
    }

    /**
     * A blocked frame (no window focus, controller switched off) records what is held instead of
     * forgetting it: a press meant for another window must not fire once this one is back.
     */
    function swallowHeld(pad) {
        reset();
        pad.buttons?.forEach((button, index) => buttonState.set(index, !!button?.pressed));
        for (const direction of DIRECTIONS) {
            if (!isDirectionHeld(pad, direction)) continue;
            heldSince.set(direction.id, Number.NEGATIVE_INFINITY);
            nextRepeatAt.set(direction.id, Number.POSITIVE_INFINITY);
        }
    }

    function pollDirection(pad, direction, time) {
        const buttonPressed = consumePress(pad, direction.button);
        if (!repeat && !leftStick) {
            if (buttonPressed) onDirection?.(direction.id);
            return;
        }
        if (!isDirectionHeld(pad, direction)) {
            heldSince.delete(direction.id);
            return;
        }
        if (!heldSince.has(direction.id)) {
            heldSince.set(direction.id, time);
            nextRepeatAt.set(direction.id, time + repeatDelayMs);
            onDirection?.(direction.id);
            return;
        }
        if (!repeat || time < nextRepeatAt.get(direction.id)) return;
        nextRepeatAt.set(direction.id, time + repeatIntervalMs);
        onDirection?.(direction.id);
    }

    function poll(time = now()) {
        if (!callback(globalThis.navigator?.getGamepads) && !options.getGamepads) return;
        // Skip the hardware poll while the surface is hidden: the loop runs for the whole page
        // lifetime, and a getGamepads() call per frame costs an array allocation.
        if (!isActive()) {
            needsSeed = true;
            return;
        }
        const blocked = !isEnabled() || (requireDocumentFocus && documentLacksFocus());
        const pad = firstConnectedPad(getGamepads());
        if (!pad) {
            reset();
            return;
        }
        // A button still held from the match or from another window is not a fresh press.
        if (blocked || needsSeed) {
            needsSeed = false;
            swallowHeld(pad);
            return;
        }
        for (const direction of DIRECTIONS) pollDirection(pad, direction, time);
        for (const [index, action] of buttonActions) {
            if (consumePress(pad, index)) action();
        }
    }

    function start() {
        if (frameHandle !== null) return;
        const tick = (time) => {
            poll(Number.isFinite(time) ? time : now());
            if (frameHandle !== null) frameHandle = requestFrame(tick);
        };
        frameHandle = requestFrame(tick);
    }

    function stop() {
        if (frameHandle !== null) cancelFrame(frameHandle);
        frameHandle = null;
        reset();
    }

    return Object.freeze({ buttonState, poll, start, stop, reset, isRunning: () => frameHandle !== null });
}

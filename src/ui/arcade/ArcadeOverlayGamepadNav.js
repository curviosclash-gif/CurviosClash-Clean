// Gamepad control for the Arcade choice panels in the message overlay (intermission route, reward
// and confirm, the victory choice, the Five Fronts advantage, the result screens). The menu's
// gamepad poller only answers while the main menu is shown, so these panels get their own poller.
// MatchFlowArcadeOverlayController starts it while a panel is on screen and stops it with the panel.

import { createGamepadMenuPoller, GAMEPAD_MENU_BUTTONS } from '../menu/GamepadMenuPoller.js';
import { getFocusableElements, moveMainMenuFocus } from '../menu/MenuNavigationFocusOps.js';

const ARCADE_OVERLAY_PANEL_ID = 'arcade-overlay-panel';
const ACTION_BUTTONS = Object.freeze([GAMEPAD_MENU_BUTTONS.A, GAMEPAD_MENU_BUTTONS.LB, GAMEPAD_MENU_BUTTONS.RB]);
const STICK_THRESHOLD = 0.6;
const DIRECTIONS = Object.freeze([
    Object.freeze({ id: 'left', button: GAMEPAD_MENU_BUTTONS.LEFT, axis: 0, sign: -1 }),
    Object.freeze({ id: 'right', button: GAMEPAD_MENU_BUTTONS.RIGHT, axis: 0, sign: 1 }),
    Object.freeze({ id: 'up', button: GAMEPAD_MENU_BUTTONS.UP, axis: 1, sign: -1 }),
    Object.freeze({ id: 'down', button: GAMEPAD_MENU_BUTTONS.DOWN, axis: 1, sign: 1 }),
]);

function listArcadeOverlayButtons(panel) {
    return getFocusableElements(panel).filter((element) => String(element.tagName).toUpperCase() === 'BUTTON');
}

/** Same rule as MenuNavigationRuntime._isMenuInteractive: the menu poller answers exactly then. */
function isMainMenuInteractive(doc) {
    const menuRoot = doc.getElementById('main-menu');
    return !!menuRoot && !menuRoot.classList?.contains?.('hidden') && menuRoot.getAttribute?.('aria-hidden') !== 'true';
}

/**
 * The visible Arcade overlay panel with at least one enabled button, otherwise null. Runs every
 * frame, so it only reads the DOM and builds no lists. While the result board's continue prompt
 * (#message-actions) is shown, every pad button already means "continue" there, and while the main
 * menu is interactive the menu poller owns the pad; in both cases the panel stays out of the way.
 */
export function findArcadeOverlayChoicePanel(doc = globalThis.document) {
    const panel = doc?.getElementById?.(ARCADE_OVERLAY_PANEL_ID);
    if (!panel || panel.classList?.contains?.('hidden')) return null;
    const continuePrompt = doc.getElementById('message-actions');
    if (continuePrompt && !continuePrompt.classList?.contains?.('hidden')) return null;
    if (isMainMenuInteractive(doc)) return null;
    return panel.querySelector?.('button:not([disabled])') ? panel : null;
}

function firstConnectedPad(pads) {
    for (let index = 0; index < (pads?.length || 0); index += 1) {
        if (pads[index]) return pads[index];
    }
    return null;
}

function isDirectionHeld(pad, direction) {
    return !!pad?.buttons?.[direction.button]?.pressed || Number(pad?.axes?.[direction.axis]) * direction.sign > STICK_THRESHOLD;
}

/**
 * D-pad, shoulder buttons and the left stick move the focus between the panel's buttons, A presses
 * the focused one. Without a focused button A only focuses the first one, so a stray press never
 * confirms a choice the player has not seen highlighted. A button, D-pad direction or stick push
 * already held when the panel takes the pad (the press that closed the continue prompt, say) does
 * not count as a new press; it counts again only after it was released.
 * @param {{ doc?: Document, getGamepads?: () => any, requestFrame?: (tick: (time: number) => void) => any, cancelFrame?: (handle: any) => void, now?: () => number }} [options]
 */
export function createArcadeOverlayGamepadNav(options = {}) {
    const resolveDoc = () => options.doc || globalThis.document;
    const readPads = options.getGamepads || (() => globalThis.navigator?.getGamepads?.());
    const withPanel = (run) => {
        const panel = findArcadeOverlayChoicePanel(resolveDoc());
        if (panel) run(panel, listArcadeOverlayButtons(panel), panel.ownerDocument?.activeElement);
    };
    const move = (direction) => withPanel((panel, buttons, active) => moveMainMenuFocus(buttons, direction, active));
    let wasActive = false;
    /** Directions held when the panel took the pad; ignored until released. */
    const heldOnEntry = new Set();
    // requireDocumentFocus: false, the same as the main menu poller (MenuNavigationRuntime): the pad
    // has to answer even when the window lacks keyboard focus, e.g. the desktop test window in render
    // mode is shown without focus, and a pad player may have clicked another window.
    const poller = createGamepadMenuPoller({
        ...options,
        repeat: false, leftStick: true, requireDocumentFocus: false, stickThreshold: STICK_THRESHOLD,
        isActive: () => {
            const active = !!findArcadeOverlayChoicePanel(resolveDoc());
            if (active && !wasActive) {
                const pad = firstConnectedPad(readPads());
                for (const index of ACTION_BUTTONS) poller.buttonState.set(index, !!pad?.buttons?.[index]?.pressed);
                heldOnEntry.clear();
                for (const direction of DIRECTIONS) if (isDirectionHeld(pad, direction)) heldOnEntry.add(direction.id);
            } else if (active && heldOnEntry.size > 0) {
                const pad = firstConnectedPad(readPads());
                for (const direction of DIRECTIONS) if (!isDirectionHeld(pad, direction)) heldOnEntry.delete(direction.id);
            }
            wasActive = active;
            return active;
        },
        onDirection: (direction) => {
            if (!heldOnEntry.has(direction)) move(direction);
        },
        onPreviousTab: () => move('left'),
        onNextTab: () => move('right'),
        onConfirm: () => withPanel((panel, buttons, active) => {
            if (buttons.includes(active)) active.click();
            else moveMainMenuFocus(buttons, 'down', active);
        }),
    });
    return Object.freeze({
        poll: (time) => poller.poll(time),
        start: () => poller.start(),
        stop() {
            wasActive = false;
            heldOnEntry.clear();
            poller.stop();
        },
        isRunning: () => poller.isRunning(),
    });
}

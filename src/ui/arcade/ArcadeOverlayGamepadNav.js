// Gamepad control for the Arcade choice panels in the message overlay (intermission route, reward
// and confirm, the victory choice, the Five Fronts advantage, the result screens). The menu's
// gamepad poller only answers while the main menu is shown, so these panels get their own poller.
// MatchFlowArcadeOverlayController starts it while a panel is on screen and stops it with the panel.

import { createGamepadMenuPoller, GAMEPAD_MENU_BUTTONS } from '../menu/GamepadMenuPoller.js';
import { getFocusableElements, moveMainMenuFocus } from '../menu/MenuNavigationFocusOps.js';

const ARCADE_OVERLAY_PANEL_ID = 'arcade-overlay-panel';
const ACTION_BUTTONS = Object.freeze([GAMEPAD_MENU_BUTTONS.A, GAMEPAD_MENU_BUTTONS.LB, GAMEPAD_MENU_BUTTONS.RB]);

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

/**
 * D-pad, shoulder buttons and the left stick move the focus between the panel's buttons, A presses
 * the focused one. Without a focused button A only focuses the first one, so a stray press never
 * confirms a choice the player has not seen highlighted. A button already held when the panel takes
 * the pad (the press that closed the continue prompt, say) does not count as a new press.
 * @param {{ doc?: Document, getGamepads?: () => any, requestFrame?: Function, cancelFrame?: Function, now?: () => number }} [options]
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
    const poller = createGamepadMenuPoller({
        ...options,
        repeat: false, leftStick: true, requireDocumentFocus: false, stickThreshold: 0.6,
        isActive: () => {
            const active = !!findArcadeOverlayChoicePanel(resolveDoc());
            if (active && !wasActive) {
                const pad = firstConnectedPad(readPads());
                for (const index of ACTION_BUTTONS) poller.buttonState.set(index, !!pad?.buttons?.[index]?.pressed);
            }
            wasActive = active;
            return active;
        },
        onDirection: move,
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
            poller.stop();
        },
        isRunning: () => poller.isRunning(),
    });
}

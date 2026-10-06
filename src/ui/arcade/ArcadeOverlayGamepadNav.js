// Gamepad control for the Arcade choice panels in the message overlay (intermission route, reward
// and confirm, the victory choice, the Five Fronts advantage, the result screens). The menu's
// gamepad poll only ran while the main menu was open, so these panels needed mouse or keyboard.
// MenuNavigationRuntime keeps its single poll loop and hands the pad to this module while such a
// panel is on screen.

import { getFocusableElements, moveMainMenuFocus } from '../menu/MenuNavigationFocusOps.js';

const ARCADE_OVERLAY_PANEL_ID = 'arcade-overlay-panel';
const STICK_THRESHOLD = 0.6;
const DIRECTION_BUTTONS = Object.freeze([[12, 'up'], [13, 'down'], [14, 'left'], [15, 'right'], [4, 'left'], [5, 'right']]);
// Read every frame so a press held over the switch back to the menu does not fire there again.
const CONSUMED_BUTTONS = Object.freeze([1]);
const STICK_STATE_KEY = 'arcadeOverlayStick';

function listArcadeOverlayButtons(panel) {
    return getFocusableElements(panel).filter((element) => String(element.tagName).toUpperCase() === 'BUTTON');
}

/**
 * The visible Arcade overlay panel with at least one usable button, otherwise null. While the
 * result board's continue prompt (#message-actions) is shown, every pad button already means
 * "continue" there, so the panel stays out of the way instead of pressing a button at the same time.
 */
export function findArcadeOverlayChoicePanel(doc = globalThis.document) {
    const panel = doc?.getElementById?.(ARCADE_OVERLAY_PANEL_ID);
    if (!panel || panel.classList?.contains?.('hidden')) return null;
    const continuePrompt = doc.getElementById('message-actions');
    if (continuePrompt && !continuePrompt.classList?.contains?.('hidden')) return null;
    return listArcadeOverlayButtons(panel).length > 0 ? panel : null;
}

function moveArcadeOverlayFocus(panel, direction) {
    moveMainMenuFocus(listArcadeOverlayButtons(panel), direction, panel.ownerDocument?.activeElement);
}

function readStickDirection(gamepad) {
    const x = Number(gamepad?.axes?.[0]) || 0;
    const y = Number(gamepad?.axes?.[1]) || 0;
    if (Math.max(Math.abs(x), Math.abs(y)) < STICK_THRESHOLD) return '';
    if (Math.abs(x) >= Math.abs(y)) return x < 0 ? 'left' : 'right';
    return y < 0 ? 'up' : 'down';
}

/**
 * One frame of gamepad input for an open Arcade panel: D-pad, shoulder buttons and the left stick
 * move the focus, A presses the focused button. Without a focused button A only focuses the first
 * one, so a stray press never confirms a choice the player has not seen highlighted.
 * @param {object} panel
 * @param {Gamepad} gamepad
 * @param {(index: number) => boolean} consumePress edge-detected press of a button index
 * @param {Map<unknown, unknown>} state per-pad memory, cleared on disconnect
 */
export function handleArcadeOverlayGamepad(panel, gamepad, consumePress, state) {
    for (const [index, direction] of DIRECTION_BUTTONS) {
        if (consumePress(index)) moveArcadeOverlayFocus(panel, direction);
    }
    const stick = readStickDirection(gamepad);
    if (stick && stick !== state.get(STICK_STATE_KEY)) moveArcadeOverlayFocus(panel, stick);
    state.set(STICK_STATE_KEY, stick);
    CONSUMED_BUTTONS.forEach(consumePress);
    if (!consumePress(0)) return;
    const active = panel.ownerDocument?.activeElement;
    if (listArcadeOverlayButtons(panel).includes(active)) active.click();
    else moveArcadeOverlayFocus(panel, 'down');
}

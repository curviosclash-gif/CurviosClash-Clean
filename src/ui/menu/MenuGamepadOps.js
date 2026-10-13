// Gamepad poller of the main menu. The pause dialog is navigable with the same pad: while it is
// open it owns the input (d-pad up/down move through its buttons, A presses the focused one) and
// the menu callbacks wait. Held buttons from the match are recorded by the poller, not fired.
// The menu reads the pad only while its window has the focus, so a press meant for the hangar
// window in front does not also act here, and it honours "Controller-Steuerung aus".
import { isGamepadInputEnabled } from '../../shared/contracts/GamepadControlsContract.js';
import { activatePauseFocus, isPauseOverlayOpen, movePauseFocus } from '../PauseOverlayFocus.js';
import { createGamepadMenuPoller } from './GamepadMenuPoller.js';

/**
 * Test builds (build:app:test sets PW_RUN_TAG, so Vite defines __CURVIOS_E2E__ as true) run the
 * game in offscreen windows that never get the focus and drive the menu with a stand-in getGamepads.
 * Release builds have the constant replaced with false, so no page script can switch this on.
 */
function isAutomatedTestBuild() {
    return typeof __CURVIOS_E2E__ !== 'undefined' && __CURVIOS_E2E__ === true;
}

export function resolveOpenPauseOverlay(ui) {
    const overlay = ui?.pauseOverlay || (typeof document !== 'undefined' ? document.getElementById('pause-overlay') : null);
    return isPauseOverlayOpen(overlay) ? overlay : null;
}

/**
 * @param {{ ui?: any, getControls?: () => any, isMenuInteractive: () => boolean, onDirection: (direction: string) => void,
 *   onConfirm: () => void, onBack: () => void, onPreviousTab: () => void, onNextTab: () => void,
 *   onX?: () => void, onY?: () => void } & Record<string, any>} options
 *   The remaining options go to the poller unchanged.
 */
export function createMenuGamepadPoller({
    ui, getControls, isMenuInteractive, onDirection, onConfirm, onBack, onPreviousTab, onNextTab, onX, onY, ...pollerOptions
}) {
    const openPause = () => resolveOpenPauseOverlay(ui);
    const unlessPaused = (action) => () => {
        if (!openPause()) action();
    };
    return createGamepadMenuPoller({
        requireDocumentFocus: !isAutomatedTestBuild(),
        isEnabled: () => isGamepadInputEnabled(getControls?.()),
        ...pollerOptions,
        isActive: () => isMenuInteractive() || !!openPause(),
        onDirection: (direction) => {
            const pauseOverlay = openPause();
            if (!pauseOverlay) {
                onDirection(direction);
                return;
            }
            if (direction === 'up') movePauseFocus(pauseOverlay, -1);
            if (direction === 'down') movePauseFocus(pauseOverlay, 1);
        },
        onConfirm: () => {
            const pauseOverlay = openPause();
            if (pauseOverlay) activatePauseFocus(pauseOverlay);
            else onConfirm();
        },
        onBack: unlessPaused(onBack),
        onPreviousTab: unlessPaused(onPreviousTab),
        onNextTab: unlessPaused(onNextTab),
        onX: onX ? unlessPaused(onX) : undefined,
        onY: onY ? unlessPaused(onY) : undefined,
    });
}

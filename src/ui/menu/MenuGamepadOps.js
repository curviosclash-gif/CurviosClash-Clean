// Gamepad poller of the main menu. The pause dialog is navigable with the same pad: while it is
// open it owns the input (d-pad up/down move through its buttons, A presses the focused one) and
// the menu callbacks wait. Held buttons from the match are recorded by the poller, not fired.
import { activatePauseFocus, isPauseOverlayOpen, movePauseFocus } from '../PauseOverlayFocus.js';
import { createGamepadMenuPoller } from './GamepadMenuPoller.js';

export function resolveOpenPauseOverlay(ui) {
    const overlay = ui?.pauseOverlay || (typeof document !== 'undefined' ? document.getElementById('pause-overlay') : null);
    return isPauseOverlayOpen(overlay) ? overlay : null;
}

/**
 * @param {{ ui?: any, isMenuInteractive: () => boolean, onDirection: (direction: string) => void,
 *   onConfirm: () => void, onBack: () => void, onPreviousTab: () => void, onNextTab: () => void } & Record<string, any>} options
 *   The remaining options go to the poller unchanged.
 */
export function createMenuGamepadPoller({
    ui, isMenuInteractive, onDirection, onConfirm, onBack, onPreviousTab, onNextTab, ...pollerOptions
}) {
    const openPause = () => resolveOpenPauseOverlay(ui);
    const unlessPaused = (action) => () => {
        if (!openPause()) action();
    };
    return createGamepadMenuPoller({
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
    });
}

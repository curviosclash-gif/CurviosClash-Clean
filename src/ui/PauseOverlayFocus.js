// The pause overlay is an aria-modal dialog: while it is open the focus belongs inside it, and
// closing it hands the focus back to where the player was. D-pad and A move through its buttons
// because the menu navigation only covers the main menu.

const previousFocusByOverlay = new WeakMap();
const PAUSE_BUTTON_SELECTOR = 'button';

export function setPauseOverlayHidden(ui, hidden) {
    const overlay = ui?.pauseOverlay;
    if (!overlay) return;
    const wasHidden = overlay.classList.contains('hidden');
    overlay.classList.toggle('hidden', hidden);
    const doc = overlay.ownerDocument || null;
    if (wasHidden && !hidden) {
        previousFocusByOverlay.set(overlay, doc?.activeElement || null);
        ui.pauseResumeButton?.focus?.({ preventScroll: true });
        return;
    }
    if (!wasHidden && hidden) {
        const previous = previousFocusByOverlay.get(overlay) || null;
        previousFocusByOverlay.delete(overlay);
        // Only take the focus back from the dialog itself; whatever opened next keeps its own.
        const active = doc?.activeElement || null;
        if (!active || active === doc?.body || overlay.contains(active)) {
            previous?.focus?.({ preventScroll: true });
        }
    }
}

export function isPauseOverlayOpen(overlay) {
    return !!overlay && !overlay.classList.contains('hidden') && overlay.getAttribute?.('aria-hidden') !== 'true';
}

function listPauseButtons(overlay) {
    return Array.from(overlay.querySelectorAll?.(PAUSE_BUTTON_SELECTOR) || []).filter((button) => !button.disabled && button.hidden !== true);
}

export function movePauseFocus(overlay, step) {
    const buttons = listPauseButtons(overlay);
    if (buttons.length === 0) return;
    const active = overlay.ownerDocument?.activeElement || null;
    const index = buttons.indexOf(active);
    const next = index < 0 ? buttons[0] : buttons[(index + step + buttons.length) % buttons.length];
    next.focus?.({ preventScroll: true });
}

export function activatePauseFocus(overlay) {
    const active = overlay.ownerDocument?.activeElement || null;
    if (active && overlay.contains(active) && !active.disabled) active.click?.();
}

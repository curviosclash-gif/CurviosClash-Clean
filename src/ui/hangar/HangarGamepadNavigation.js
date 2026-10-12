// Gamepad control for the hangar window. Everything goes through what mouse and keyboard already
// use: A clicks the focused control (two-step confirm buttons and the part-then-slot placement of
// the workshop work unchanged), B sends the Escape key (drops a chosen part, else closes the
// hangar), LB/RB click the neighbouring workshop tab, left/right turn a focused slider or select.
import { isGamepadInputEnabled } from '../../shared/contracts/GamepadControlsContract.js';
import { createGamepadMenuPoller } from '../menu/GamepadMenuPoller.js';
import {
    adjustGamepadControl, focusWithoutScroll, getFocusableElements, isAvailable, moveMainMenuFocus,
} from '../menu/MenuNavigationFocusOps.js';

const TAB_SELECTOR = '[data-build-view]';

/**
 * @param {{ root?: any, doc?: any, getControls?: () => any } & Record<string, any>} [options]
 *   The remaining options (getGamepads, requestFrame, cancelFrame, now) go to the poller.
 */
export function createHangarGamepadNavigation({ root = document.body, doc = document, getControls = () => null, ...pollerOptions } = {}) {
    let lastFocused = null;

    const focusables = () => getFocusableElements(root);
    const isInside = (node) => !!node && node !== doc.body && root.contains(node) && isAvailable(node);

    function remember(node) {
        if (isInside(node)) lastFocused = node;
        return node;
    }

    /** A re-render replaced the node: the control with the same data-* identity takes its place. */
    function findTwin(node) {
        const identity = Object.entries(node?.dataset || {});
        if (identity.length === 0) return null;
        return focusables().find((candidate) => candidate !== node
            && identity.every(([key, value]) => candidate.dataset?.[key] === value)) || null;
    }

    function currentFocus() {
        const active = doc.activeElement;
        if (isInside(active)) return remember(active);
        const recovered = isInside(lastFocused) ? lastFocused : findTwin(lastFocused);
        if (!recovered) return null;
        focusWithoutScroll(recovered);
        return remember(recovered);
    }

    function focusFirst() {
        focusWithoutScroll(focusables()[0]);
        remember(doc.activeElement);
    }

    function move(direction) {
        const active = currentFocus();
        if (!active) { focusFirst(); return; }
        if (adjustGamepadControl(active, direction)) return;
        const candidates = focusables();
        moveMainMenuFocus(candidates, direction, active);
        if (doc.activeElement === active) {
            // No control in that direction (other column, scrolled list): step in reading order.
            const step = direction === 'left' || direction === 'up' ? -1 : 1;
            const index = candidates.indexOf(active);
            focusWithoutScroll(candidates[(index + step + candidates.length) % candidates.length]);
        }
        remember(doc.activeElement);
    }

    function confirm() {
        const active = currentFocus();
        if (!active) { focusFirst(); return; }
        if (typeof active.click === 'function') active.click();
        currentFocus();
    }

    function back() {
        const target = currentFocus() || root;
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        currentFocus();
    }

    function switchTab(step) {
        const tabs = Array.from(root.querySelectorAll(TAB_SELECTOR)).filter(isAvailable);
        if (tabs.length < 2) return;
        const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
        const start = current >= 0 ? current : (step > 0 ? -1 : 0);
        const next = tabs[(start + step + tabs.length) % tabs.length];
        next.click();
        focusWithoutScroll(next);
        remember(next);
    }

    const withFocusRing = (action) => (...args) => {
        root.dataset.gamepadFocus = 'true';
        action(...args);
    };
    const hideFocusRing = () => { delete root.dataset.gamepadFocus; };

    const poller = createGamepadMenuPoller({
        ...pollerOptions,
        isEnabled: () => isGamepadInputEnabled(getControls()),
        onDirection: withFocusRing(move),
        onConfirm: withFocusRing(confirm),
        onBack: withFocusRing(back),
        onPreviousTab: withFocusRing(() => switchTab(-1)),
        onNextTab: withFocusRing(() => switchTab(1)),
    });

    let started = false;
    return Object.freeze({
        start() {
            if (started) return;
            started = true;
            root.addEventListener('pointerdown', hideFocusRing);
            poller.start();
        },
        dispose() {
            started = false;
            poller.stop();
            root.removeEventListener('pointerdown', hideFocusRing);
            hideFocusRing();
            lastFocused = null;
        },
    });
}

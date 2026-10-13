// ============================================
// MenuFunnelTracker.js - clicks and time from the menu to the match start
// ============================================

import { createMenuFunnelPath } from '../../shared/contracts/MenuFunnelContract.js';

const BACK_TRIGGERS = new Set(['back_button', 'escape']);
const PANEL_EVENTS = Object.freeze({
    'submenu-custom': 'hub_opened',
    'submenu-game': 'freeplay_opened',
    'submenu-multiplayer': 'session_selected',
});

// Time is injected (runtime clock); without one every path lasts 0 ms.
const noClock = () => 0;

/**
 * Follows the menu path of one attempt to play: every navigation step counts as a
 * click, the start attempt closes the path and reports it once as `match_started`.
 * The next menu step after that starts a fresh path (e.g. back in the menu after a match).
 *
 * @param {{ now?: () => number, record?: (eventType: string, payload: object) => void }} [options]
 */
export function createMenuFunnelTracker({ now = noClock, record = () => {} } = {}) {
    const path = createMenuFunnelPath({ now });
    let closed = false;

    const step = (type) => {
        if (closed) {
            path.reset();
            closed = false;
        }
        path.record(type);
    };

    return {
        onPanelChanged(nextPanelId, trigger = '') {
            if (BACK_TRIGGERS.has(String(trigger || ''))) {
                step('back_pressed');
                return;
            }
            const type = PANEL_EVENTS[String(nextPanelId || '')];
            if (type) step(type);
        },
        onContinuePressed() {
            step('continue_pressed');
        },
        onSettingsOpened() {
            step('settings_opened');
        },
        onMatchStartAttempt() {
            if (closed) return;
            const result = path.record('match_started');
            if (!result) return;
            closed = true;
            // Session counts already come with the start attempt; only the path is new here.
            record('match_started', result);
        },
        snapshot: () => path.snapshot(),
    };
}

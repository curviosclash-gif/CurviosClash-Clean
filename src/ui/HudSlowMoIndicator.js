// ============================================
// HudSlowMoIndicator.js - screen-wide slow-motion marker
// ============================================
//
// Slow motion is a global effect, so its hint is a screen border on the HUD root
// rather than a per-player widget. The class is only written when the state flips,
// which keeps the per-frame cost at one comparison.

const SLOW_MO_CLASS = 'slowmo-active';

function isSlowMoActive(players) {
    if (!Array.isArray(players)) return false;
    for (let i = 0; i < players.length; i += 1) {
        const player = players[i];
        if (player?.slowMoActive === true || player?.manualSlowMoActive === true) {
            return true;
        }
    }
    return false;
}

/**
 * Keeps the slow-motion class on the HUD root in sync with the players.
 * @param {HTMLElement|null} hudRoot the #hud element
 * @param {Array<object>|null} players projected or live players
 * @param {boolean|null} lastActive state from the previous call
 * @returns {boolean} the current state, to be passed back as `lastActive`
 */
export function syncHudSlowMoClass(hudRoot, players, lastActive = null) {
    const active = isSlowMoActive(players);
    if (hudRoot?.classList && active !== lastActive) {
        hudRoot.classList.toggle(SLOW_MO_CLASS, active);
    }
    return active;
}

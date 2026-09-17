import { isHuntRespawnFixedByModePath } from './MenuCompatibilityRules.js';

export const HUNT_RESPAWN_FIXED_HINT = 'Im Kampf ist der Wiedereinstieg immer aktiv.';

/**
 * Mirrors the respawn setting into its menu toggle. The toggle only stays operable where a
 * click can actually change the rule; everywhere else the mode path fixes it and the toggle
 * says so instead of snapping back without a word.
 *
 * @param {HTMLInputElement|null} toggle
 * @param {object} settings
 * @param {{ huntModeActive: boolean, respawnEnabled: boolean }} state
 */
export function syncHuntRespawnToggle(toggle, settings, { huntModeActive, respawnEnabled }) {
    if (!toggle) return;
    const fixedByModePath = isHuntRespawnFixedByModePath(settings);
    toggle.checked = !!respawnEnabled;
    toggle.disabled = !huntModeActive || fixedByModePath;
    toggle.title = huntModeActive && fixedByModePath ? HUNT_RESPAWN_FIXED_HINT : '';
}

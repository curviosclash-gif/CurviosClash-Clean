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

    const document = toggle.ownerDocument;
    const teamMode = huntModeActive && settings?.hunt?.teamMode === true;
    const teamModeToggle = document?.getElementById('hunt-team-mode-toggle');
    const teamRules = document?.getElementById('hunt-team-rules');
    const teamSize = document?.getElementById('hunt-team-size');
    const teamObjective = document?.getElementById('hunt-team-objective-select');
    const alphaDifficulty = document?.getElementById('hunt-team-alpha-difficulty');
    const bravoDifficulty = document?.getElementById('hunt-team-bravo-difficulty');
    if (teamModeToggle) teamModeToggle.checked = teamMode;
    if (teamRules) teamRules.classList.toggle('hidden', !teamMode);
    if (teamSize) teamSize.value = String(settings?.hunt?.teamSize || 4);
    if (teamObjective) {
        const objective = String(settings?.hunt?.teamObjective || 'HUNT').toUpperCase();
        teamObjective.value = ['FLAGS', 'ESCORT'].includes(objective) ? objective : 'HUNT';
    }
    if (alphaDifficulty) alphaDifficulty.value = settings?.hunt?.teamBotDifficulty?.ALPHA || 'NORMAL';
    if (bravoDifficulty) bravoDifficulty.value = settings?.hunt?.teamBotDifficulty?.BRAVO || 'NORMAL';
}

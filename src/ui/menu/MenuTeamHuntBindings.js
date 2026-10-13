// Team play and its objective come from the free play variant; here only the team rules.
export function bindMenuTeamHuntControls({ ui, settings, bind, emitSettingsChangedImmediate, keys }) {
    if (ui.huntTeamSizeSelect) {
        bind(ui.huntTeamSizeSelect, 'change', () => {
            if (!settings.hunt) settings.hunt = {};
            settings.hunt.teamSize = Math.max(2, Math.min(5, Number(ui.huntTeamSizeSelect.value) || 4));
            emitSettingsChangedImmediate([keys.HUNT_TEAM_SIZE]);
        });
    }
    const bindDifficulty = (control, teamId) => {
        if (!control) return;
        bind(control, 'change', () => {
            if (!settings.hunt) settings.hunt = {};
            if (!settings.hunt.teamBotDifficulty) settings.hunt.teamBotDifficulty = {};
            const value = String(control.value || '').toUpperCase();
            settings.hunt.teamBotDifficulty[teamId] = ['EASY', 'NORMAL', 'HARD'].includes(value) ? value : 'NORMAL';
            emitSettingsChangedImmediate([keys.HUNT_TEAM_BOT_DIFFICULTY]);
        });
    };
    bindDifficulty(ui.huntTeamAlphaDifficulty, 'ALPHA');
    bindDifficulty(ui.huntTeamBravoDifficulty, 'BRAVO');
}

export function bindMenuTeamHuntControls({ ui, settings, bind, emitSettingsChangedImmediate, keys }) {
    if (ui.huntTeamModeToggle) {
        bind(ui.huntTeamModeToggle, 'change', () => {
            if (!settings.hunt) settings.hunt = {};
            settings.hunt.teamMode = !!ui.huntTeamModeToggle.checked;
            if (settings.hunt.teamMode) settings.hunt.respawnEnabled = true;
            emitSettingsChangedImmediate([keys.HUNT_TEAM_MODE, keys.HUNT_RESPAWN_ENABLED]);
        });
    }
    if (ui.huntTeamSizeSelect) {
        bind(ui.huntTeamSizeSelect, 'change', () => {
            if (!settings.hunt) settings.hunt = {};
            settings.hunt.teamSize = Math.max(2, Math.min(5, Number(ui.huntTeamSizeSelect.value) || 4));
            emitSettingsChangedImmediate([keys.HUNT_TEAM_SIZE]);
        });
    }
    if (ui.huntTeamObjectiveSelect) {
        bind(ui.huntTeamObjectiveSelect, 'change', () => {
            if (!settings.hunt) settings.hunt = {};
            settings.hunt.teamObjective = ui.huntTeamObjectiveSelect.value === 'FLAGS' ? 'FLAGS' : 'HUNT';
            emitSettingsChangedImmediate([keys.HUNT_TEAM_OBJECTIVE]);
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

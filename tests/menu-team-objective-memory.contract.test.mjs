import assert from 'node:assert/strict';
import test from 'node:test';

import { bindMenuTeamHuntControls } from '../src/ui/menu/MenuTeamHuntBindings.js';
import { sanitizeSettingsSnapshot } from '../src/core/settings/SettingsSanitizerOps.js';
import { createDefaultSettingsSnapshot } from '../src/core/settings/SettingsDefaultsFacade.js';

function createControls(settings) {
    const handlers = new Map();
    const ui = {
        huntTeamModeToggle: { checked: false },
        huntTeamObjectiveSelect: { value: 'HUNT' },
    };
    bindMenuTeamHuntControls({
        ui,
        settings,
        bind: (control, type, handler) => handlers.set(control, handler),
        emitSettingsChangedImmediate() {},
        keys: {
            HUNT_TEAM_MODE: 'hunt.teamMode',
            HUNT_RESPAWN_ENABLED: 'hunt.respawnEnabled',
            HUNT_TEAM_OBJECTIVE: 'hunt.teamObjective',
        },
    });
    return {
        ui,
        change(control) { handlers.get(control)(); },
    };
}

for (const objective of ['FLAGS', 'ESCORT']) {
    test(`${objective} survives disabling and re-enabling team mode after profile save`, () => {
        const settings = createDefaultSettingsSnapshot();
        settings.gameMode = 'HUNT';
        settings.localSettings.modePath = 'fight';
        const { ui, change } = createControls(settings);
        ui.huntTeamObjectiveSelect.value = objective;
        change(ui.huntTeamObjectiveSelect);
        ui.huntTeamModeToggle.checked = false;
        change(ui.huntTeamModeToggle);
        assert.equal(settings.hunt.teamMode, false);
        assert.equal(settings.hunt.teamObjective, 'HUNT');

        const restored = sanitizeSettingsSnapshot(settings, createDefaultSettingsSnapshot);
        assert.equal(restored.hunt.teamMode, false);
        const restoredControls = createControls(restored);
        restoredControls.ui.huntTeamModeToggle.checked = true;
        restoredControls.change(restoredControls.ui.huntTeamModeToggle);
        assert.equal(restored.hunt.teamObjective, objective);
        assert.equal(restored.hunt.teamMode, true);
    });
}

test('the most recently selected team objective replaces the previous one', () => {
    const settings = createDefaultSettingsSnapshot();
    const { ui, change } = createControls(settings);
    ui.huntTeamObjectiveSelect.value = 'ESCORT';
    change(ui.huntTeamObjectiveSelect);
    ui.huntTeamObjectiveSelect.value = 'FLAGS';
    change(ui.huntTeamObjectiveSelect);
    ui.huntTeamModeToggle.checked = false;
    change(ui.huntTeamModeToggle);
    ui.huntTeamModeToggle.checked = true;
    change(ui.huntTeamModeToggle);
    assert.equal(settings.hunt.teamObjective, 'FLAGS');
});

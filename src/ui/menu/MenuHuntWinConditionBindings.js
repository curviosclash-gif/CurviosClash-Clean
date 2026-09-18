import { normalizeHuntWinCondition } from '../../shared/contracts/HuntWinConditionContract.js';

export function bindHuntWinConditionSelect({ ui, settings, bind, emitSettingsChangedImmediate, keys }) {
    if (!ui.huntWinConditionSelect) return;
    bind(ui.huntWinConditionSelect, 'change', () => {
        if (!settings.hunt) settings.hunt = {};
        settings.hunt.winCondition = normalizeHuntWinCondition(ui.huntWinConditionSelect.value);
        emitSettingsChangedImmediate([keys.HUNT_WIN_CONDITION]);
    });
}

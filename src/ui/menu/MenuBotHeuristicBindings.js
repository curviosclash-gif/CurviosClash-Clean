import {
    BOT_HEURISTIC_PROFILE_NAMES,
    BOT_HEURISTIC_TUNING_LIMITS,
    createBotHeuristicTuningSnapshot,
} from '../../shared/contracts/BotHeuristicTuningContract.js';

const DEFAULT_PROFILE = 'balanced';
const TUNING_CONTROLS = Object.freeze([
    Object.freeze({ inputKey: 'botHeuristicAggressionSlider', labelKey: 'botHeuristicAggressionLabel', field: 'aggression' }),
    Object.freeze({ inputKey: 'botHeuristicSurvivalSlider', labelKey: 'botHeuristicSurvivalLabel', field: 'survivalFocus' }),
]);

function resolveProfile(settings) {
    const name = String(settings?.botHeuristicProfile || '').trim();
    return BOT_HEURISTIC_PROFILE_NAMES.includes(name) ? name : DEFAULT_PROFILE;
}

// The sliders tune the selected profile, so a profile switch shows that profile's own values.
export function syncBotHeuristicControls(ui, settings) {
    if (!ui?.botHeuristicProfileSelect) return;
    const profile = resolveProfile(settings);
    ui.botHeuristicProfileSelect.value = profile;
    const tuning = createBotHeuristicTuningSnapshot(settings?.botHeuristicTuning)[profile];
    for (const control of TUNING_CONTROLS) {
        const value = String(tuning[control.field]);
        if (ui[control.inputKey]) ui[control.inputKey].value = value;
        if (ui[control.labelKey]) ui[control.labelKey].textContent = value;
    }
}

export function bindBotHeuristicControls({ ui, settings, bind, emitSettingsChangedImmediate, keys }) {
    if (!ui?.botHeuristicProfileSelect) return;
    bind(ui.botHeuristicProfileSelect, 'change', () => {
        const requested = String(ui.botHeuristicProfileSelect.value || '').trim();
        settings.botHeuristicProfile = BOT_HEURISTIC_PROFILE_NAMES.includes(requested) ? requested : DEFAULT_PROFILE;
        syncBotHeuristicControls(ui, settings);
        emitSettingsChangedImmediate([keys.BOTS_HEURISTIC_PROFILE]);
    });
    for (const control of TUNING_CONTROLS) {
        const slider = ui[control.inputKey];
        if (!slider) continue;
        slider.min = String(BOT_HEURISTIC_TUNING_LIMITS.min);
        slider.max = String(BOT_HEURISTIC_TUNING_LIMITS.max);
        slider.step = String(BOT_HEURISTIC_TUNING_LIMITS.step);
        bind(slider, 'input', () => {
            const tuning = createBotHeuristicTuningSnapshot(settings.botHeuristicTuning);
            tuning[resolveProfile(settings)][control.field] = Number(slider.value);
            settings.botHeuristicTuning = createBotHeuristicTuningSnapshot(tuning);
            syncBotHeuristicControls(ui, settings);
            emitSettingsChangedImmediate([keys.BOTS_HEURISTIC_TUNING]);
        });
    }
}

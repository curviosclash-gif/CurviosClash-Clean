import {
    ARCADE_RUN_SETTINGS_RANGES,
    createDefaultArcadeRunSettings,
    normalizeArcadeRunSettings,
} from '../../shared/contracts/ArcadeRunSettingsContract.js';

const CONTROL_DESCRIPTORS = Object.freeze([
    Object.freeze({
        inputKey: 'arcadeSectorCountInput',
        labelKey: 'arcadeSectorCountLabel',
        settingKey: 'sectorCount',
        changeKey: 'ARCADE_SECTOR_COUNT',
        format: (value) => String(value),
    }),
    Object.freeze({
        inputKey: 'arcadeComboWindowInput',
        labelKey: 'arcadeComboWindowLabel',
        settingKey: 'comboWindowMs',
        changeKey: 'ARCADE_COMBO_WINDOW',
        format: (value) => `${(value / 1000).toFixed(1)} s`,
    }),
    Object.freeze({
        inputKey: 'arcadeMaxMultiplierInput',
        labelKey: 'arcadeMaxMultiplierLabel',
        settingKey: 'maxMultiplier',
        changeKey: 'ARCADE_MAX_MULTIPLIER',
        format: (value) => `${value}x`,
    }),
    // Fine values in the expert area.
    Object.freeze({
        inputKey: 'arcadeIntermissionInput',
        labelKey: 'arcadeIntermissionLabel',
        settingKey: 'intermissionSeconds',
        changeKey: 'ARCADE_INTERMISSION_SECONDS',
        format: (value) => `${value} s`,
    }),
    Object.freeze({
        inputKey: 'arcadeComboDecayInput',
        labelKey: 'arcadeComboDecayLabel',
        settingKey: 'comboDecayPerSecond',
        changeKey: 'ARCADE_COMBO_DECAY',
        format: (value) => `${Number(value).toFixed(1)} pro s`,
    }),
]);

const TOGGLE_DESCRIPTORS = Object.freeze([
    Object.freeze({ inputKey: 'arcadeReplayHooksToggle', settingKey: 'replayHooksEnabled', changeKey: 'ARCADE_REPLAY_HOOKS' }),
]);

function ensureArcadeSettings(settings) {
    if (!settings.arcade || typeof settings.arcade !== 'object' || Array.isArray(settings.arcade)) {
        settings.arcade = createDefaultArcadeRunSettings();
        return settings.arcade;
    }
    settings.arcade = normalizeArcadeRunSettings(settings.arcade);
    return settings.arcade;
}

function applyControlToUi(ui, descriptor, value) {
    const input = ui?.[descriptor.inputKey];
    const label = ui?.[descriptor.labelKey];
    if (input) input.value = String(value);
    if (label) label.textContent = descriptor.format(value);
}

function hasArcadeControl(ui) {
    return [...CONTROL_DESCRIPTORS, ...TOGGLE_DESCRIPTORS].some((descriptor) => !!ui?.[descriptor.inputKey]);
}

/**
 * Sector count for an arcade run. The control writes the persisted settings.arcade
 * block, so the contract normalizer decides the range in exactly one place.
 */
export function bindArcadeRunSettings({
    ui,
    settings,
    bind,
    emitSettingsChangedImmediate,
    keys,
}) {
    if (!hasArcadeControl(ui)) return;

    const arcadeSettings = ensureArcadeSettings(settings);
    for (const descriptor of CONTROL_DESCRIPTORS) {
        const input = ui?.[descriptor.inputKey];
        if (!input) continue;
        const range = ARCADE_RUN_SETTINGS_RANGES[descriptor.settingKey];
        input.min = String(range.min);
        input.max = String(range.max);
        applyControlToUi(ui, descriptor, arcadeSettings[descriptor.settingKey]);
        bind(input, 'input', () => {
            const nextArcadeSettings = ensureArcadeSettings(settings);
            nextArcadeSettings[descriptor.settingKey] = normalizeArcadeRunSettings({
                ...nextArcadeSettings,
                [descriptor.settingKey]: input.value,
            })[descriptor.settingKey];
            applyControlToUi(ui, descriptor, nextArcadeSettings[descriptor.settingKey]);
            emitSettingsChangedImmediate([keys[descriptor.changeKey]]);
        });
    }
    for (const descriptor of TOGGLE_DESCRIPTORS) {
        const toggle = ui?.[descriptor.inputKey];
        if (!toggle) continue;
        toggle.checked = arcadeSettings[descriptor.settingKey] === true;
        bind(toggle, 'change', () => {
            ensureArcadeSettings(settings)[descriptor.settingKey] = toggle.checked === true;
            emitSettingsChangedImmediate([keys[descriptor.changeKey]]);
        });
    }
}

/** Mirrors a settings change back onto the control without emitting a new change. */
export function syncArcadeRunSettings(ui, settings) {
    if (!hasArcadeControl(ui)) return;
    const arcadeSettings = normalizeArcadeRunSettings(settings?.arcade);
    for (const descriptor of CONTROL_DESCRIPTORS) {
        applyControlToUi(ui, descriptor, arcadeSettings[descriptor.settingKey]);
    }
    for (const descriptor of TOGGLE_DESCRIPTORS) {
        if (ui?.[descriptor.inputKey]) ui[descriptor.inputKey].checked = arcadeSettings[descriptor.settingKey] === true;
    }
}

import {
    ARCADE_RUN_SETTINGS_RANGES,
    createDefaultArcadeRunSettings,
    normalizeArcadeRunSettings,
} from '../../shared/contracts/ArcadeRunSettingsContract.js';

const SECTOR_RANGE = ARCADE_RUN_SETTINGS_RANGES.sectorCount;

function ensureArcadeSettings(settings) {
    if (!settings.arcade || typeof settings.arcade !== 'object' || Array.isArray(settings.arcade)) {
        settings.arcade = createDefaultArcadeRunSettings();
        return settings.arcade;
    }
    settings.arcade = normalizeArcadeRunSettings(settings.arcade);
    return settings.arcade;
}

function applySectorCountToUi(ui, sectorCount) {
    if (ui.arcadeSectorCountInput) {
        ui.arcadeSectorCountInput.value = String(sectorCount);
    }
    if (ui.arcadeSectorCountLabel) {
        ui.arcadeSectorCountLabel.textContent = String(sectorCount);
    }
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
    if (!ui?.arcadeSectorCountInput) return;

    const arcadeSettings = ensureArcadeSettings(settings);
    ui.arcadeSectorCountInput.min = String(SECTOR_RANGE.min);
    ui.arcadeSectorCountInput.max = String(SECTOR_RANGE.max);
    applySectorCountToUi(ui, arcadeSettings.sectorCount);

    bind(ui.arcadeSectorCountInput, 'input', () => {
        const nextArcadeSettings = ensureArcadeSettings(settings);
        nextArcadeSettings.sectorCount = normalizeArcadeRunSettings({
            ...nextArcadeSettings,
            sectorCount: ui.arcadeSectorCountInput.value,
        }).sectorCount;
        applySectorCountToUi(ui, nextArcadeSettings.sectorCount);
        emitSettingsChangedImmediate([keys.ARCADE_SECTOR_COUNT]);
    });
}

/** Mirrors a settings change back onto the control without emitting a new change. */
export function syncArcadeRunSettings(ui, settings) {
    if (!ui?.arcadeSectorCountInput) return;
    applySectorCountToUi(ui, normalizeArcadeRunSettings(settings?.arcade).sectorCount);
}

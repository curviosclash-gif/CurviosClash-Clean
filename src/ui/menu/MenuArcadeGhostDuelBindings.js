import {
    ARCADE_GHOST_DUEL_MODES,
    normalizeArcadeGhostDuelMode,
    normalizeArcadeGhostTrailCollisionEnabled,
} from '../../shared/contracts/ArcadeGhostDuelContract.js';

function ensureStartSetupSettings(settings) {
    if (!settings.localSettings || typeof settings.localSettings !== 'object') {
        settings.localSettings = {};
    }
    if (!settings.localSettings.startSetup || typeof settings.localSettings.startSetup !== 'object') {
        settings.localSettings.startSetup = {};
    }
    settings.localSettings.startSetup.arcadeGhostDuelMode = normalizeArcadeGhostDuelMode(
        settings.localSettings.startSetup.arcadeGhostDuelMode,
        ARCADE_GHOST_DUEL_MODES.OFF
    );
    settings.localSettings.startSetup.arcadeGhostTrailCollisionEnabled = normalizeArcadeGhostTrailCollisionEnabled(
        settings.localSettings.startSetup.arcadeGhostTrailCollisionEnabled,
        false
    );
    return settings.localSettings.startSetup;
}

export function bindArcadeGhostDuelModeSelect({
    ui,
    settings,
    bind,
    emitSettingsChangedImmediate,
    keys,
}) {
    const startSetupSettings = ensureStartSetupSettings(settings);
    if (ui?.arcadeGhostDuelModeSelect) {
        ui.arcadeGhostDuelModeSelect.value = startSetupSettings.arcadeGhostDuelMode;
        bind(ui.arcadeGhostDuelModeSelect, 'change', () => {
            const nextStartSetupSettings = ensureStartSetupSettings(settings);
            nextStartSetupSettings.arcadeGhostDuelMode = normalizeArcadeGhostDuelMode(
                ui.arcadeGhostDuelModeSelect.value,
                ARCADE_GHOST_DUEL_MODES.OFF
            );
            ui.arcadeGhostDuelModeSelect.value = nextStartSetupSettings.arcadeGhostDuelMode;
            emitSettingsChangedImmediate([keys.ARCADE_GHOST_DUEL_MODE]);
        });
    }

    if (ui?.arcadeGhostTrailCollisionToggle) {
        ui.arcadeGhostTrailCollisionToggle.checked = startSetupSettings.arcadeGhostTrailCollisionEnabled === true;
        bind(ui.arcadeGhostTrailCollisionToggle, 'change', () => {
            const nextStartSetupSettings = ensureStartSetupSettings(settings);
            nextStartSetupSettings.arcadeGhostTrailCollisionEnabled = ui.arcadeGhostTrailCollisionToggle.checked === true;
            emitSettingsChangedImmediate([keys.ARCADE_GHOST_TRAIL_COLLISION_ENABLED]);
        });
    }
}

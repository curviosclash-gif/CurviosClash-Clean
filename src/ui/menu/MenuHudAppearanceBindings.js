// ============================================
// MenuHudAppearanceBindings.js - HUD appearance settings controls
// ============================================

import {
    normalizeHudAppearance,
    normalizeHudColorPreset,
} from '../../shared/contracts/HudAppearanceContract.js';
import { resolveHudColorPresetLabel } from '../HudAppearance.js';

function ensureHudAppearanceSettings(settings) {
    if (!settings.localSettings || typeof settings.localSettings !== 'object') {
        settings.localSettings = {};
    }
    settings.localSettings.hud = normalizeHudAppearance(settings.localSettings.hud);
    return settings.localSettings.hud;
}

function readHudPercentFromSlider(slider, fallback) {
    const parsed = Number(slider?.value);
    if (!Number.isFinite(parsed)) return fallback;
    return parsed / 100;
}

export function bindMenuHudAppearanceControls({
    ui,
    settings,
    bind,
    emit,
    emitSettingsChangedImmediate,
    queueInputSettingsChanged,
    eventTypes,
    settingsChangeKeys: keys,
}) {
    if (ui.hudScaleSlider) {
        bind(ui.hudScaleSlider, 'input', () => {
            const hudSettings = ensureHudAppearanceSettings(settings);
            // Slider min/max already enforce the contract limits; the value is
            // normalized again on the sanitize/save path.
            hudSettings.scale = readHudPercentFromSlider(ui.hudScaleSlider, hudSettings.scale);
            queueInputSettingsChanged([keys.LOCAL_HUD_SCALE]);
        });
    }
    if (ui.hudOpacitySlider) {
        bind(ui.hudOpacitySlider, 'input', () => {
            const hudSettings = ensureHudAppearanceSettings(settings);
            hudSettings.opacity = readHudPercentFromSlider(ui.hudOpacitySlider, hudSettings.opacity);
            queueInputSettingsChanged([keys.LOCAL_HUD_OPACITY]);
        });
    }
    if (ui.hudColorPresetSelect) {
        bind(ui.hudColorPresetSelect, 'change', () => {
            const hudSettings = ensureHudAppearanceSettings(settings);
            hudSettings.colorPreset = normalizeHudColorPreset(ui.hudColorPresetSelect.value);
            emitSettingsChangedImmediate([keys.LOCAL_HUD_COLOR_PRESET]);
            emit(eventTypes.SHOW_STATUS_TOAST, {
                message: `HUD-Farbschema: ${resolveHudColorPresetLabel(hudSettings.colorPreset)}`,
                duration: 1300,
                tone: 'info',
            });
        });
    }
}

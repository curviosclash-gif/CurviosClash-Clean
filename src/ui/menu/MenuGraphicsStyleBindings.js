import { normalizeGraphicsStyle } from '../../shared/contracts/GraphicsStyleContract.js';

export function bindGraphicsStyleSelect({
    ui,
    settings,
    bind,
    emitSettingsChangedImmediate,
    settingsChangeKeys,
}) {
    if (!ui.graphicsStyleSelect) return;
    bind(ui.graphicsStyleSelect, 'change', () => {
        if (!settings.localSettings || typeof settings.localSettings !== 'object') {
            settings.localSettings = {};
        }
        settings.localSettings.graphicsStyle = normalizeGraphicsStyle(ui.graphicsStyleSelect.value);
        emitSettingsChangedImmediate([settingsChangeKeys.LOCAL_GRAPHICS_STYLE]);
    });
}

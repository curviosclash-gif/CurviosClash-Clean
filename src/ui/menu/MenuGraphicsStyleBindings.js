import { normalizeGraphicsStyle } from '../../shared/contracts/GraphicsStyleContract.js';
import { normalizeMapBrightness } from '../../shared/contracts/MapBrightnessContract.js';
import { normalizeViewDistance } from '../../shared/contracts/ViewDistanceContract.js';

export function bindGraphicsStyleSelect({
    ui,
    settings,
    bind,
    emitSettingsChangedImmediate,
    queueInputSettingsChanged,
    settingsChangeKeys,
}) {
    const ensureLocalSettings = () => {
        if (!settings.localSettings || typeof settings.localSettings !== 'object') {
            settings.localSettings = {};
        }
        return settings.localSettings;
    };

    if (ui.graphicsStyleSelect) {
        bind(ui.graphicsStyleSelect, 'change', () => {
            ensureLocalSettings().graphicsStyle = normalizeGraphicsStyle(ui.graphicsStyleSelect.value);
            emitSettingsChangedImmediate([settingsChangeKeys.LOCAL_GRAPHICS_STYLE]);
        });
    }

    if (ui.mapBrightnessSelect) {
        bind(ui.mapBrightnessSelect, 'change', () => {
            ensureLocalSettings().mapBrightness = normalizeMapBrightness(ui.mapBrightnessSelect.value);
            emitSettingsChangedImmediate([settingsChangeKeys.LOCAL_MAP_BRIGHTNESS]);
        });
    }

    if (ui.viewDistanceSlider) {
        bind(ui.viewDistanceSlider, 'input', () => {
            ensureLocalSettings().viewDistance = normalizeViewDistance(ui.viewDistanceSlider.value);
            queueInputSettingsChanged?.([settingsChangeKeys.LOCAL_VIEW_DISTANCE]);
        });
    }
}

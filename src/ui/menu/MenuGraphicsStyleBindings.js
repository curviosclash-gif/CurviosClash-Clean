import { normalizeGraphicsStyle } from '../../shared/contracts/GraphicsStyleContract.js';
import { normalizeGraphicsQualitySetting } from '../../shared/contracts/GraphicsQualityContract.js';
import { normalizeMapBrightness } from '../../shared/contracts/MapBrightnessContract.js';
import { normalizeViewDistance, resolveViewDistanceLabel } from '../../shared/contracts/ViewDistanceContract.js';

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

    if (ui.graphicsQualitySelect) {
        bind(ui.graphicsQualitySelect, 'change', () => {
            ensureLocalSettings().graphicsQuality = normalizeGraphicsQualitySetting(ui.graphicsQualitySelect.value);
            emitSettingsChangedImmediate([settingsChangeKeys.LOCAL_GRAPHICS_QUALITY]);
        });
    }
}

/** Shows the stored style, brightness, view distance and graphics level in the menu controls. */
export function syncGraphicsStyleControls({ ui, settings }) {
    const localSettings = settings?.localSettings;
    if (ui.graphicsStyleSelect) {
        ui.graphicsStyleSelect.value = normalizeGraphicsStyle(localSettings?.graphicsStyle);
    }
    if (ui.mapBrightnessSelect) {
        ui.mapBrightnessSelect.value = normalizeMapBrightness(localSettings?.mapBrightness);
    }
    const viewDistance = normalizeViewDistance(localSettings?.viewDistance);
    if (ui.viewDistanceSlider) ui.viewDistanceSlider.value = String(viewDistance);
    if (ui.viewDistanceLabel) ui.viewDistanceLabel.textContent = resolveViewDistanceLabel(viewDistance);
    if (ui.graphicsQualitySelect) {
        ui.graphicsQualitySelect.value = normalizeGraphicsQualitySetting(localSettings?.graphicsQuality);
    }
}

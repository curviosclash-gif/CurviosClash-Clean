import { normalizeGraphicsStyle } from '../../shared/contracts/GraphicsStyleContract.js';
import { normalizeGraphicsQualitySetting } from '../../shared/contracts/GraphicsQualityContract.js';
import { normalizeMapBrightness } from '../../shared/contracts/MapBrightnessContract.js';
import { normalizeViewDistance, resolveViewDistanceLabel } from '../../shared/contracts/ViewDistanceContract.js';
import { normalizeMenuScale, resolveMenuScaleFactor, resolveMenuScaleLabel } from '../../shared/contracts/MenuScaleContract.js';

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

    if (ui.menuScaleSlider) {
        bind(ui.menuScaleSlider, 'input', () => {
            const menuScale = normalizeMenuScale(ui.menuScaleSlider.value);
            ensureLocalSettings().menuScale = menuScale;
            // Live preview: the menu follows the slider before the change is published.
            applyMenuScale(ui, menuScale);
            queueInputSettingsChanged?.([settingsChangeKeys.LOCAL_MENU_SCALE]);
        });
    }

    if (ui.graphicsQualitySelect) {
        bind(ui.graphicsQualitySelect, 'change', () => {
            ensureLocalSettings().graphicsQuality = normalizeGraphicsQualitySetting(ui.graphicsQualitySelect.value);
            emitSettingsChangedImmediate([settingsChangeKeys.LOCAL_GRAPHICS_QUALITY]);
        });
    }
}

/** Menu size: the CSS variable on the menu root drives every size token (see MenuTokens.css). */
export function applyMenuScale(ui, value) {
    const menuScale = normalizeMenuScale(value);
    ui.mainMenu?.style?.setProperty?.('--menu-scale', String(resolveMenuScaleFactor(menuScale)));
    if (ui.menuScaleSlider) ui.menuScaleSlider.value = String(menuScale);
    if (ui.menuScaleLabel) ui.menuScaleLabel.textContent = resolveMenuScaleLabel(menuScale);
}

/** Shows the stored style, brightness, view distance, menu size and graphics level in the menu controls. */
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
    applyMenuScale(ui, localSettings?.menuScale);
}

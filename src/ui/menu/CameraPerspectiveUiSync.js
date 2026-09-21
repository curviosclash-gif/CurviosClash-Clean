import {
    CAMERA_PERSPECTIVE_EFFECT_INTENSITY_MAX,
    CAMERA_PERSPECTIVE_MODE,
    createDefaultCameraPerspectiveSettings,
    normalizeCameraPerspectiveSettings,
} from '../../shared/contracts/CameraPerspectiveContract.js';
import { resolveMenuCatalogText } from './MenuTextCatalog.js';

export function syncNormalCameraPerspectiveUi(ui, cameraPerspectiveSettingsSource) {
    const cameraPerspectiveSettings = normalizeCameraPerspectiveSettings(
        cameraPerspectiveSettingsSource,
        createDefaultCameraPerspectiveSettings()
    );
    if (ui.normalCameraPerspectiveSelect) {
        ui.normalCameraPerspectiveSelect.value = cameraPerspectiveSettings.normal;
    }
    if (ui.normalCameraReduceMotionToggle) {
        ui.normalCameraReduceMotionToggle.checked = !!cameraPerspectiveSettings.reduceMotion;
    }

    const speedFovIntensityPercent = Math.round(
        Math.min(CAMERA_PERSPECTIVE_EFFECT_INTENSITY_MAX, Math.max(0, Number(cameraPerspectiveSettings.speedFovIntensity) || 0)) * 100
    );
    if (ui.normalCameraSpeedFovToggle) {
        ui.normalCameraSpeedFovToggle.checked = cameraPerspectiveSettings.speedFovEnabled !== false;
    }
    if (ui.normalCameraSpeedFovIntensitySlider) {
        ui.normalCameraSpeedFovIntensitySlider.value = String(speedFovIntensityPercent);
        ui.normalCameraSpeedFovIntensitySlider.disabled = cameraPerspectiveSettings.speedFovEnabled === false;
    }
    if (ui.normalCameraSpeedFovIntensityLabel) {
        ui.normalCameraSpeedFovIntensityLabel.textContent = `${speedFovIntensityPercent}%`;
    }

    const thrusterExhaustIntensityPercent = Math.round(
        Math.min(CAMERA_PERSPECTIVE_EFFECT_INTENSITY_MAX, Math.max(0, Number(cameraPerspectiveSettings.thrusterExhaustIntensity) || 0)) * 100
    );
    if (ui.normalCameraThrusterExhaustToggle) {
        ui.normalCameraThrusterExhaustToggle.checked = cameraPerspectiveSettings.thrusterExhaustEnabled !== false;
    }
    if (ui.normalCameraThrusterExhaustIntensitySlider) {
        ui.normalCameraThrusterExhaustIntensitySlider.value = String(thrusterExhaustIntensityPercent);
        ui.normalCameraThrusterExhaustIntensitySlider.disabled = cameraPerspectiveSettings.thrusterExhaustEnabled === false;
    }
    if (ui.normalCameraThrusterExhaustIntensityLabel) {
        ui.normalCameraThrusterExhaustIntensityLabel.textContent = `${thrusterExhaustIntensityPercent}%`;
    }

    if (ui.normalCameraPerspectiveHint) {
        const perspectiveLabel = cameraPerspectiveSettings.normal === CAMERA_PERSPECTIVE_MODE.CINEMATIC_SOFT
            ? resolveMenuCatalogText('menu.camera.perspective.cinematic_soft.label', 'Cinematic Soft')
            : cameraPerspectiveSettings.normal === CAMERA_PERSPECTIVE_MODE.CINEMATIC_ACTION
                ? resolveMenuCatalogText('menu.camera.perspective.cinematic_action.label', 'Cinematic Action')
                : resolveMenuCatalogText('menu.camera.perspective.classic.label', 'Spielgetreu');
        const reduceMotionLabel = cameraPerspectiveSettings.reduceMotion ? 'an' : 'aus';
        const speedFovLabel = cameraPerspectiveSettings.speedFovEnabled !== false ? `${speedFovIntensityPercent}%` : 'aus';
        const thrusterExhaustLabel = cameraPerspectiveSettings.thrusterExhaustEnabled !== false ? `${thrusterExhaustIntensityPercent}%` : 'aus';
        ui.normalCameraPerspectiveHint.textContent = `Video-Perspektive: ${perspectiveLabel} - beruhigt: ${reduceMotionLabel} - Speed-FOV: ${speedFovLabel} - Triebwerkspartikel: ${thrusterExhaustLabel}`;
    }
}

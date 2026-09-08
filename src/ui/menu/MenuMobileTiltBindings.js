import {
    MOBILE_CLASSIC_TILT_SENSITIVITY_LIMITS,
    normalizeMobileClassicControlSettings,
} from '../../shared/contracts/MobileClassicControlsContract.js';
import { clamp } from '../../shared/utils/MathOps.js';

function ensureMobileControls(settings) {
    if (!settings.localSettings || typeof settings.localSettings !== 'object') {
        settings.localSettings = {};
    }
    settings.localSettings.mobileControls = normalizeMobileClassicControlSettings(
        settings.localSettings.mobileControls
    );
    return settings.localSettings.mobileControls;
}

function updateMobileControlSettings(settings, patch) {
    const current = ensureMobileControls(settings);
    settings.localSettings.mobileControls = normalizeMobileClassicControlSettings({
        ...current,
        ...patch,
    });
    return settings.localSettings.mobileControls;
}

/** Tilt steering controls of the mobile classic surface. */
export function bindMenuMobileTiltControls({
    ui,
    settings,
    bind,
    emitSettingsChangedImmediate,
    queueInputSettingsChanged,
    keys,
}) {
    const update = (patch) => updateMobileControlSettings(settings, patch);

    if (ui.mobileTiltSensitivitySlider) {
        bind(ui.mobileTiltSensitivitySlider, 'input', () => {
            const percent = clamp(
                parseInt(ui.mobileTiltSensitivitySlider.value, 10),
                Math.round(MOBILE_CLASSIC_TILT_SENSITIVITY_LIMITS.min * 100),
                Math.round(MOBILE_CLASSIC_TILT_SENSITIVITY_LIMITS.max * 100)
            );
            update({ tiltSensitivity: percent / 100 });
            queueInputSettingsChanged([keys.LOCAL_MOBILE_TILT_SENSITIVITY]);
        });
    }

    if (ui.mobileTiltAssistSelect) {
        bind(ui.mobileTiltAssistSelect, 'change', () => {
            update({ tiltAssistMode: ui.mobileTiltAssistSelect.value });
            emitSettingsChangedImmediate([keys.LOCAL_MOBILE_TILT_ASSIST_MODE]);
        });
    }

    if (ui.mobileTiltPitchModeSelect) {
        bind(ui.mobileTiltPitchModeSelect, 'change', () => {
            update({ tiltPitchMode: ui.mobileTiltPitchModeSelect.value });
            emitSettingsChangedImmediate([keys.LOCAL_MOBILE_TILT_PITCH_MODE]);
        });
    }

    if (ui.mobileTiltDebugToggle) {
        bind(ui.mobileTiltDebugToggle, 'change', () => {
            update({ tiltDebugVisible: !!ui.mobileTiltDebugToggle.checked });
            emitSettingsChangedImmediate([keys.LOCAL_MOBILE_TILT_DEBUG_VISIBLE]);
        });
    }

    if (ui.mobileTiltSensorHzToggle) {
        bind(ui.mobileTiltSensorHzToggle, 'change', () => {
            update({ tiltSensorHzVisible: !!ui.mobileTiltSensorHzToggle.checked });
            emitSettingsChangedImmediate([keys.LOCAL_MOBILE_TILT_SENSOR_HZ_VISIBLE]);
        });
    }
}

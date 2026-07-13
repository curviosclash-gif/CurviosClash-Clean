import {
    CAMERA_PERSPECTIVE_MODE,
    createDefaultCameraPerspectiveSettings,
} from '../../shared/contracts/CameraPerspectiveContract.js';
import {
    createDefaultRecordingCaptureSettings,
    RECORDING_CAPTURE_PROFILE,
    RECORDING_HUD_MODE,
} from '../../shared/contracts/RecordingCaptureContract.js';
import {
    readCameraPerspectiveIntensityFromSlider,
    resolveNormalCameraPerspectiveLabel,
    resolveRecordingHudLabel,
    resolveRecordingProfileLabel,
} from './MenuRecordingCameraBindingOps.js';

function ensureRecordingSettings(settings) {
    if (!settings.recording || typeof settings.recording !== 'object') {
        settings.recording = createDefaultRecordingCaptureSettings();
    }
    return settings.recording;
}

function ensureCameraPerspectiveSettings(settings) {
    if (!settings.cameraPerspective || typeof settings.cameraPerspective !== 'object') {
        settings.cameraPerspective = createDefaultCameraPerspectiveSettings();
    }
    return settings.cameraPerspective;
}

export function bindMenuRecordingCameraControls({
    ui,
    settings,
    bind,
    emit,
    emitSettingsChangedImmediate,
    queueInputSettingsChanged,
    eventTypes,
    keys,
}) {
    if (ui.recordingProfileSelect) {
        bind(ui.recordingProfileSelect, 'change', () => {
            const recordingSettings = ensureRecordingSettings(settings);
            const profile = String(ui.recordingProfileSelect.value || '').trim().toLowerCase();
            recordingSettings.profile = profile === RECORDING_CAPTURE_PROFILE.YOUTUBE_SHORT
                ? RECORDING_CAPTURE_PROFILE.YOUTUBE_SHORT
                : RECORDING_CAPTURE_PROFILE.STANDARD;
            emitSettingsChangedImmediate([keys.RECORDING_PROFILE]);
            emit(eventTypes.SHOW_STATUS_TOAST, {
                message: `Recording-Profil: ${resolveRecordingProfileLabel(recordingSettings.profile)} (${resolveRecordingHudLabel(recordingSettings.hudMode)})`,
                duration: 1300,
                tone: 'info',
            });
        });
    }
    if (ui.recordingHudModeSelect) {
        bind(ui.recordingHudModeSelect, 'change', () => {
            const recordingSettings = ensureRecordingSettings(settings);
            const hudMode = String(ui.recordingHudModeSelect.value || '').trim().toLowerCase();
            recordingSettings.hudMode = hudMode === RECORDING_HUD_MODE.WITH_HUD
                ? RECORDING_HUD_MODE.WITH_HUD
                : RECORDING_HUD_MODE.CLEAN;
            emitSettingsChangedImmediate([keys.RECORDING_HUD_MODE]);
            emit(eventTypes.SHOW_STATUS_TOAST, {
                message: `Recording-HUD: ${resolveRecordingHudLabel(recordingSettings.hudMode)}`,
                duration: 1300,
                tone: 'info',
            });
        });
    }
    if (ui.normalCameraPerspectiveSelect) {
        bind(ui.normalCameraPerspectiveSelect, 'change', () => {
            const cameraPerspectiveSettings = ensureCameraPerspectiveSettings(settings);
            const perspective = String(ui.normalCameraPerspectiveSelect.value || '').trim().toLowerCase();
            if (perspective === CAMERA_PERSPECTIVE_MODE.CINEMATIC_SOFT) {
                cameraPerspectiveSettings.normal = CAMERA_PERSPECTIVE_MODE.CINEMATIC_SOFT;
            } else if (perspective === CAMERA_PERSPECTIVE_MODE.CINEMATIC_ACTION) {
                cameraPerspectiveSettings.normal = CAMERA_PERSPECTIVE_MODE.CINEMATIC_ACTION;
            } else {
                cameraPerspectiveSettings.normal = CAMERA_PERSPECTIVE_MODE.CLASSIC;
            }
            emitSettingsChangedImmediate([keys.CAMERA_PERSPECTIVE_NORMAL]);
            emit(eventTypes.SHOW_STATUS_TOAST, {
                message: `Video-Perspektive: ${resolveNormalCameraPerspectiveLabel(cameraPerspectiveSettings.normal)}`,
                duration: 1300,
                tone: 'info',
            });
        });
    }
    if (ui.normalCameraReduceMotionToggle) {
        bind(ui.normalCameraReduceMotionToggle, 'change', () => {
            const cameraPerspectiveSettings = ensureCameraPerspectiveSettings(settings);
            cameraPerspectiveSettings.reduceMotion = !!ui.normalCameraReduceMotionToggle.checked;
            emitSettingsChangedImmediate([keys.CAMERA_PERSPECTIVE_REDUCE_MOTION]);
            emit(eventTypes.SHOW_STATUS_TOAST, {
                message: cameraPerspectiveSettings.reduceMotion
                    ? 'Video-Perspektive: beruhigt'
                    : 'Video-Perspektive: dynamisch',
                duration: 1300,
                tone: 'info',
            });
        });
    }
    if (ui.normalCameraSpeedFovToggle) {
        bind(ui.normalCameraSpeedFovToggle, 'change', () => {
            const cameraPerspectiveSettings = ensureCameraPerspectiveSettings(settings);
            cameraPerspectiveSettings.speedFovEnabled = !!ui.normalCameraSpeedFovToggle.checked;
            emitSettingsChangedImmediate([keys.CAMERA_PERSPECTIVE_SPEED_FOV_ENABLED]);
        });
    }
    if (ui.normalCameraSpeedFovIntensitySlider) {
        bind(ui.normalCameraSpeedFovIntensitySlider, 'input', () => {
            const cameraPerspectiveSettings = ensureCameraPerspectiveSettings(settings);
            cameraPerspectiveSettings.speedFovIntensity = readCameraPerspectiveIntensityFromSlider(
                ui.normalCameraSpeedFovIntensitySlider,
                cameraPerspectiveSettings.speedFovIntensity
            );
            queueInputSettingsChanged([keys.CAMERA_PERSPECTIVE_SPEED_FOV_INTENSITY]);
        });
    }
    if (ui.normalCameraThrusterExhaustToggle) {
        bind(ui.normalCameraThrusterExhaustToggle, 'change', () => {
            const cameraPerspectiveSettings = ensureCameraPerspectiveSettings(settings);
            cameraPerspectiveSettings.thrusterExhaustEnabled = !!ui.normalCameraThrusterExhaustToggle.checked;
            emitSettingsChangedImmediate([keys.CAMERA_PERSPECTIVE_THRUSTER_EXHAUST_ENABLED]);
        });
    }
    if (ui.normalCameraThrusterExhaustIntensitySlider) {
        bind(ui.normalCameraThrusterExhaustIntensitySlider, 'input', () => {
            const cameraPerspectiveSettings = ensureCameraPerspectiveSettings(settings);
            cameraPerspectiveSettings.thrusterExhaustIntensity = readCameraPerspectiveIntensityFromSlider(
                ui.normalCameraThrusterExhaustIntensitySlider,
                cameraPerspectiveSettings.thrusterExhaustIntensity
            );
            queueInputSettingsChanged([keys.CAMERA_PERSPECTIVE_THRUSTER_EXHAUST_INTENSITY]);
        });
    }
}

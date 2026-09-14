import {
    CAMERA_PERSPECTIVE_MODE,
    createDefaultCameraPerspectiveSettings,
} from '../../shared/contracts/CameraPerspectiveContract.js';
import {
    createDefaultRecordingCaptureSettings,
    normalizeRecordingCaptureOrientation,
    RECORDING_CAPTURE_PROFILE,
    RECORDING_HUD_MODE,
} from '../../shared/contracts/RecordingCaptureContract.js';
import {
    readCameraPerspectiveIntensityFromSlider,
    resolveNormalCameraPerspectiveLabel,
    resolveRecordingHudLabel,
    resolveRecordingOrientationLabel,
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

function formatReplayDuration(durationMs) {
    const totalSeconds = Math.max(0, Math.round(Number(durationMs || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatReplayTimestamp(timestamp) {
    const date = new Date(Number(timestamp || 0));
    if (!Number.isFinite(date.getTime())) return 'Unbekannte Zeit';
    return date.toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatReplayRecordingLabel(recording) {
    const sizeMb = Math.max(0, Number(recording?.estimatedBytes || 0)) / (1024 * 1024);
    const partialLabel = recording?.partial === true ? ' · unvollständig' : '';
    return `${formatReplayTimestamp(recording?.startedAt)} · ${formatReplayDuration(recording?.durationMs)} · ${sizeMb.toFixed(1)} MB${partialLabel}`;
}

function syncReplayLibraryControls(ui, recordings, selectedRecordingId = '') {
    const select = ui.cinematicReplayRecordingSelect;
    const renderButton = ui.cinematicReplayRenderButton;
    const discardButton = ui.cinematicReplayDiscardButton;
    const hint = ui.cinematicReplayLibraryHint;
    const list = Array.isArray(recordings) ? recordings : [];
    const preferredId = String(selectedRecordingId || select?.value || '').trim();
    if (select) {
        const doc = select.ownerDocument || document;
        select.replaceChildren();
        if (list.length === 0) {
            const option = doc.createElement('option');
            option.value = '';
            option.textContent = 'Keine Aufnahmen vorhanden';
            select.appendChild(option);
        } else {
            for (const recording of list) {
                const option = doc.createElement('option');
                option.value = String(recording.recordingId || '');
                option.textContent = formatReplayRecordingLabel(recording);
                select.appendChild(option);
            }
            if (list.some((recording) => recording.recordingId === preferredId)) {
                select.value = preferredId;
            }
        }
        select.disabled = list.length === 0;
    }
    const hasSelection = list.length > 0 && !!select?.value;
    if (renderButton) renderButton.disabled = !hasSelection;
    if (discardButton) discardButton.disabled = !hasSelection;
    if (hint) {
        const totalBytes = list.reduce(
            (sum, recording) => sum + Math.max(0, Number(recording?.estimatedBytes || 0)),
            0
        );
        hint.textContent = list.length === 0
            ? 'F9 beendet die Aufnahme und legt sie hier zum späteren Rendern ab.'
            : `${list.length} Aufnahme${list.length === 1 ? '' : 'n'} bereit · ${(totalBytes / (1024 * 1024)).toFixed(1)} MB`;
    }
}

export function bindMenuRecordingCameraControls({
    ui,
    settings,
    runtimeAccess,
    bind,
    registerDisposer,
    emit,
    emitSettingsChangedImmediate,
    queueInputSettingsChanged,
    eventTypes,
    settingsChangeKeys: keys,
}) {
    if (ui.recordingProfileSelect) {
        if (!ui.recordingProfileSelect.querySelector?.(`option[value="${RECORDING_CAPTURE_PROFILE.CINEMATIC}"]`)) {
            const option = document.createElement('option');
            option.value = RECORDING_CAPTURE_PROFILE.CINEMATIC;
            option.textContent = 'Cinematic Replay Render (MP4)';
            ui.recordingProfileSelect.appendChild(option);
        }
        bind(ui.recordingProfileSelect, 'change', () => {
            const recordingSettings = ensureRecordingSettings(settings);
            const profile = String(ui.recordingProfileSelect.value || '').trim().toLowerCase();
            if (profile === RECORDING_CAPTURE_PROFILE.CINEMATIC) {
                recordingSettings.profile = RECORDING_CAPTURE_PROFILE.CINEMATIC;
            } else if (profile === RECORDING_CAPTURE_PROFILE.YOUTUBE_SHORT) {
                recordingSettings.profile = RECORDING_CAPTURE_PROFILE.YOUTUBE_SHORT;
            } else {
                recordingSettings.profile = RECORDING_CAPTURE_PROFILE.STANDARD;
            }
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
    if (ui.recordingOrientationSelect) {
        bind(ui.recordingOrientationSelect, 'change', () => {
            const recordingSettings = ensureRecordingSettings(settings);
            recordingSettings.orientation = normalizeRecordingCaptureOrientation(
                ui.recordingOrientationSelect.value,
                recordingSettings.orientation
            );
            emitSettingsChangedImmediate([keys.RECORDING_ORIENTATION]);
            emit(eventTypes.SHOW_STATUS_TOAST, {
                message: `Cinematic-Format: ${resolveRecordingOrientationLabel(recordingSettings.orientation)}`,
                duration: 1300,
                tone: 'info',
            });
        });
    }
    const refreshReplayLibrary = (recordings = undefined) => {
        const selectedRecordingId = ui.cinematicReplayRecordingSelect?.value || '';
        const nextRecordings = Array.isArray(recordings)
            ? recordings
            : (runtimeAccess?.listCinematicReplayRecordings?.() || []);
        syncReplayLibraryControls(ui, nextRecordings, selectedRecordingId);
    };
    if (ui.cinematicReplayRecordingSelect) {
        bind(ui.cinematicReplayRecordingSelect, 'change', () => refreshReplayLibrary());
    }
    if (ui.cinematicReplayRenderButton) {
        bind(ui.cinematicReplayRenderButton, 'click', async () => {
            const recordingId = String(ui.cinematicReplayRecordingSelect?.value || '').trim();
            if (!recordingId) return;
            ui.cinematicReplayRecordingSelect.disabled = true;
            ui.cinematicReplayRenderButton.disabled = true;
            if (ui.cinematicReplayDiscardButton) ui.cinematicReplayDiscardButton.disabled = true;
            emit(eventTypes.SHOW_STATUS_TOAST, {
                message: 'Cinematic-Aufnahme wird zum Rendern vorbereitet...',
                duration: 1600,
                tone: 'info',
            });
            try {
                const result = await runtimeAccess?.renderCinematicReplayRecording?.(recordingId);
                if (result?.saved === true) {
                    emit(eventTypes.SHOW_STATUS_TOAST, {
                        message: 'Cinematic-Video wurde erfolgreich gerendert',
                        duration: 2600,
                        tone: 'success',
                    });
                } else if (result?.cancelled === true) {
                    emit(eventTypes.SHOW_STATUS_TOAST, {
                        message: 'Rendern abgebrochen – die Aufnahme bleibt in der Liste',
                        duration: 2400,
                        tone: 'warning',
                    });
                } else {
                    const detail = String(result?.message || result?.reason || '').trim();
                    emit(eventTypes.SHOW_STATUS_TOAST, {
                        message: 'Rendern fehlgeschlagen – die Aufnahme bleibt in der Liste',
                        duration: 2600,
                        ...(detail ? {
                            message: `Rendern fehlgeschlagen: ${detail}`,
                            duration: 4200,
                        } : {}),
                        tone: 'error',
                    });
                }
            } catch {
                emit(eventTypes.SHOW_STATUS_TOAST, {
                    message: 'Rendern fehlgeschlagen – die Aufnahme bleibt in der Liste',
                    duration: 2600,
                    tone: 'error',
                });
            } finally {
                refreshReplayLibrary();
            }
        });
    }
    if (ui.cinematicReplayDiscardButton) {
        bind(ui.cinematicReplayDiscardButton, 'click', () => {
            const recordingId = String(ui.cinematicReplayRecordingSelect?.value || '').trim();
            if (!recordingId) return;
            const confirmed = globalThis.confirm?.(
                'Diese ungerenderte Cinematic-Aufnahme wirklich entfernen?'
            );
            if (confirmed === false) return;
            const result = runtimeAccess?.discardCinematicReplayRecording?.(recordingId);
            emit(eventTypes.SHOW_STATUS_TOAST, {
                message: result?.removed === true
                    ? 'Cinematic-Aufnahme entfernt'
                    : 'Cinematic-Aufnahme konnte nicht entfernt werden',
                duration: 1800,
                tone: result?.removed === true ? 'info' : 'error',
            });
            refreshReplayLibrary();
        });
    }
    refreshReplayLibrary();
    registerDisposer?.(runtimeAccess?.subscribeCinematicReplayRecordings?.(refreshReplayLibrary));
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

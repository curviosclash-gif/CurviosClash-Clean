import {
    buildDeveloperTrainingAutoStepPayload,
    buildDeveloperTrainingRunBatchPayload,
    buildDeveloperTrainingRunEvalPayload,
    buildDeveloperTrainingRunGatePayload,
    buildDeveloperTrainingResetPayload,
    buildDeveloperTrainingStepPayload,
} from './MenuDeveloperTrainingEventPayload.js';

export function setupMenuDevPanelBindings(ctx) {
    const ui = ctx.ui;
    const emit = ctx.emit;
    const eventTypes = ctx.eventTypes;
    const bind = ctx.bind;

    const emitPresetAction = (type, extraPayload = null) => {
        const payload = extraPayload && typeof extraPayload === 'object' ? extraPayload : {};
        emit(type, payload);
    };

    if (Array.isArray(ui.quickstartPresetButtons)) {
        ui.quickstartPresetButtons.forEach((button) => {
            bind(button, 'click', () => {
                const presetId = String(button?.dataset?.presetId || '').trim();
                if (!presetId) return;
                emitPresetAction(eventTypes.PRESET_APPLY, {
                    presetId,
                    source: 'quickstart',
                });
            });
        });
    }

    if (ui.presetApplyButton) {
        bind(ui.presetApplyButton, 'click', () => {
            const presetId = String(ui.presetSelect?.value || '').trim();
            if (!presetId) {
                emit(eventTypes.SHOW_STATUS_TOAST, {
                    message: 'Preset auswaehlen, bevor angewendet wird.',
                    tone: 'error',
                    duration: 1700,
                });
                return;
            }
            emitPresetAction(eventTypes.PRESET_APPLY, { presetId, source: 'custom_panel' });
        });
    }

    if (ui.presetSaveOpenButton) {
        bind(ui.presetSaveOpenButton, 'click', () => {
            const presetName = String(ui.presetNameInput?.value || '').trim();
            emitPresetAction(eventTypes.PRESET_SAVE_OPEN, {
                name: presetName,
                sourcePresetId: String(ui.presetSelect?.value || '').trim(),
            });
        });
    }

    if (ui.presetSaveFixedButton) {
        bind(ui.presetSaveFixedButton, 'click', () => {
            const presetName = String(ui.presetNameInput?.value || '').trim();
            emitPresetAction(eventTypes.PRESET_SAVE_FIXED, {
                name: presetName,
                sourcePresetId: String(ui.presetSelect?.value || '').trim(),
            });
        });
    }

    if (ui.presetDeleteButton) {
        bind(ui.presetDeleteButton, 'click', () => {
            const presetId = String(ui.presetSelect?.value || '').trim();
            if (!presetId) {
                emit(eventTypes.SHOW_STATUS_TOAST, {
                    message: 'Kein Preset zum Loeschen ausgewaehlt.',
                    tone: 'error',
                    duration: 1700,
                });
                return;
            }
            emitPresetAction(eventTypes.PRESET_DELETE, { presetId });
        });
    }

    if (ui.multiplayerReadyToggle) {
        bind(ui.multiplayerReadyToggle, 'change', () => {
            emit(eventTypes.MULTIPLAYER_READY_TOGGLE, {
                ready: !!ui.multiplayerReadyToggle.checked,
            });
        });
    }

    if (ui.developerModeToggle) {
        bind(ui.developerModeToggle, 'change', () => {
            emit(eventTypes.DEVELOPER_MODE_TOGGLE, {
                enabled: !!ui.developerModeToggle.checked,
            });
        });
    }

    if (ui.developerThemeSelect) {
        bind(ui.developerThemeSelect, 'change', () => {
            emit(eventTypes.DEVELOPER_THEME_CHANGE, {
                themeId: String(ui.developerThemeSelect.value || '').trim(),
            });
        });
    }

    if (ui.developerVisibilitySelect) {
        bind(ui.developerVisibilitySelect, 'change', () => {
            emit(eventTypes.DEVELOPER_VISIBILITY_CHANGE, {
                mode: String(ui.developerVisibilitySelect.value || '').trim(),
            });
        });
    }

    if (ui.developerFixedPresetLockToggle) {
        bind(ui.developerFixedPresetLockToggle, 'change', () => {
            emit(eventTypes.DEVELOPER_FIXED_PRESET_LOCK_TOGGLE, {
                enabled: !!ui.developerFixedPresetLockToggle.checked,
            });
        });
    }

    if (ui.developerActorSelect) {
        bind(ui.developerActorSelect, 'change', () => {
            emit(eventTypes.DEVELOPER_ACTOR_CHANGE, {
                actorId: String(ui.developerActorSelect.value || '').trim(),
            });
        });
    }

    if (ui.developerReleasePreviewToggle) {
        bind(ui.developerReleasePreviewToggle, 'change', () => {
            emit(eventTypes.DEVELOPER_RELEASE_PREVIEW_TOGGLE, {
                enabled: !!ui.developerReleasePreviewToggle.checked,
            });
        });
    }

    if (ui.developerTextApplyButton) {
        bind(ui.developerTextApplyButton, 'click', () => {
            emit(eventTypes.DEVELOPER_TEXT_OVERRIDE_SET, {
                textId: String(ui.developerTextIdSelect?.value || '').trim(),
                textValue: String(ui.developerTextOverrideInput?.value || ''),
            });
        });
    }

    if (ui.developerTextClearButton) {
        bind(ui.developerTextClearButton, 'click', () => {
            emit(eventTypes.DEVELOPER_TEXT_OVERRIDE_CLEAR, {
                textId: String(ui.developerTextIdSelect?.value || '').trim(),
            });
        });
    }

    if (ui.developerTrainingResetButton) {
        bind(ui.developerTrainingResetButton, 'click', () => {
            emit(eventTypes.DEVELOPER_TRAINING_RESET, buildDeveloperTrainingResetPayload(ui));
        });
    }

    if (ui.developerTrainingStepButton) {
        bind(ui.developerTrainingStepButton, 'click', () => {
            emit(eventTypes.DEVELOPER_TRAINING_STEP, buildDeveloperTrainingStepPayload(ui));
        });
    }

    if (ui.developerTrainingAutoStepButton) {
        bind(ui.developerTrainingAutoStepButton, 'click', () => {
            emit(eventTypes.DEVELOPER_TRAINING_AUTO_STEP, buildDeveloperTrainingAutoStepPayload(ui));
        });
    }

    if (ui.developerTrainingRunBatchButton) {
        bind(ui.developerTrainingRunBatchButton, 'click', () => {
            emit(eventTypes.DEVELOPER_TRAINING_RUN_BATCH, buildDeveloperTrainingRunBatchPayload(ui));
        });
    }

    if (ui.developerTrainingRunEvalButton) {
        bind(ui.developerTrainingRunEvalButton, 'click', () => {
            emit(eventTypes.DEVELOPER_TRAINING_RUN_EVAL, buildDeveloperTrainingRunEvalPayload(ui));
        });
    }

    if (ui.developerTrainingRunGateButton) {
        bind(ui.developerTrainingRunGateButton, 'click', () => {
            emit(eventTypes.DEVELOPER_TRAINING_RUN_GATE, buildDeveloperTrainingRunGatePayload(ui));
        });
    }
}

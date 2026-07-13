export function setupMenuProfileBindings(ctx) {
    const ui = ctx.ui;
    const emit = ctx.emit;
    const eventTypes = ctx.eventTypes;
    const bind = ctx.bind;

    const emitProfileUiSync = (fullRefresh = false) => {
        emit(eventTypes.PROFILE_UI_STATE_SYNC, { fullRefresh });
    };

    if (ui.profileNameInput) {
        bind(ui.profileNameInput, 'input', () => emitProfileUiSync(false));
    }
    if (ui.profileSelect) {
        bind(ui.profileSelect, 'change', () => emit(eventTypes.PROFILE_UI_STATE_SYNC, {
            fullRefresh: true,
            selectedName: ui.profileSelect?.value || '',
        }));
    }
    if (ui.profileTransferInput) {
        bind(ui.profileTransferInput, 'input', () => emitProfileUiSync(false));
    }

    if (ui.profileSaveButton) {
        bind(ui.profileSaveButton, 'click', () => {
            emit(eventTypes.SAVE_PROFILE, {
                name: ui.profileNameInput?.value || '',
            });
        });
    }
    if (ui.profileLoadButton) {
        bind(ui.profileLoadButton, 'click', () => {
            emit(eventTypes.LOAD_PROFILE, {
                name: ui.profileSelect?.value || '',
            });
        });
    }
    if (ui.profileDeleteButton) {
        bind(ui.profileDeleteButton, 'click', () => {
            emit(eventTypes.DELETE_PROFILE, {
                name: ui.profileSelect?.value || '',
            });
        });
    }
    if (ui.profileDuplicateButton) {
        bind(ui.profileDuplicateButton, 'click', () => {
            emit(eventTypes.DUPLICATE_PROFILE, {
                sourceName: ui.profileSelect?.value || '',
                targetName: ui.profileNameInput?.value || '',
            });
        });
    }
    if (ui.profileExportButton) {
        bind(ui.profileExportButton, 'click', () => {
            emit(eventTypes.EXPORT_PROFILE, {
                name: ui.profileSelect?.value || '',
            });
        });
    }
    if (ui.profileImportButton) {
        bind(ui.profileImportButton, 'click', () => {
            emit(eventTypes.IMPORT_PROFILE, {
                inputValue: ui.profileTransferInput?.value || '',
                targetName: ui.profileNameInput?.value || '',
            });
        });
    }
    if (ui.profileDefaultButton) {
        bind(ui.profileDefaultButton, 'click', () => {
            emit(eventTypes.SET_DEFAULT_PROFILE, {
                name: ui.profileSelect?.value || '',
            });
        });
    }
}

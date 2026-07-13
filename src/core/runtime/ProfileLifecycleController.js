export class ProfileLifecycleController {
    constructor({ game = null } = {}) {
        this._game = game || null;
    }

    _getProfileUiController() {
        return this._game?.profileUiController || null;
    }

    _syncGameProfileAliases() {
        const game = this._game;
        const profileUiController = this._getProfileUiController();
        if (!game || !profileUiController) return;
        game.activeProfileName = profileUiController.activeProfileName;
        game.selectedProfileName = profileUiController.selectedProfileName;
    }

    syncProfileUiState(event = null) {
        const game = this._game;
        const profileUiController = this._getProfileUiController();
        if (!game || !profileUiController) return;
        if (typeof event?.selectedName === 'string') {
            profileUiController.selectedProfileName = event.selectedName;
            game.selectedProfileName = event.selectedName;
        }
        if (event?.fullRefresh) {
            profileUiController.syncProfileControls({
                forceMirrorProfileNameInput: true,
                preferredProfileName: event.selectedName,
            });
            this._syncGameProfileAliases();
            return;
        }
        profileUiController.syncProfileActionState();
        this._syncGameProfileAliases();
    }

    saveProfile(event = null) {
        const result = this._getProfileUiController()?.saveProfile?.(event?.name) ?? false;
        this._syncGameProfileAliases();
        return result;
    }

    loadProfile(event = null) {
        const result = this._getProfileUiController()?.loadProfile?.(event?.name) ?? false;
        this._syncGameProfileAliases();
        return result;
    }

    deleteProfile(event = null) {
        const result = this._getProfileUiController()?.deleteProfile?.(event?.name) ?? false;
        this._syncGameProfileAliases();
        return result;
    }

    duplicateProfile(event = null) {
        const result = this._getProfileUiController()?.duplicateProfile?.(event?.sourceName, event?.targetName) ?? false;
        this._syncGameProfileAliases();
        return result;
    }

    exportProfile(event = null) {
        const result = this._getProfileUiController()?.exportProfile?.(event?.name) ?? false;
        this._syncGameProfileAliases();
        return result;
    }

    importProfile(event = null) {
        const result = this._getProfileUiController()?.importProfile?.(event?.inputValue, event?.targetName) ?? false;
        this._syncGameProfileAliases();
        return result;
    }

    setDefaultProfile(event = null) {
        const result = this._getProfileUiController()?.setDefaultProfile?.(event?.name) ?? false;
        this._syncGameProfileAliases();
        return result;
    }
}

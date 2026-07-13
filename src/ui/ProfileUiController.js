// ============================================
// ProfileUiController.js - profile management UI controller
// ============================================

import { deriveProfileControlSelectState } from './ProfileControlStateOps.js';
import { deriveProfileActionUiState } from './ProfileUiStateOps.js';
import { renderProfileSelectOptions } from './dom/ProfileSelectDom.js';

export class ProfileUiController {
    /**
     * @param {{
     *   profileManager: object,
     *   settingsManager: object,
     *   getUi: () => object,
     *   getUiManager: () => object|null,
     *   getSettings: () => object,
     *   setSettings: (s: object) => void,
     *   showStatusToast: (msg: string, ms: number, tone: string) => void,
     *   onSettingsChanged: () => void,
     *   markSettingsDirty: (dirty: boolean) => void,
     *   profileDataOps: object,
     *   profileUiStateOps: object,
     *   profileControlStateOps: object,
     * }} deps
     */
    constructor(deps) {
        this._profileManager = deps.profileManager;
        this._settingsManager = deps.settingsManager;
        this._getUi = deps.getUi;
        this._getUiManager = deps.getUiManager;
        this._getSettings = deps.getSettings;
        this._setSettings = deps.setSettings;
        this._showStatusToast = deps.showStatusToast;
        this._onSettingsChanged = deps.onSettingsChanged;
        this._markSettingsDirty = deps.markSettingsDirty;
        this._profileControlStateOps = deps.profileControlStateOps;
        this._profileUiStateOps = deps.profileUiStateOps;

        this.settingsProfiles = this._profileManager.getProfiles();
        this.activeProfileName = this._profileManager.getActiveProfileName();
        this.selectedProfileName = this.activeProfileName;
        this.loadedProfileName = '';
    }

    syncProfileControls(options = {}) {
        const ui = this._getUi();
        if (!ui.profileSelect) return;
        const forceMirrorProfileNameInput = options.forceMirrorProfileNameInput === true;
        const preferredProfileName = typeof options.preferredProfileName === 'string'
            ? options.preferredProfileName
            : '';

        const controlState = deriveProfileControlSelectState(
            this.settingsProfiles,
            {
                activeProfileName: preferredProfileName || this.selectedProfileName || this.activeProfileName,
                selectValue: ui.profileSelect.value,
                isProfileNameInputFocused: ui.profileNameInput
                    ? document.activeElement?.isSameNode(ui.profileNameInput)
                    : false,
            },
            this._profileControlStateOps
        );
        renderProfileSelectOptions(ui.profileSelect, controlState);

        const validSelected = controlState.resolvedActiveProfileName;
        this.selectedProfileName = validSelected;
        this.activeProfileName = validSelected;

        if (ui.profileNameInput && (forceMirrorProfileNameInput || controlState.shouldMirrorProfileNameInput)) {
            ui.profileNameInput.value = validSelected;
        }
        this.syncProfileActionState();
    }

    syncProfileActionState() {
        const ui = this._getUi();
        const effectiveLoadedProfileName = this._profileManager.findProfileByName(this.loadedProfileName || '')?.name || '';
        const actionState = deriveProfileActionUiState(
            this.settingsProfiles,
            {
                selectedProfileName: ui.profileSelect?.value || this.activeProfileName || '',
                typedName: ui.profileNameInput?.value || '',
                activeProfileName: effectiveLoadedProfileName,
                transferInputValue: ui.profileTransferInput?.value || '',
            },
            this._profileUiStateOps
        );

        if (ui.profileLoadButton) {
            ui.profileLoadButton.disabled = !actionState.canLoadProfile;
        }
        if (ui.profileDeleteButton) {
            ui.profileDeleteButton.disabled = !actionState.canDeleteProfile;
        }
        if (ui.profileDuplicateButton) {
            ui.profileDuplicateButton.disabled = !actionState.canDuplicateProfile;
        }
        if (ui.profileDefaultButton) {
            ui.profileDefaultButton.disabled = !actionState.canSetDefaultProfile;
            ui.profileDefaultButton.textContent = actionState.defaultButtonLabel;
        }
        if (ui.profileExportButton) {
            ui.profileExportButton.disabled = !actionState.canExportProfile;
        }
        if (ui.profileImportButton) {
            ui.profileImportButton.disabled = !actionState.canImportProfile;
        }
        if (ui.profileSaveButton) {
            ui.profileSaveButton.disabled = !actionState.canSaveProfile;
            ui.profileSaveButton.textContent = actionState.saveButtonLabel;
        }
        this._getUiManager()?.updateContext();
    }

    setProfileTransferStatus(message, tone = 'info') {
        const ui = this._getUi();
        if (!ui.profileTransferStatus) return;
        ui.profileTransferStatus.textContent = String(message || '');
        ui.profileTransferStatus.setAttribute('data-tone', tone);
    }

    saveProfile(profileName) {
        const result = this._profileManager.saveProfile(profileName, this._getSettings(), this.loadedProfileName);
        if (!result.success) {
            this._showStatusToast(result.error, 2000, 'error');
            return false;
        }

        this.settingsProfiles = this._profileManager.getProfiles();
        this.activeProfileName = this._profileManager.getActiveProfileName();
        this.selectedProfileName = this.activeProfileName;
        this.loadedProfileName = result.name;

        const ui = this._getUi();
        if (ui.profileNameInput) {
            ui.profileNameInput.value = result.name;
        }

        this.syncProfileControls();

        this._showStatusToast(
            result.isUpdate ? `Profil aktualisiert: ${result.name}` : `Profil gespeichert: ${result.name}`,
            1500,
            'success'
        );
        return true;
    }

    duplicateProfile(sourceProfileName, targetProfileName = '') {
        const result = this._profileManager.duplicateProfile(sourceProfileName, targetProfileName);
        if (!result.success) {
            this._showStatusToast(result.error, 1800, 'error');
            return false;
        }

        this.settingsProfiles = this._profileManager.getProfiles();
        this.activeProfileName = this._profileManager.getActiveProfileName();
        this.selectedProfileName = this.activeProfileName;

        const ui = this._getUi();
        if (ui.profileNameInput) {
            ui.profileNameInput.value = result.name;
        }

        this.syncProfileControls();
        this._showStatusToast(`Profil dupliziert: ${result.name}`, 1500, 'success');
        return true;
    }

    loadProfile(profileName) {
        const result = this._profileManager.loadProfile(profileName);
        if (!result.success) {
            this._showStatusToast(result.error, 1500, 'error');
            return false;
        }

        this._setSettings(result.profile.settings);
        this.activeProfileName = this._profileManager.getActiveProfileName();
        this.selectedProfileName = this.activeProfileName;
        this.loadedProfileName = result.profile.name;
        this._onSettingsChanged();
        this._markSettingsDirty(false);
        this._showStatusToast(`Profil geladen: ${result.profile.name}`, 1400, 'success');
        return true;
    }

    exportProfile(profileName) {
        const result = this._profileManager.exportProfile(profileName);
        if (!result.success) {
            this.setProfileTransferStatus(result.error, 'error');
            this._showStatusToast(result.error, 1700, 'error');
            return false;
        }

        const ui = this._getUi();
        if (ui.profileTransferInput) {
            ui.profileTransferInput.value = result.serialized;
        }

        const exportMessage = String(result.message || `Profil exportiert: ${result.name}`);
        const exportTone = String(result.tone || 'success');
        this.setProfileTransferStatus(exportMessage, exportTone);
        this.syncProfileActionState();
        this._showStatusToast(exportMessage, 1400, exportTone);
        return true;
    }

    importProfile(inputValue, requestedProfileName = '') {
        const result = this._profileManager.importProfile(inputValue, requestedProfileName);
        if (!result.success) {
            this.setProfileTransferStatus(result.error, 'error');
            this._showStatusToast(result.error, 1800, 'error');
            return false;
        }

        this.settingsProfiles = this._profileManager.getProfiles();
        this.activeProfileName = this._profileManager.getActiveProfileName();
        this.selectedProfileName = this.activeProfileName;

        const ui = this._getUi();
        if (ui.profileNameInput) {
            ui.profileNameInput.value = result.name;
        }
        if (ui.profileTransferInput) {
            ui.profileTransferInput.value = result.serialized;
        }

        this.syncProfileControls();
        const importMessage = String(
            result.message
            || (result.usedLegacyFallback ? 'Legacy-Profil importiert und normalisiert.' : `Profil importiert: ${result.name}`)
        );
        const importTone = String(result.tone || (result.usedLegacyFallback ? 'warning' : 'success'));
        this.setProfileTransferStatus(importMessage, importTone);
        this._showStatusToast(importMessage, result.usedLegacyFallback ? 2200 : 1500, importTone);
        if (Array.isArray(result.warnings) && result.warnings.length > 0) {
            this._showStatusToast(result.warnings[0], 2800, 'warning');
        }
        return true;
    }

    setDefaultProfile(profileName) {
        const result = this._profileManager.setDefaultProfile(profileName);
        if (!result.success) {
            this._showStatusToast(result.error, 1700, 'error');
            return false;
        }

        this.settingsProfiles = this._profileManager.getProfiles();
        this.activeProfileName = this._profileManager.getActiveProfileName();
        this.selectedProfileName = this.activeProfileName;
        this.syncProfileControls();

        this._showStatusToast(`Standardprofil gesetzt: ${result.name}`, 1500, 'success');
        return true;
    }

    deleteProfile(profileName) {
        const result = this._profileManager.deleteProfile(profileName);
        if (!result.success) {
            this._showStatusToast(result.error, 1700, 'error');
            return false;
        }

        this.settingsProfiles = this._profileManager.getProfiles();
        this.activeProfileName = this._profileManager.getActiveProfileName();
        this.selectedProfileName = this.activeProfileName;
        if (this.loadedProfileName && this._profileManager.normalizeProfileName(this.loadedProfileName) === this._profileManager.normalizeProfileName(result.removedName)) {
            this.loadedProfileName = '';
        }
        this.syncProfileControls();

        this._showStatusToast(`Profil geloescht: ${result.removedName}`, 1400, 'success');
        return true;
    }
}

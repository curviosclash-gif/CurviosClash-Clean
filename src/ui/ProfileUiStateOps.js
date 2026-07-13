// ============================================
// ProfileUiStateOps.js - pure profile UI decision helpers
// ============================================

function ensureArray(profiles) {
    return Array.isArray(profiles) ? profiles : [];
}

function requireCallback(fn, name) {
    if (typeof fn !== 'function') {
        throw new TypeError(`${name} callback is required`);
    }
    return fn;
}

function getSaveButtonLabel({ typedName, canUpdateActive, typedProfileIdx }) {
    if (!typedName) {
        return 'Profil unter Namen speichern';
    }
    if (canUpdateActive) {
        return 'Aktives Profil aktualisieren';
    }
    if (typedProfileIdx >= 0) {
        return 'Name bereits vergeben';
    }
    return 'Neues Profil speichern';
}

export function deriveProfileActionUiState(profiles, inputs = {}, options = {}) {
    const normalizeProfileName = requireCallback(options.normalizeProfileName, 'normalizeProfileName');
    const findProfileByName = requireCallback(options.findProfileByName, 'findProfileByName');
    const findProfileIndexByName = requireCallback(options.findProfileIndexByName, 'findProfileIndexByName');

    const safeProfiles = ensureArray(profiles);
    const selectedName = normalizeProfileName(inputs.selectedProfileName || inputs.activeProfileName || '');
    const typedName = normalizeProfileName(inputs.typedName || '');
    const activeProfileName = normalizeProfileName(inputs.activeProfileName || '');
    const transferInputValue = String(inputs.transferInputValue || '').trim();

    const selectedProfile = findProfileByName(safeProfiles, selectedName) || null;
    const typedProfileIdx = findProfileIndexByName(safeProfiles, typedName);
    const activeProfileIdx = findProfileIndexByName(safeProfiles, activeProfileName);
    const canUpdateActive = Boolean(typedName) && typedProfileIdx >= 0 && typedProfileIdx === activeProfileIdx;

    return {
        selectedProfile,
        typedName,
        typedProfileIdx,
        activeProfileIdx,
        canUpdateActive,
        canLoadProfile: Boolean(selectedProfile),
        canDeleteProfile: Boolean(selectedProfile),
        canDuplicateProfile: Boolean(selectedProfile),
        canExportProfile: Boolean(selectedProfile),
        canImportProfile: Boolean(transferInputValue),
        canSetDefaultProfile: Boolean(selectedProfile) && !selectedProfile.isDefault,
        canSaveProfile: Boolean(typedName),
        defaultButtonLabel: selectedProfile?.isDefault ? 'Standardprofil aktiv' : 'Als Standard markieren',
        saveButtonLabel: getSaveButtonLabel({ typedName, canUpdateActive, typedProfileIdx }),
    };
}

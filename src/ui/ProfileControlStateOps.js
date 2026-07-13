// ============================================
// ProfileControlStateOps.js - pure profile select/control data helpers
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

export function deriveProfileControlSelectState(profiles, inputs = {}, options = {}) {
    const normalizeProfileName = requireCallback(options.normalizeProfileName, 'normalizeProfileName');
    const resolveActiveProfileName = requireCallback(options.resolveActiveProfileName, 'resolveActiveProfileName');

    const safeProfiles = ensureArray(profiles);
    const requestedProfileName = normalizeProfileName(inputs.activeProfileName || inputs.selectValue || '');
    const sortedProfiles = [...safeProfiles].sort((a, b) => {
        if (!!a?.isDefault !== !!b?.isDefault) {
            return a?.isDefault ? -1 : 1;
        }
        return Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0);
    });
    const resolvedActiveProfileName = resolveActiveProfileName(safeProfiles, requestedProfileName);

    return {
        sortedProfiles,
        requestedProfileName,
        resolvedActiveProfileName,
        placeholderOption: {
            value: '',
            text: 'Kein Profil gewaehlt',
        },
        profileOptions: sortedProfiles.map((profile) => ({
            value: profile.name,
            text: profile.isDefault ? `${profile.name} (Standard)` : profile.name,
        })),
        shouldMirrorProfileNameInput: !inputs.isProfileNameInputFocused,
    };
}

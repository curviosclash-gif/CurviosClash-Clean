// ============================================
// ProfileDataOps.js - pure profile array operations
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

function cloneSettingsPayload(settings) {
    return JSON.parse(JSON.stringify(settings || {}));
}

export function upsertProfileEntry(profiles, entry, options = {}) {
    const findProfileIndexByName = requireCallback(options.findProfileIndexByName, 'findProfileIndexByName');
    const nextProfiles = [...ensureArray(profiles)];
    const index = findProfileIndexByName(nextProfiles, entry?.name);

    if (index >= 0) {
        nextProfiles[index] = entry;
        return {
            profiles: nextProfiles,
            index,
            replaced: true,
            entry,
        };
    }

    nextProfiles.push(entry);
    return {
        profiles: nextProfiles,
        index: nextProfiles.length - 1,
        replaced: false,
        entry,
    };
}

export function removeProfileByName(profiles, profileName, options = {}) {
    const findProfileIndexByName = requireCallback(options.findProfileIndexByName, 'findProfileIndexByName');
    const sourceProfiles = ensureArray(profiles);
    const index = findProfileIndexByName(sourceProfiles, profileName);
    if (index < 0) {
        return {
            profiles: [...sourceProfiles],
            removedIndex: -1,
            removedProfile: null,
        };
    }

    return {
        profiles: sourceProfiles.filter((_, i) => i !== index),
        removedIndex: index,
        removedProfile: sourceProfiles[index] || null,
    };
}

export function resolveDefaultProfileName(profiles) {
    const defaultProfile = ensureArray(profiles).find((profile) => profile?.isDefault);
    return defaultProfile?.name || '';
}

export function resolveActiveProfileName(profiles, activeProfileName, options = {}) {
    const findProfileByName = requireCallback(options.findProfileByName, 'findProfileByName');
    const profile = findProfileByName(ensureArray(profiles), activeProfileName);
    return profile ? profile.name : resolveDefaultProfileName(profiles);
}

export function resolveUniqueProfileName(profiles, requestedName, options = {}) {
    const normalizeProfileName = requireCallback(options.normalizeProfileName, 'normalizeProfileName');
    const findProfileIndexByName = requireCallback(options.findProfileIndexByName, 'findProfileIndexByName');

    const safeProfiles = ensureArray(profiles);
    const normalizedRequestedName = normalizeProfileName(requestedName || '');
    const fallbackLabel = normalizeProfileName(options.fallbackLabel || 'Profil');
    const baseName = normalizedRequestedName || fallbackLabel;

    if (!baseName) {
        return '';
    }
    if (findProfileIndexByName(safeProfiles, baseName) < 0) {
        return baseName;
    }

    for (let index = 2; index < 1000; index += 1) {
        const candidate = normalizeProfileName(`${baseName} ${index}`);
        if (candidate && findProfileIndexByName(safeProfiles, candidate) < 0) {
            return candidate;
        }
    }

    return '';
}

export function setDefaultProfileByName(profiles, profileName, options = {}) {
    const findProfileIndexByName = requireCallback(options.findProfileIndexByName, 'findProfileIndexByName');
    const safeProfiles = ensureArray(profiles);
    const targetIndex = findProfileIndexByName(safeProfiles, profileName);
    if (targetIndex < 0) {
        return {
            success: false,
            profiles: safeProfiles.map((profile) => ({ ...profile, isDefault: !!profile?.isDefault })),
            defaultProfile: null,
        };
    }

    const nextProfiles = safeProfiles.map((profile, index) => ({
        ...profile,
        isDefault: index === targetIndex,
    }));

    return {
        success: true,
        profiles: nextProfiles,
        defaultProfile: nextProfiles[targetIndex] || null,
    };
}

export function cloneProfileEntry(profile, name, overrides = {}) {
    return {
        name: String(name || profile?.name || '').trim(),
        updatedAt: Number(overrides.updatedAt || Date.now()),
        settings: cloneSettingsPayload(overrides.settings ?? profile?.settings ?? {}),
        isDefault: Boolean(overrides.isDefault ?? profile?.isDefault),
    };
}

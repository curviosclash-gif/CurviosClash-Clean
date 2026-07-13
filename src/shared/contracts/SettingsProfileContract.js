// ─── Settings Profile Contract: Shared Normalization & Profile Shape ───
// Layer: Shared (UI, State, and Runtime can all depend on this)
// Purpose: Centralizes profile-entry normalization so SettingsStore, Menu-Stores,
//          and any future Arcade-Store all follow the same persistence path.

/** Maximum character length for a profile name. */
export const PROFILE_NAME_MAX_LENGTH = 32;

/**
 * Normalizes a raw profile name: trims, collapses runs of whitespace, truncates
 * to {@link PROFILE_NAME_MAX_LENGTH} characters.
 * @param {string} rawName
 * @returns {string}
 */
export function normalizeProfileName(rawName) {
    return String(rawName || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, PROFILE_NAME_MAX_LENGTH);
}

/**
 * Returns a case-insensitive, normalised lookup key for a profile name.
 * Use this when comparing or indexing profiles so that name matching is
 * consistent across all stores.
 * @param {string} rawName
 * @returns {string}
 */
export function getProfileNameKey(rawName) {
    return normalizeProfileName(rawName).toLocaleLowerCase();
}

/**
 * Normalises an array of profile entries:
 * - Removes entries with empty names or duplicate names (keeps last-updated).
 * - Sorts by `updatedAt` descending (most-recently-changed first).
 * - Ensures exactly one entry has `isDefault: true` (the first one that claimed it).
 * @param {Array} profiles - Raw profile array (may contain untrusted input).
 * @returns {Array}
 */
export function normalizeProfileEntries(profiles) {
    const sorted = Array.isArray(profiles)
        ? [...profiles].sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0))
        : [];
    let defaultAssigned = false;
    return sorted.map((profile) => {
        const isDefault = Boolean(profile?.isDefault) && !defaultAssigned;
        if (isDefault) defaultAssigned = true;
        return {
            name: String(profile?.name || '').trim(),
            updatedAt: Number(profile?.updatedAt || Date.now()),
            settings: profile?.settings || {},
            isDefault,
        };
    });
}

/**
 * Returns the index of the profile whose name matches `profileName`
 * (case-insensitive), or -1 if not found.
 * @param {Array} profiles
 * @param {string} profileName
 * @returns {number}
 */
export function findProfileIndexByName(profiles, profileName) {
    const key = getProfileNameKey(profileName);
    if (!key) return -1;
    if (!Array.isArray(profiles)) return -1;
    return profiles.findIndex((p) => getProfileNameKey(p.name) === key);
}

/**
 * Returns the profile whose name matches `profileName` (case-insensitive),
 * or `null` if not found.
 * @param {Array} profiles
 * @param {string} profileName
 * @returns {Object|null}
 */
export function findProfileByName(profiles, profileName) {
    const index = findProfileIndexByName(profiles, profileName);
    return index >= 0 ? profiles[index] : null;
}

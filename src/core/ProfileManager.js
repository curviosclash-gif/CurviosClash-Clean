// ============================================
// ProfileManager.js - business logic for settings profiles
// ============================================

import {
    cloneProfileEntry,
    exportProfileAsJson,
    parseProfileImport,
    PROFILE_EXPORT_CONTRACT_VERSION,
    removeProfileByName,
    resolveActiveProfileName,
    resolveDefaultProfileName,
    resolveUniqueProfileName,
    setDefaultProfileByName,
    upsertProfileEntry,
} from '../composition/core-ui/CoreProfilePorts.js';
import { isPersistenceSuccess } from './settings/SettingsDomainUtils.js';

export class ProfileManager {
    constructor(settingsStore) {
        this.store = settingsStore;
        this.profiles = this.store.loadProfiles();
        this.activeProfileName = resolveDefaultProfileName(this.profiles);
    }

    getProfiles() {
        return this.profiles;
    }

    getActiveProfileName() {
        return this.activeProfileName;
    }

    getDefaultProfileName() {
        return resolveDefaultProfileName(this.profiles);
    }

    setActiveProfileName(name) {
        this.activeProfileName = name;
    }

    normalizeProfileName(rawName) {
        return this.store.normalizeProfileName(rawName);
    }

    findProfileByName(name) {
        return this.store.findProfileByName(this.profiles, name);
    }

    findProfileIndexByName(name) {
        return this.store.findProfileIndexByName(this.profiles, name);
    }

    resolveActiveProfileName(profileName) {
        return resolveActiveProfileName(this.profiles, profileName, this.getProfileDataOps());
    }

    getProfileDataOps() {
        return {
            findProfileIndexByName: (profiles, name) => this.store.findProfileIndexByName(profiles, name),
            findProfileByName: (profiles, name) => this.store.findProfileByName(profiles, name),
        };
    }

    getProfileUiStateOps() {
        return {
            normalizeProfileName: (rawName) => this.normalizeProfileName(rawName),
            ...this.getProfileDataOps(),
        };
    }

    getProfileControlStateOps() {
        return {
            normalizeProfileName: (rawName) => this.normalizeProfileName(rawName),
            resolveActiveProfileName: (profiles, profileName) => resolveActiveProfileName(profiles, profileName, this.getProfileDataOps()),
        };
    }

    saveProfile(profileName, currentSettings, currentActiveProfileName) {
        const name = this.normalizeProfileName(profileName);
        if (!name || name.length < 2) {
            return { success: false, error: 'Name zu kurz oder ungueltig (min. 2 Zeichen)' };
        }

        const idx = this.findProfileIndexByName(name);
        const effectiveActiveProfileName = this.resolveActiveProfileName(currentActiveProfileName);
        const activeIdx = this.findProfileIndexByName(effectiveActiveProfileName);
        const canOverwrite = idx >= 0 && idx === activeIdx;

        if (idx >= 0 && !canOverwrite) {
            return { success: false, error: 'Name existiert bereits' };
        }

        const isUpdate = idx >= 0;
        const existingProfile = idx >= 0 ? this.profiles[idx] : null;
        const entry = {
            name,
            updatedAt: Date.now(),
            settings: JSON.parse(JSON.stringify(currentSettings)),
            isDefault: Boolean(existingProfile?.isDefault),
        };

        this.profiles = upsertProfileEntry(this.profiles, entry, this.getProfileDataOps()).profiles;
        this.activeProfileName = name;

        const persisted = this.store.saveProfiles(this.profiles);
        if (!isPersistenceSuccess(persisted)) {
            return { success: false, error: 'Profil konnte nicht gespeichert werden (Speicher voll?)' };
        }

        return { success: true, isUpdate, name };
    }

    duplicateProfile(sourceProfileName, targetProfileName = '') {
        const sourceName = this.normalizeProfileName(sourceProfileName);
        const sourceProfile = this.findProfileByName(sourceName);
        if (!sourceProfile) {
            return { success: false, error: 'Quellprofil nicht gefunden' };
        }

        const requestedTargetName = this.normalizeProfileName(targetProfileName);
        if (requestedTargetName && requestedTargetName !== sourceProfile.name && this.findProfileIndexByName(requestedTargetName) >= 0) {
            return { success: false, error: 'Name existiert bereits' };
        }

        const duplicateName = requestedTargetName && requestedTargetName !== sourceProfile.name
            ? requestedTargetName
            : resolveUniqueProfileName(
                this.profiles,
                `${sourceProfile.name} Kopie`,
                {
                    normalizeProfileName: (rawName) => this.normalizeProfileName(rawName),
                    findProfileIndexByName: (profiles, name) => this.store.findProfileIndexByName(profiles, name),
                    fallbackLabel: 'Profil Kopie',
                }
            );
        if (!duplicateName) {
            return { success: false, error: 'Duplikatname konnte nicht erzeugt werden' };
        }

        const entry = cloneProfileEntry(sourceProfile, duplicateName, {
            updatedAt: Date.now(),
            isDefault: false,
        });
        this.profiles = upsertProfileEntry(this.profiles, entry, this.getProfileDataOps()).profiles;
        this.activeProfileName = duplicateName;

        const persisted = this.store.saveProfiles(this.profiles);
        if (!isPersistenceSuccess(persisted)) {
            return { success: false, error: 'Profil konnte nicht dupliziert werden' };
        }

        return { success: true, name: duplicateName, sourceName: sourceProfile.name };
    }

    loadProfile(profileName) {
        const name = this.normalizeProfileName(profileName);
        const profile = this.findProfileByName(name);
        if (!profile) {
            return { success: false, error: 'Profil nicht gefunden' };
        }

        this.activeProfileName = profile.name;
        // Sanitize through store
        const sanitizedSettings = this.store.sanitizeSettings(profile.settings);

        return { success: true, profile: { ...profile, settings: sanitizedSettings } };
    }

    exportProfile(profileName) {
        const name = this.normalizeProfileName(profileName);
        const profile = this.findProfileByName(name);
        if (!profile) {
            return { success: false, error: 'Profil nicht gefunden' };
        }

        return {
            success: true,
            name: profile.name,
            serialized: exportProfileAsJson(profile),
            contractVersion: PROFILE_EXPORT_CONTRACT_VERSION,
            message: `Profil exportiert (${PROFILE_EXPORT_CONTRACT_VERSION}).`,
            tone: 'success',
        };
    }

    importProfile(inputValue, requestedProfileName = '') {
        const parsed = parseProfileImport(inputValue, {
            normalizeProfileName: (rawName) => this.normalizeProfileName(rawName),
        });
        if (!parsed.success) {
            return parsed;
        }

        const explicitName = this.normalizeProfileName(requestedProfileName);
        let targetName = explicitName || parsed.profile.name;
        if (explicitName && this.findProfileIndexByName(explicitName) >= 0) {
            return { success: false, error: 'Name existiert bereits' };
        }
        if (!explicitName && this.findProfileIndexByName(targetName) >= 0) {
            targetName = resolveUniqueProfileName(
                this.profiles,
                `${targetName} Import`,
                {
                    normalizeProfileName: (rawName) => this.normalizeProfileName(rawName),
                    findProfileIndexByName: (profiles, name) => this.store.findProfileIndexByName(profiles, name),
                    fallbackLabel: 'Profil Import',
                }
            );
        }
        if (!targetName) {
            return { success: false, error: 'Importname konnte nicht erzeugt werden' };
        }

        const entry = cloneProfileEntry(parsed.profile, targetName, {
            updatedAt: Date.now(),
            settings: this.store.sanitizeSettings(parsed.profile.settings || {}),
        });
        this.profiles = upsertProfileEntry(this.profiles, entry, this.getProfileDataOps()).profiles;
        if (entry.isDefault) {
            this.profiles = setDefaultProfileByName(this.profiles, entry.name, this.getProfileDataOps()).profiles;
        }
        this.activeProfileName = entry.name;

        const persisted = this.store.saveProfiles(this.profiles);
        if (!isPersistenceSuccess(persisted)) {
            return { success: false, error: 'Profil konnte nicht importiert werden' };
        }

        return {
            success: true,
            name: entry.name,
            serialized: exportProfileAsJson(entry),
            isDefault: entry.isDefault,
            contractVersion: PROFILE_EXPORT_CONTRACT_VERSION,
            usedLegacyFallback: parsed.usedLegacyFallback === true,
            warnings: Array.isArray(parsed.warnings) ? parsed.warnings.slice() : [],
            message: String(
                parsed.message
                || (parsed.usedLegacyFallback
                    ? 'Legacy-Profil importiert und auf den aktuellen Vertragsstand normalisiert.'
                    : 'Profil importiert.')
            ),
            tone: String(parsed.tone || (parsed.usedLegacyFallback ? 'warning' : 'success')),
            migration: parsed.migration && typeof parsed.migration === 'object'
                ? { ...parsed.migration }
                : null,
        };
    }

    setDefaultProfile(profileName) {
        const name = this.normalizeProfileName(profileName);
        const result = setDefaultProfileByName(this.profiles, name, this.getProfileDataOps());
        if (!result.success) {
            return { success: false, error: 'Profil nicht gefunden' };
        }

        this.profiles = result.profiles;
        this.activeProfileName = result.defaultProfile?.name || this.activeProfileName;

        const persisted = this.store.saveProfiles(this.profiles);
        if (!isPersistenceSuccess(persisted)) {
            return { success: false, error: 'Standardprofil konnte nicht gespeichert werden' };
        }

        return {
            success: true,
            name: result.defaultProfile?.name || '',
        };
    }

    deleteProfile(profileName) {
        const name = this.normalizeProfileName(profileName);
        const index = this.findProfileIndexByName(name);
        if (index < 0) {
            return { success: false, error: 'Profil nicht gefunden' };
        }

        const removeResult = removeProfileByName(this.profiles, name, this.getProfileDataOps());
        const removedName = removeResult.removedProfile?.name || this.profiles[index].name;
        this.profiles = removeResult.profiles;
        this.activeProfileName = resolveActiveProfileName(this.profiles, this.activeProfileName, this.getProfileDataOps());

        const persisted = this.store.saveProfiles(this.profiles);
        if (!isPersistenceSuccess(persisted)) {
            return { success: false, error: 'Profil konnte nicht geloescht werden' };
        }

        return { success: true, removedName };
    }
}

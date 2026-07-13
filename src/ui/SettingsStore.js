// ============================================
// SettingsStore.js - localStorage persistence for settings and profiles
// ============================================

import {
    LEGACY_STORAGE_KEYS,
    STORAGE_KEYS,
} from './StorageKeys.js';
import { createDefaultStoragePlatform } from '../state/storage/StoragePlatform.js';
import { getDefaultBrowserStorage } from './base/PersistentStore.js';
import {
    normalizeProfileEntries,
    normalizeProfileName,
    getProfileNameKey,
    findProfileIndexByName,
    findProfileByName,
} from '../shared/contracts/SettingsProfileContract.js';
import { resolveArtifactVersionState } from '../shared/contracts/ArtifactVersionMigrationContract.js';

const SETTINGS_STORAGE_KEY = STORAGE_KEYS.settings;
const SETTINGS_STORAGE_LEGACY_KEYS = LEGACY_STORAGE_KEYS.settings;
const SETTINGS_PROFILES_STORAGE_KEY = STORAGE_KEYS.settingsProfiles;
const SETTINGS_PROFILES_STORAGE_LEGACY_KEYS = LEGACY_STORAGE_KEYS.settingsProfiles;
const SETTINGS_PROFILES_SCHEMA_VERSION = 'settings-profiles.v1';
const MENU_PRESETS_STORAGE_KEY = STORAGE_KEYS.menuPresets;
const MENU_PRESETS_STORAGE_LEGACY_KEYS = LEGACY_STORAGE_KEYS.menuPresets;
const SETTINGS_PERSISTENCE_REASONS = Object.freeze({
    OK: 'ok',
    STORAGE_FAILED: 'storage_failed',
    QUOTA_EXCEEDED: 'quota_exceeded',
    INVALID_KEY: 'invalid_key',
});

function stableCanonicalSerialize(value, seen = null) {
    if (value === null || value === undefined) return String(value);
    const valueType = typeof value;
    if (valueType === 'number') {
        if (Number.isNaN(value)) return 'number:NaN';
        if (value === Infinity) return 'number:Infinity';
        if (value === -Infinity) return 'number:-Infinity';
        return `number:${value}`;
    }
    if (valueType === 'string') return `string:${value}`;
    if (valueType === 'boolean') return value ? 'boolean:true' : 'boolean:false';
    if (valueType === 'bigint') return `bigint:${value.toString()}`;
    if (valueType !== 'object') return `other:${String(value)}`;
    if (valueType === 'object' && typeof value.toJSON === 'function') {
        return stableCanonicalSerialize(value.toJSON(), seen);
    }

    const activeSeen = seen || new WeakSet();
    if (activeSeen.has(value)) return 'cycle';
    activeSeen.add(value);

    if (Array.isArray(value)) {
        const serialized = value.map((entry) => stableCanonicalSerialize(entry, activeSeen));
        activeSeen.delete(value);
        return `[${serialized.join(',')}]`;
    }

    const keys = Object.keys(value).sort();
    const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableCanonicalSerialize(value[key], activeSeen)}`);
    activeSeen.delete(value);
    return `{${pairs.join(',')}}`;
}

function areCanonicalSettingsEqual(left, right) {
    try {
        return stableCanonicalSerialize(left) === stableCanonicalSerialize(right);
    } catch {
        return false;
    }
}

function createPersistenceResult(success, reason, metadata = null) {
    const result = { success: success === true, reason: String(reason || '') };
    if (metadata && typeof metadata === 'object' && Object.keys(metadata).length > 0) {
        result.metadata = metadata;
    }
    return result;
}

function mapStorageWriteToPersistenceResult(writeResult, metadata = null) {
    const normalizedMetadata = metadata && typeof metadata === 'object' ? { ...metadata } : {};
    const storageReason = typeof writeResult?.reason === 'string' ? writeResult.reason : '';
    if (writeResult?.ok === true) {
        return createPersistenceResult(true, SETTINGS_PERSISTENCE_REASONS.OK, normalizedMetadata);
    }
    if (writeResult?.quotaExceeded === true) {
        if (storageReason) normalizedMetadata.storageReason = storageReason;
        return createPersistenceResult(false, SETTINGS_PERSISTENCE_REASONS.QUOTA_EXCEEDED, normalizedMetadata);
    }
    if (storageReason) normalizedMetadata.storageReason = storageReason;
    return createPersistenceResult(false, SETTINGS_PERSISTENCE_REASONS.STORAGE_FAILED, normalizedMetadata);
}

function createInitialPersistenceStatus() {
    return {
        settings: { status: 'unknown', reason: '' },
        profiles: { status: 'unknown', reason: '' },
        records: { status: 'unknown', reason: '' },
        lastPersistenceStatus: 'unknown',
        lastPersistenceReason: '',
    };
}

function summarizePersistenceResult(result) {
    const reason = String(result?.reason || '');
    return {
        status: result?.success === true ? 'ok' : 'failed',
        reason,
    };
}

export class SettingsStore {
    constructor(options = {}) {
        this.storagePlatform = options.storagePlatform || createDefaultStoragePlatform({
            storage: options.storage ?? getDefaultBrowserStorage(),
            onQuotaExceeded: options.onQuotaExceeded,
        });
        this.storage = this.storagePlatform?.driver?.storage || null;
        this.sanitizeSettings = typeof options.sanitizeSettings === 'function'
            ? options.sanitizeSettings
            : (settings) => settings;
        this.createDefaultSettings = typeof options.createDefaultSettings === 'function'
            ? options.createDefaultSettings
            : () => ({});
        this.settingsStorageKey = options.settingsStorageKey || SETTINGS_STORAGE_KEY;
        this.settingsStorageLegacyKeys = Array.isArray(options.settingsStorageLegacyKeys)
            ? [...options.settingsStorageLegacyKeys]
            : [...SETTINGS_STORAGE_LEGACY_KEYS];
        this.settingsProfilesStorageKey = options.settingsProfilesStorageKey || SETTINGS_PROFILES_STORAGE_KEY;
        this.settingsProfilesStorageLegacyKeys = Array.isArray(options.settingsProfilesStorageLegacyKeys)
            ? [...options.settingsProfilesStorageLegacyKeys]
            : [...SETTINGS_PROFILES_STORAGE_LEGACY_KEYS];
        this.menuPresetsStorageKey = options.menuPresetsStorageKey || MENU_PRESETS_STORAGE_KEY;
        this.menuPresetsStorageLegacyKeys = Array.isArray(options.menuPresetsStorageLegacyKeys)
            ? [...options.menuPresetsStorageLegacyKeys]
            : [...MENU_PRESETS_STORAGE_LEGACY_KEYS];
        this.persistenceStatus = createInitialPersistenceStatus();
    }

    _recordPersistenceResult(channel, result) {
        const key = String(channel || '').trim();
        if (!key || !Object.prototype.hasOwnProperty.call(this.persistenceStatus, key)) {
            return result;
        }
        const summary = summarizePersistenceResult(result);
        this.persistenceStatus[key] = summary;
        this.persistenceStatus.lastPersistenceStatus = summary.status;
        this.persistenceStatus.lastPersistenceReason = summary.reason;
        return result;
    }

    getPersistenceStatus() {
        return {
            settings: { ...this.persistenceStatus.settings },
            profiles: { ...this.persistenceStatus.profiles },
            records: { ...this.persistenceStatus.records },
            lastPersistenceStatus: this.persistenceStatus.lastPersistenceStatus,
            lastPersistenceReason: this.persistenceStatus.lastPersistenceReason,
        };
    }

    _warnPersistenceFailure(contextLabel, result) {
        if (result?.success === true) return;
        if (typeof console === 'undefined' || typeof console.warn !== 'function') return;
        console.warn(
            `[SettingsStore] ${String(contextLabel || 'persistence')} failed`,
            {
                reason: String(result?.reason || ''),
                metadata: result?.metadata && typeof result.metadata === 'object'
                    ? { ...result.metadata }
                    : null,
            }
        );
    }

    _createCanonicalSettingsPersistenceState(settings) {
        const hasObjectInput = !!settings && typeof settings === 'object';
        const seedSettings = hasObjectInput ? settings : this.createDefaultSettings();
        const canonicalSettings = this.sanitizeSettings(seedSettings);
        return {
            hasObjectInput,
            canonicalSettings,
            didNormalize: hasObjectInput
                ? !areCanonicalSettingsEqual(settings, canonicalSettings)
                : false,
        };
    }

    loadSettings() {
        try {
            const saved = this.storagePlatform.readJson(
                this.settingsStorageKey,
                this.settingsStorageLegacyKeys,
                null
            );
            const persistenceState = this._createCanonicalSettingsPersistenceState(saved);
            if (persistenceState.didNormalize) {
                const writeBack = this.storagePlatform.writeJson(
                    this.settingsStorageKey,
                    persistenceState.canonicalSettings
                );
                const writeBackResult = this._recordPersistenceResult(
                    'settings',
                    mapStorageWriteToPersistenceResult(writeBack, { key: this.settingsStorageKey })
                );
                this._warnPersistenceFailure(
                    'loadSettings canonical write-back',
                    writeBackResult
                );
            }
            return persistenceState.canonicalSettings;
        } catch (error) {
            if (typeof console !== 'undefined' && typeof console.warn === 'function') {
                console.warn('[SettingsStore] loadSettings failed, using defaults.', error);
            }
        }
        return this._createCanonicalSettingsPersistenceState(null).canonicalSettings;
    }

    saveSettings(settings) {
        const persistenceState = this._createCanonicalSettingsPersistenceState(settings);
        const result = this.storagePlatform.writeJson(
            this.settingsStorageKey,
            persistenceState.canonicalSettings
        );
        return this._recordPersistenceResult(
            'settings',
            mapStorageWriteToPersistenceResult(result, { key: this.settingsStorageKey })
        );
    }

    loadProfiles() {
        try {
            const parsed = this.storagePlatform.readJson(
                this.settingsProfilesStorageKey,
                this.settingsProfilesStorageLegacyKeys,
                null
            );
            if (parsed === null || parsed === undefined) return [];
            const versionState = resolveArtifactVersionState(parsed, {
                artifactType: 'settings-profiles',
                versionFields: ['schemaVersion'],
                supportedVersions: [SETTINGS_PROFILES_SCHEMA_VERSION],
                currentVersion: SETTINGS_PROFILES_SCHEMA_VERSION,
                allowMissingVersion: true,
            });
            if (versionState.shouldReject) return [];
            const rawProfiles = versionState.hasVersionField
                ? parsed?.profiles
                : (Array.isArray(parsed) ? parsed : parsed?.profiles);
            if (!Array.isArray(rawProfiles)) return [];

            const out = [];
            const used = new Set();
            for (const entry of rawProfiles) {
                const name = this.normalizeProfileName(entry?.name || '');
                const key = this.getProfileNameKey(name);
                if (!name || used.has(key)) continue;
                used.add(key);
                out.push({
                    name,
                    updatedAt: Number(entry?.updatedAt || Date.now()),
                    settings: this.sanitizeSettings(entry?.settings || {}),
                    isDefault: Boolean(entry?.isDefault),
                });
            }
            const normalized = normalizeProfileEntries(out);
            if (versionState.shouldFallback || versionState.shouldUpgrade) {
                const writeBack = this.storagePlatform.writeJson(this.settingsProfilesStorageKey, {
                    schemaVersion: SETTINGS_PROFILES_SCHEMA_VERSION,
                    profiles: normalized,
                });
                const writeBackResult = this._recordPersistenceResult(
                    'profiles',
                    mapStorageWriteToPersistenceResult(writeBack, { key: this.settingsProfilesStorageKey })
                );
                this._warnPersistenceFailure(
                    'loadProfiles canonical write-back',
                    writeBackResult
                );
            }
            return normalized;
        } catch (error) {
            if (typeof console !== 'undefined' && typeof console.warn === 'function') {
                console.warn('[SettingsStore] loadProfiles failed, using empty list.', error);
            }
            return [];
        }
    }

    saveProfiles(profiles) {
        const result = this.storagePlatform.writeJson(
            this.settingsProfilesStorageKey,
            {
                schemaVersion: SETTINGS_PROFILES_SCHEMA_VERSION,
                profiles: normalizeProfileEntries(profiles),
            }
        );
        return this._recordPersistenceResult(
            'profiles',
            mapStorageWriteToPersistenceResult(result, { key: this.settingsProfilesStorageKey })
        );
    }

    loadJsonRecord(storageKey, fallbackValue = null) {
        const key = String(storageKey || '').trim();
        if (!key) return fallbackValue;
        try {
            const parsed = this.storagePlatform.readJson(
                key,
                this._resolveLegacyKeysForStorageKey(key),
                fallbackValue
            );
            return parsed;
        } catch (error) {
            if (typeof console !== 'undefined' && typeof console.warn === 'function') {
                console.warn(`[SettingsStore] loadJsonRecord failed for key "${key}", using fallback.`, error);
            }
            return fallbackValue;
        }
    }

    saveJsonRecord(storageKey, value) {
        const key = String(storageKey || '').trim();
        if (!key) {
            return this._recordPersistenceResult(
                'records',
                createPersistenceResult(false, SETTINGS_PERSISTENCE_REASONS.INVALID_KEY, {
                    key: String(storageKey ?? ''),
                })
            );
        }
        const result = this.storagePlatform.writeJson(key, value);
        return this._recordPersistenceResult(
            'records',
            mapStorageWriteToPersistenceResult(result, { key })
        );
    }

    _resolveLegacyKeysForStorageKey(storageKey) {
        if (storageKey === this.settingsStorageKey) {
            return this.settingsStorageLegacyKeys;
        }
        if (storageKey === this.settingsProfilesStorageKey) {
            return this.settingsProfilesStorageLegacyKeys;
        }
        if (storageKey === this.menuPresetsStorageKey) {
            return this.menuPresetsStorageLegacyKeys;
        }
        return [];
    }

    normalizeProfileName(rawName) {
        return normalizeProfileName(rawName);
    }

    getProfileNameKey(rawName) {
        return getProfileNameKey(rawName);
    }

    findProfileIndexByName(profiles, profileName) {
        return findProfileIndexByName(profiles, profileName);
    }

    findProfileByName(profiles, profileName) {
        return findProfileByName(profiles, profileName);
    }
}

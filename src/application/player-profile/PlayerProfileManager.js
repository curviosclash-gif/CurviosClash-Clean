import {
    createPlayerProfile,
    normalizePlayerProfileRegistry,
    PLAYER_PROFILE_MAX_PROFILES,
    resolveUniquePlayerProfileName,
} from '../../shared/contracts/PlayerProfileContract.js';
import {
    createPlayerProfileMigrationRecord,
    PLAYER_PROFILE_MIGRATION_SCHEMA_VERSION,
} from '../../shared/contracts/PlayerProfileMigrationContract.js';
import {
    listPlayerProfileRecordDefinitions,
    PLAYER_PROFILE_MIGRATION_STORAGE_KEY,
    PLAYER_PROFILE_REGISTRY_STORAGE_KEY,
    resolvePlayerScopedStorageKey,
    resolvePlayerScopedStorageKeyByKind,
} from '../../shared/contracts/PlayerProfileStorageContract.js';
import {
    createPlayerProfileExport,
    parsePlayerProfileImport,
} from '../../shared/contracts/PlayerProfileTransferContract.js';

function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function isSuccess(result) {
    return result === true || result?.success === true;
}

function createDefaultId() {
    if (typeof globalThis.crypto?.randomUUID !== 'function') {
        throw new Error('crypto.randomUUID is unavailable');
    }
    return globalThis.crypto.randomUUID();
}

export function createPlayerRecordStorePort({ profileId, globalRecordStore, allowLegacyFallback = () => false } = {}) {
    const boundProfileId = String(profileId || '').trim();
    const store = globalRecordStore || null;

    function resolve(storageKey) {
        return resolvePlayerScopedStorageKey(boundProfileId, storageKey);
    }

    function readResult(storageKey) {
        const scopedKey = resolve(storageKey);
        if (!scopedKey) return store?.readJsonRecordResult?.(storageKey) || { ok: false, status: 'read_failed', reason: 'store_unavailable' };
        const scoped = store?.readJsonRecordResult?.(scopedKey);
        if (scoped?.status !== 'missing' || allowLegacyFallback() !== true) return scoped;
        return store?.readJsonRecordResult?.(storageKey) || scoped;
    }

    return Object.freeze({
        profileId: boundProfileId,
        resolveStorageKey: resolve,
        loadJsonRecord(storageKey, fallbackValue = null) {
            const result = readResult(storageKey);
            return result?.status === 'found' ? clone(result.value) : fallbackValue;
        },
        readJsonRecordResult: readResult,
        saveJsonRecord(storageKey, value) {
            const scopedKey = resolve(storageKey);
            return store?.saveJsonRecord?.(scopedKey || storageKey, value) || { success: false, reason: 'store_unavailable' };
        },
        removeJsonRecord(storageKey) {
            const scopedKey = resolve(storageKey);
            return store?.removeJsonRecord?.(scopedKey || storageKey) || { success: false, reason: 'store_unavailable' };
        },
    });
}

export class PlayerProfileManager {
    constructor(options = {}) {
        this.store = options.recordStore || null;
        this.createId = typeof options.createId === 'function' ? options.createId : createDefaultId;
        this.now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();
        this.getPreferredSettingsProfileName = typeof options.getPreferredSettingsProfileName === 'function'
            ? options.getPreferredSettingsProfileName : () => '';
        this.registry = null;
        this.migration = null;
        this.lastError = '';
        this._ports = new Map();
    }

    bootstrap() {
        const loaded = this.store?.readJsonRecordResult?.(PLAYER_PROFILE_REGISTRY_STORAGE_KEY);
        if (!loaded || !['found', 'missing'].includes(loaded.status)) {
            this.lastError = String(loaded?.reason || 'registry_read_failed');
            return { ok: false, reason: this.lastError };
        }
        const normalized = normalizePlayerProfileRegistry(loaded?.status === 'found' ? loaded.value : null, {
            createId: this.createId,
            now: this.now,
            preferredSettingsProfileName: this.getPreferredSettingsProfileName(),
        });
        if (!normalized.ok) {
            this.lastError = normalized.reason;
            return { ok: false, reason: normalized.reason };
        }
        this.registry = normalized.registry;
        const persisted = this.store?.saveJsonRecord?.(PLAYER_PROFILE_REGISTRY_STORAGE_KEY, this.registry);
        if (!isSuccess(persisted)) {
            this.lastError = String(persisted?.reason || 'registry_save_failed');
            return { ok: false, reason: this.lastError };
        }
        const migrationResult = this._migrateLegacyRecords();
        this.lastError = migrationResult.ok ? '' : migrationResult.reason;
        return { ok: migrationResult.ok, reason: migrationResult.reason, registry: this.getRegistry(), migration: this.getMigrationState() };
    }

    _saveRegistry(nextRegistry = this.registry) {
        const normalized = normalizePlayerProfileRegistry(nextRegistry, {
            createId: this.createId,
            now: this.now,
        });
        if (!normalized.ok) return { success: false, reason: normalized.reason };
        const result = this.store?.saveJsonRecord?.(PLAYER_PROFILE_REGISTRY_STORAGE_KEY, normalized.registry);
        if (isSuccess(result)) this.registry = normalized.registry;
        return result || { success: false, reason: 'store_unavailable' };
    }

    _saveMigration() {
        this.migration.updatedAt = this.now();
        return this.store?.saveJsonRecord?.(PLAYER_PROFILE_MIGRATION_STORAGE_KEY, this.migration);
    }

    _migrateLegacyRecords() {
        const targetProfileId = this.registry.activeProfileId;
        const loaded = this.store?.readJsonRecordResult?.(PLAYER_PROFILE_MIGRATION_STORAGE_KEY);
        if (!loaded || !['found', 'missing'].includes(loaded.status)) return { ok: false, reason: loaded?.reason || 'migration_read_failed' };
        if (loaded.status === 'found' && loaded.value?.schemaVersion !== PLAYER_PROFILE_MIGRATION_SCHEMA_VERSION) {
            return { ok: false, reason: 'unsupported_migration_schema' };
        }
        this.migration = createPlayerProfileMigrationRecord(
            targetProfileId,
            loaded?.status === 'found' && loaded.value?.profileId === targetProfileId ? loaded.value : null
        );
        this.migration.status = 'pending';
        this._saveMigration();
        let failed = false;
        for (const definition of listPlayerProfileRecordDefinitions()) {
            const previous = this.migration.records[definition.kind];
            if (['copied', 'preserved'].includes(previous?.status)) continue;
            const scopedKey = resolvePlayerScopedStorageKeyByKind(targetProfileId, definition.kind);
            const scoped = this.store?.readJsonRecordResult?.(scopedKey);
            if (scoped?.status === 'found') {
                this.migration.records[definition.kind] = { status: 'preserved' };
                this._saveMigration();
                continue;
            }
            if (scoped?.status !== 'missing') {
                failed = true;
                this.migration.records[definition.kind] = { status: 'failed', reason: scoped?.reason || 'destination_read_failed' };
                this._saveMigration();
                continue;
            }
            const legacy = this.store?.readJsonRecordResult?.(definition.legacyKey);
            if (legacy?.status === 'missing') {
                this.migration.records[definition.kind] = { status: 'no_source' };
                this._saveMigration();
                continue;
            }
            if (legacy?.status !== 'found') {
                failed = true;
                this.migration.records[definition.kind] = { status: 'failed', reason: legacy?.reason || legacy?.status || 'legacy_read_failed' };
                this._saveMigration();
                continue;
            }
            const write = this.store?.saveJsonRecord?.(scopedKey, legacy.value);
            const verified = isSuccess(write) ? this.store?.readJsonRecordResult?.(scopedKey) : null;
            if (!isSuccess(write) || verified?.status !== 'found') {
                failed = true;
                this.migration.records[definition.kind] = { status: 'failed', reason: write?.reason || verified?.reason || 'verification_failed' };
            } else {
                this.migration.records[definition.kind] = { status: 'copied' };
            }
            this._saveMigration();
        }
        this.migration.status = failed ? 'failed' : 'complete';
        const saved = this._saveMigration();
        if (!isSuccess(saved)) return { ok: false, reason: saved?.reason || 'migration_state_save_failed' };
        return { ok: !failed, reason: failed ? 'migration_incomplete' : 'complete' };
    }

    getRegistry() { return clone(this.registry); }
    getMigrationState() { return clone(this.migration); }
    getProfiles({ includeArchived = false } = {}) {
        return clone((this.registry?.profiles || []).filter((profile) => includeArchived || !profile.archivedAt));
    }
    getActiveProfile() {
        return clone(this.registry?.profiles?.find((profile) => profile.id === this.registry.activeProfileId) || null);
    }
    getDefaultProfile() {
        return clone(this.registry?.profiles?.find((profile) => profile.id === this.registry.defaultProfileId) || null);
    }

    getRecordStorePort(profileId) {
        const id = String(profileId || '').trim();
        if (!this._ports.has(id)) {
            this._ports.set(id, createPlayerRecordStorePort({
                profileId: id,
                globalRecordStore: this.store,
                allowLegacyFallback: () => this.migration?.profileId === id && this.migration?.status !== 'complete',
            }));
        }
        return this._ports.get(id);
    }

    getActiveRecordStorePort() {
        return this.getRecordStorePort(this.registry?.activeProfileId);
    }

    createProfile(displayName = '') {
        if ((this.registry?.profiles?.length || 0) >= PLAYER_PROFILE_MAX_PROFILES) return { ok: false, reason: 'profile_limit' };
        const name = resolveUniquePlayerProfileName(this.registry.profiles, displayName, 'Spieler');
        const profile = createPlayerProfile({}, {
            id: this.createId(), now: this.now(), displayName: name,
            preferredSettingsProfileName: this.getPreferredSettingsProfileName(),
        });
        const result = this._saveRegistry({ ...this.registry, profiles: [...this.registry.profiles, profile] });
        return isSuccess(result) ? { ok: true, profile: clone(profile) } : { ok: false, reason: result?.reason || 'save_failed' };
    }

    renameProfile(profileId, displayName) {
        const profile = this.registry?.profiles?.find((entry) => entry.id === profileId);
        if (!profile) return { ok: false, reason: 'profile_not_found' };
        const others = this.registry.profiles.filter((entry) => entry.id !== profileId);
        const nextName = resolveUniquePlayerProfileName(others, displayName, profile.displayName);
        const profiles = this.registry.profiles.map((entry) => entry.id === profileId
            ? { ...entry, displayName: nextName, updatedAt: this.now() }
            : entry);
        const result = this._saveRegistry({ ...this.registry, profiles });
        return isSuccess(result) ? { ok: true, profile: clone(profiles.find((entry) => entry.id === profileId)) } : { ok: false, reason: result?.reason || 'save_failed' };
    }

    setActiveProfile(profileId) {
        const profile = this.registry?.profiles?.find((entry) => entry.id === profileId && !entry.archivedAt);
        if (!profile) return { ok: false, reason: 'profile_not_found' };
        const result = this._saveRegistry({ ...this.registry, activeProfileId: profileId });
        return isSuccess(result) ? { ok: true, profile: clone(profile) } : { ok: false, reason: result?.reason || 'save_failed' };
    }

    setDefaultProfile(profileId) {
        const profile = this.registry?.profiles?.find((entry) => entry.id === profileId && !entry.archivedAt);
        if (!profile) return { ok: false, reason: 'profile_not_found' };
        const result = this._saveRegistry({ ...this.registry, defaultProfileId: profileId });
        return isSuccess(result) ? { ok: true, profile: clone(profile) } : { ok: false, reason: result?.reason || 'save_failed' };
    }

    setPreferredSettingsProfile(profileId, profileName = '') {
        const profile = this.registry?.profiles?.find((entry) => entry.id === profileId);
        if (!profile) return { ok: false, reason: 'profile_not_found' };
        const preferredSettingsProfileName = String(profileName || '').trim();
        if (profile.preferredSettingsProfileName === preferredSettingsProfileName) return { ok: true, profile: clone(profile) };
        const profiles = this.registry.profiles.map((entry) => entry.id === profileId
            ? { ...entry, preferredSettingsProfileName, updatedAt: this.now() } : entry);
        const result = this._saveRegistry({ ...this.registry, profiles });
        return isSuccess(result) ? { ok: true, profile: clone(profiles.find((entry) => entry.id === profileId)) } : { ok: false, reason: result?.reason || 'save_failed' };
    }

    archiveProfile(profileId) {
        if (!this.registry?.profiles?.some((profile) => profile.id === profileId && !profile.archivedAt)) return { ok: false, reason: 'profile_not_found' };
        const usable = this.registry?.profiles?.filter((profile) => !profile.archivedAt) || [];
        if (usable.length <= 1) return { ok: false, reason: 'last_profile' };
        if (profileId === this.registry.activeProfileId || profileId === this.registry.defaultProfileId) return { ok: false, reason: 'protected_profile' };
        const profiles = this.registry.profiles.map((entry) => entry.id === profileId
            ? { ...entry, archivedAt: this.now(), updatedAt: this.now() }
            : entry);
        const result = this._saveRegistry({ ...this.registry, profiles });
        return isSuccess(result) ? { ok: true } : { ok: false, reason: result?.reason || 'save_failed' };
    }

    exportProfile(profileId) {
        const profile = this.registry?.profiles?.find((entry) => entry.id === profileId);
        if (!profile) return { ok: false, reason: 'profile_not_found' };
        const records = {};
        for (const definition of listPlayerProfileRecordDefinitions()) {
            const key = resolvePlayerScopedStorageKeyByKind(profileId, definition.kind);
            const loaded = this.store?.readJsonRecordResult?.(key);
            if (loaded?.status === 'found') records[definition.kind] = loaded.value;
        }
        return { ok: true, value: createPlayerProfileExport(profile, records) };
    }

    importProfile(input) {
        const parsed = parsePlayerProfileImport(input);
        if (!parsed.ok) return parsed;
        if ((this.registry?.profiles?.length || 0) >= PLAYER_PROFILE_MAX_PROFILES) return { ok: false, reason: 'profile_limit' };
        const profile = createPlayerProfile({}, {
            id: this.createId(),
            now: this.now(),
            displayName: resolveUniquePlayerProfileName(this.registry.profiles, parsed.value.displayName, 'Spieler Import'),
            preferredSettingsProfileName: parsed.value.preferredSettingsProfileName,
        });
        const writtenKeys = [];
        for (const [kind, value] of Object.entries(parsed.value.records)) {
            const key = resolvePlayerScopedStorageKeyByKind(profile.id, kind);
            const write = this.store?.saveJsonRecord?.(key, value);
            const verify = isSuccess(write) ? this.store?.readJsonRecordResult?.(key) : null;
            if (!isSuccess(write) || verify?.status !== 'found') {
                writtenKeys.forEach((writtenKey) => this.store?.removeJsonRecord?.(writtenKey));
                return { ok: false, reason: write?.reason || verify?.reason || 'import_write_failed' };
            }
            writtenKeys.push(key);
        }
        const registryResult = this._saveRegistry({ ...this.registry, profiles: [...this.registry.profiles, profile] });
        if (!isSuccess(registryResult)) {
            writtenKeys.forEach((key) => this.store?.removeJsonRecord?.(key));
            return { ok: false, reason: registryResult?.reason || 'registry_save_failed' };
        }
        return { ok: true, profile: clone(profile) };
    }
}

import { createDefaultStorageDriver } from './StorageDriver.js';
import { StorageMigrationRegistry } from './StorageMigrationRegistry.js';

function toJson(value) {
    try { return JSON.stringify(value); } catch { return null; }
}

function parseJson(rawValue) {
    try { return { ok: true, value: JSON.parse(rawValue) }; }
    catch { return { ok: false, value: null }; }
}

function normalizeKey(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export class StoragePlatform {
    constructor(options = {}) {
        this.driver = options.driver || createDefaultStorageDriver(options);
        this.migrationRegistry = options.migrationRegistry || new StorageMigrationRegistry({ driver: this.driver });
        this.onQuotaExceeded = typeof options.onQuotaExceeded === 'function' ? options.onQuotaExceeded : null;
        this.onMigrationResult = typeof options.onMigrationResult === 'function' ? options.onMigrationResult : null;
        this._migrationResults = new Map();
    }

    readRaw(primaryKey, legacyKeys = []) {
        return this.migrationRegistry.resolve(primaryKey, legacyKeys);
    }

    readJson(primaryKey, legacyKeys = [], fallbackValue = null) {
        const key = normalizeKey(primaryKey);
        if (!key) return fallbackValue;
        const candidates = new Set([key, ...legacyKeys.map(normalizeKey).filter(Boolean)]);
        let canMigrate = true;
        this._migrationResults.delete(key);
        for (const candidate of candidates) {
            const read = this.driver.readRaw(candidate);
            if (!read.ok) { canMigrate = false; continue; }
            if (typeof read.value !== 'string') continue;
            const parsed = parseJson(read.value);
            if (!parsed.ok) {
                if (!this._preserveCorruptJson(key, read.value).ok) canMigrate = false;
                continue;
            }
            if (candidate === key || canMigrate) {
                this._storeMigrationResult(key, this.migrationRegistry.migrate(key, {
                    key: candidate, raw: read.value, migrated: candidate !== key,
                }));
            }
            return parsed.value;
        }
        return fallbackValue;
    }

    writeRaw(key, rawValue) {
        const result = this.driver.writeRaw(key, rawValue);
        if (!result.ok && result.quotaExceeded && this.onQuotaExceeded) {
            this.onQuotaExceeded({ key, reason: result.reason, quotaExceeded: true });
        }
        return result;
    }

    writeJson(key, value) {
        const serialized = toJson(value);
        if (typeof serialized !== 'string') {
            return { ok: false, reason: 'serialize_failed', quotaExceeded: false };
        }
        const current = this.driver.readRaw(key);
        if (!current.ok) return { ok: false, reason: current.reason || 'read_failed', quotaExceeded: false };
        if (typeof current.value === 'string' && !parseJson(current.value).ok) {
            const backup = this._preserveCorruptJson(key, current.value);
            if (!backup.ok) return backup;
        }
        return this.writeRaw(key, serialized);
    }

    _preserveCorruptJson(key, rawValue) {
        const baseKey = `${key}.corrupt`;
        for (let index = 0; ; index++) {
            const backupKey = index === 0 ? baseKey : `${baseKey}.${index}`;
            const existing = this.driver.readRaw(backupKey);
            if (!existing.ok) return { ok: false, reason: existing.reason || 'backup_read_failed', quotaExceeded: false };
            if (existing.value === rawValue) return { ok: true, reason: 'already_preserved', quotaExceeded: false };
            if (existing.value != null) continue;
            const write = this.writeRaw(backupKey, rawValue);
            if (!write.ok) return write;
            const check = this.driver.readRaw(backupKey);
            if (!check.ok || check.value !== rawValue) {
                return { ok: false, reason: check.reason && check.reason !== 'ok' ? check.reason : 'backup_verification_failed', quotaExceeded: false };
            }
            return { ok: true, reason: 'preserved', quotaExceeded: false };
        }
    }

    remove(key) {
        return this.driver.remove(key);
    }

    getLastMigrationResult(primaryKey) {
        const normalizedPrimaryKey = normalizeKey(primaryKey);
        if (!normalizedPrimaryKey) return null;
        return this._migrationResults.get(normalizedPrimaryKey) || null;
    }

    _storeMigrationResult(primaryKey, result) {
        const normalizedPrimaryKey = normalizeKey(primaryKey);
        if (!normalizedPrimaryKey || !result || typeof result !== 'object') return null;
        this._migrationResults.set(normalizedPrimaryKey, result);
        if (this.onMigrationResult) {
            try { this.onMigrationResult(result); } catch { /* keep reads resilient */ }
        }
        if (result.attempted === true && result.ok !== true && typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn(
                `[StoragePlatform] Legacy storage migration incomplete for "${normalizedPrimaryKey}" `
                + `(status=${String(result.status || 'unknown')} reason=${String(result.reason || 'unknown')})`
            );
        }
        return result;
    }
}

export function createDefaultStoragePlatform(options = {}) {
    return new StoragePlatform(options);
}

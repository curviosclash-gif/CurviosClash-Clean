import { createDefaultStorageDriver } from './StorageDriver.js';
import { StorageMigrationRegistry } from './StorageMigrationRegistry.js';

function toJson(value) {
    try {
        return JSON.stringify(value);
    } catch {
        return null;
    }
}

function parseJson(rawValue, fallbackValue = null) {
    try {
        return JSON.parse(rawValue);
    } catch {
        return fallbackValue;
    }
}

function normalizeKey(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized;
}

export class StoragePlatform {
    constructor(options = {}) {
        this.driver = options.driver || createDefaultStorageDriver(options);
        this.migrationRegistry = options.migrationRegistry || new StorageMigrationRegistry({ driver: this.driver });
        this.onQuotaExceeded = typeof options.onQuotaExceeded === 'function'
            ? options.onQuotaExceeded
            : null;
        this.onMigrationResult = typeof options.onMigrationResult === 'function'
            ? options.onMigrationResult
            : null;
        this._migrationResults = new Map();
    }

    readRaw(primaryKey, legacyKeys = []) {
        return this.migrationRegistry.resolve(primaryKey, legacyKeys);
    }

    readJson(primaryKey, legacyKeys = [], fallbackValue = null) {
        const resolved = this.readRaw(primaryKey, legacyKeys);
        if (!resolved) return fallbackValue;
        const migrationResult = this.migrationRegistry.migrate(primaryKey, resolved);
        this._storeMigrationResult(primaryKey, migrationResult);
        return parseJson(resolved.raw, fallbackValue);
    }

    writeRaw(key, rawValue) {
        const result = this.driver.writeRaw(key, rawValue);
        if (!result.ok && result.quotaExceeded && this.onQuotaExceeded) {
            this.onQuotaExceeded({
                key,
                reason: result.reason,
                quotaExceeded: true,
            });
        }
        return result;
    }

    writeJson(key, value) {
        const serialized = toJson(value);
        if (typeof serialized !== 'string') {
            return { ok: false, reason: 'serialize_failed', quotaExceeded: false };
        }
        return this.writeRaw(key, serialized);
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
        if (!normalizedPrimaryKey || !result || typeof result !== 'object') {
            return null;
        }
        this._migrationResults.set(normalizedPrimaryKey, result);
        if (this.onMigrationResult) {
            try {
                this.onMigrationResult(result);
            } catch {
                // Keep storage reads resilient even if observability hooks throw.
            }
        }
        if (
            result.attempted === true
            && result.ok !== true
            && typeof console !== 'undefined'
            && typeof console.warn === 'function'
        ) {
            console.warn(
                `[StoragePlatform] Legacy storage migration incomplete for "${normalizedPrimaryKey}" ` +
                `(status=${String(result.status || 'unknown')} reason=${String(result.reason || 'unknown')})`
            );
        }
        return result;
    }
}

export function createDefaultStoragePlatform(options = {}) {
    return new StoragePlatform(options);
}

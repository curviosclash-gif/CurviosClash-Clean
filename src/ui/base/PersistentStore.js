export function getDefaultBrowserStorage() {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
        return null;
    }
}

export class PersistentStore {
    constructor(options = {}) {
        this.storagePlatform = options.storagePlatform || null;
        this.storage = this.storagePlatform?.driver?.storage || null;
        this.storageKey = String(options.storageKey || '').trim();
        this.storageLegacyKeys = Array.isArray(options.storageLegacyKeys)
            ? [...options.storageLegacyKeys]
            : [];
    }

    readJsonRecord(fallbackValue = null) {
        if (!this.storageKey) return fallbackValue;
        return this.storagePlatform.readJson(this.storageKey, this.storageLegacyKeys, fallbackValue);
    }

    writeJsonRecord(value) {
        if (!this.storageKey) {
            return { ok: false, reason: 'missing_storage_key', quotaExceeded: false };
        }
        return this.storagePlatform.writeJson(this.storageKey, value);
    }

    removeRecord() {
        if (!this.storageKey) {
            return { ok: false, reason: 'missing_storage_key', quotaExceeded: false };
        }
        return this.storagePlatform.remove(this.storageKey);
    }
}

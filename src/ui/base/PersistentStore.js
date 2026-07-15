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
        this.persistenceStatus = { status: 'unknown', reason: '' };
    }

    _recordPersistenceResult(result) {
        const normalizedResult = result && typeof result === 'object'
            ? result
            : { ok: false, reason: 'storage_failed', quotaExceeded: false };
        this.persistenceStatus = {
            status: normalizedResult.ok === true ? 'ok' : 'failed',
            reason: String(normalizedResult.reason || (normalizedResult.ok === true ? 'ok' : 'storage_failed')),
        };
        return normalizedResult;
    }

    getPersistenceStatus() {
        return { ...this.persistenceStatus };
    }

    readJsonRecord(fallbackValue = null) {
        if (!this.storageKey) return fallbackValue;
        return this.storagePlatform.readJson(this.storageKey, this.storageLegacyKeys, fallbackValue);
    }

    writeJsonRecord(value) {
        if (!this.storageKey) {
            return this._recordPersistenceResult({ ok: false, reason: 'missing_storage_key', quotaExceeded: false });
        }
        try {
            return this._recordPersistenceResult(this.storagePlatform.writeJson(this.storageKey, value));
        } catch (error) {
            return this._recordPersistenceResult({
                ok: false,
                reason: String(error?.message || 'storage_failed'),
                quotaExceeded: false,
            });
        }
    }

    removeRecord() {
        if (!this.storageKey) {
            return this._recordPersistenceResult({ ok: false, reason: 'missing_storage_key', quotaExceeded: false });
        }
        try {
            return this._recordPersistenceResult(this.storagePlatform.remove(this.storageKey));
        } catch (error) {
            return this._recordPersistenceResult({
                ok: false,
                reason: String(error?.message || 'storage_failed'),
                quotaExceeded: false,
            });
        }
    }
}

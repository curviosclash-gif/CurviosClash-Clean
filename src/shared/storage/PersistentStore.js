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
        this.unpreservedRejectedRecord = null;
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

    // A record in a schema this build cannot read (for example written by a newer app version) is
    // copied to a side key before defaults take over, so the next save cannot destroy it. While the
    // copy fails, writes to the primary key are refused instead of overwriting the only copy.
    preserveRejectedRecord(record) {
        if (!this.storageKey || !this.storagePlatform) return true;
        const backupKey = `${this.storageKey}.rejected`;
        let serialized = null;
        try { serialized = JSON.stringify(record); } catch { serialized = null; }
        let preserved = false;
        try {
            preserved = typeof serialized === 'string'
                && (this.storagePlatform.readRaw(backupKey)?.raw === serialized
                    || (this.storagePlatform.writeRaw(backupKey, serialized)?.ok === true
                        && this.storagePlatform.readRaw(backupKey)?.raw === serialized));
        } catch {
            preserved = false;
        }
        this.unpreservedRejectedRecord = preserved ? null : record;
        if (!preserved) {
            this._recordPersistenceResult({ ok: false, reason: 'rejected_record_unpreserved', quotaExceeded: false });
        }
        return preserved;
    }

    _guardUnpreservedRejectedRecord() {
        if (!this.unpreservedRejectedRecord || this.preserveRejectedRecord(this.unpreservedRejectedRecord)) return null;
        return this._recordPersistenceResult({ ok: false, reason: 'rejected_record_unpreserved', quotaExceeded: false });
    }

    writeJsonRecord(value) {
        if (!this.storageKey) {
            return this._recordPersistenceResult({ ok: false, reason: 'missing_storage_key', quotaExceeded: false });
        }
        const blocked = this._guardUnpreservedRejectedRecord();
        if (blocked) return blocked;
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
        const blocked = this._guardUnpreservedRejectedRecord();
        if (blocked) return blocked;
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

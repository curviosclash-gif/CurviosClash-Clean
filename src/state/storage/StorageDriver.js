import { resolveLocalStorage } from '../../shared/runtime/BrowserStoragePorts.js';

function resolveQuotaExceeded(error) {
    const message = String(error?.message || '').toLowerCase();
    const name = String(error?.name || '').toLowerCase();
    return (
        name.includes('quota')
        || message.includes('quota')
        || message.includes('exceeded')
        || Number(error?.code) === 22
        || Number(error?.code) === 1014
    );
}

export class StorageDriver {
    constructor(options = {}) {
        this.storage = options.storage || null;
    }

    readRaw(key) {
        if (!this.storage || typeof this.storage.getItem !== 'function') {
            return { ok: false, value: null, reason: 'storage_unavailable' };
        }
        try {
            return { ok: true, value: this.storage.getItem(key), reason: 'ok' };
        } catch (error) {
            return { ok: false, value: null, reason: String(error?.message || 'read_failed') };
        }
    }

    writeRaw(key, value) {
        if (!this.storage || typeof this.storage.setItem !== 'function') {
            return { ok: false, quotaExceeded: false, reason: 'storage_unavailable' };
        }
        try {
            this.storage.setItem(key, value);
            return { ok: true, quotaExceeded: false, reason: 'ok' };
        } catch (error) {
            return {
                ok: false,
                quotaExceeded: resolveQuotaExceeded(error),
                reason: String(error?.message || 'write_failed'),
            };
        }
    }

    remove(key) {
        if (!this.storage || typeof this.storage.removeItem !== 'function') {
            return { ok: false, reason: 'storage_unavailable' };
        }
        try {
            this.storage.removeItem(key);
            return { ok: true, reason: 'ok' };
        } catch (error) {
            return { ok: false, reason: String(error?.message || 'remove_failed') };
        }
    }
}

export function resolveDefaultStorage(runtimeGlobal = null) {
    return resolveLocalStorage(null, runtimeGlobal);
}

export function createDefaultStorageDriver(options = {}) {
    return new StorageDriver({
        storage: options.storage ?? resolveDefaultStorage(options.runtimeGlobal),
    });
}

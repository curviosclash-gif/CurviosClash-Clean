import { createDefaultStoragePlatform } from '../storage/StoragePlatform.js';
import {
    normalizeTelemetryPreferences,
    TELEMETRY_PREFERENCES_STORAGE_KEY,
} from '../contracts/TelemetryPreferencesContract.js';

export class TelemetryPreferencesStore {
    constructor(options = {}) {
        this.storageKey = TELEMETRY_PREFERENCES_STORAGE_KEY;
        this.storagePlatform = options.storagePlatform || createDefaultStoragePlatform({
            storage: options.storage,
            runtimeGlobal: options.runtimeGlobal || globalThis,
        });
    }

    getSnapshot() {
        return normalizeTelemetryPreferences(this.storagePlatform.readJson(this.storageKey, [], null));
    }

    isCollectionEnabled() {
        return this.getSnapshot().collectionEnabled;
    }

    setCollectionEnabled(enabled) {
        const next = normalizeTelemetryPreferences({
            collectionEnabled: enabled === true,
            updatedAt: new Date().toISOString(),
        });
        const result = this.storagePlatform.writeJson(this.storageKey, next);
        return { ...next, saved: result?.ok === true };
    }
}

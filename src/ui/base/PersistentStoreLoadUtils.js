import { createDefaultStoragePlatform } from '../../state/storage/StoragePlatform.js';
import { getDefaultBrowserStorage } from './PersistentStore.js';
import { resolveArtifactVersionState } from '../../shared/contracts/ArtifactVersionMigrationContract.js';

/**
 * Resolves the storagePlatform/storageKey/storageLegacyKeys triple
 * used by PersistentStore subclasses, eliminating repeated constructor boilerplate.
 *
 * @param {object} options - Options passed to the store constructor.
 * @param {string} defaultStorageKey - Default primary storage key.
 * @param {readonly string[]} defaultLegacyKeys - Default list of legacy storage keys for migration.
 * @returns {{ storagePlatform, storageKey, storageLegacyKeys }}
 */
export function resolveStorePlatformOptions(options, defaultStorageKey, defaultLegacyKeys) {
    return {
        storagePlatform: options.storagePlatform || createDefaultStoragePlatform({
            storage: options.storage ?? getDefaultBrowserStorage(),
            onQuotaExceeded: options.onQuotaExceeded,
            onMigrationResult: options.onMigrationResult,
        }),
        storageKey: options.storageKey || defaultStorageKey,
        storageLegacyKeys: Array.isArray(options.storageLegacyKeys)
            ? [...options.storageLegacyKeys]
            : [...defaultLegacyKeys],
    };
}

/**
 * Loads a versioned JSON record with version-resolution, reject-early-return,
 * and fallback-persistence, wrapped in a try/catch that returns the default on failure.
 *
 * @param {Function} readRecord - Returns the parsed JSON record (may be null/undefined).
 * @param {object} opts
 * @param {string} opts.artifactType - Identifier for resolveArtifactVersionState.
 * @param {string} opts.schemaVersion - Current schema version string.
 * @param {Function} opts.createDefault - Returns a fresh default value (called on missing/rejected/error).
 * @param {Function} opts.transform - (parsed, versionState) => normalized value.
 * @param {Function} [opts.onUpgrade] - Called with the normalized value when shouldFallback/shouldUpgrade.
 * @param {Function} [opts.onLoadError] - Called with (error, artifactType) on parse/transform failure.
 * @returns {*} Normalized value or the default on parse failure.
 */
export function loadVersionedRecord(readRecord, { artifactType, schemaVersion, createDefault, transform, onUpgrade, onLoadError }) {
    try {
        const parsed = readRecord();
        if (!parsed || typeof parsed !== 'object') return createDefault();
        const versionState = resolveArtifactVersionState(parsed, {
            artifactType,
            versionFields: ['schemaVersion'],
            supportedVersions: [schemaVersion],
            currentVersion: schemaVersion,
            allowMissingVersion: true,
        });
        if (versionState.shouldReject) return createDefault();
        const normalized = transform(parsed, versionState);
        if ((versionState.shouldFallback || versionState.shouldUpgrade) && onUpgrade) {
            onUpgrade(normalized);
        }
        return normalized;
    } catch (error) {
        if (typeof onLoadError === 'function') {
            try { onLoadError(error, artifactType); } catch { /* keep storage reads resilient */ }
        } else if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn(`[PersistentStore] Failed to load "${artifactType}", using defaults.`, error);
        }
        return createDefault();
    }
}

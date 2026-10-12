export const TELEMETRY_PREFERENCES_SCHEMA_VERSION = 'telemetry-preferences.v1';
export const TELEMETRY_PREFERENCES_STORAGE_KEY = 'cuviosclash.telemetry-preferences.v1';

// Decision 12.10.2026: until release local telemetry is always on and players have no switch;
// a release build carries no telemetry at all (scripts/check-release-telemetry-boundary.mjs).
// A stored "off" from the old menu switch is kept in storage but no longer read.
export const TELEMETRY_COLLECTION_ALWAYS_ON = true;

export function normalizeTelemetryPreferences(source = null) {
    const value = source && typeof source === 'object' ? source : {};
    return {
        schemaVersion: TELEMETRY_PREFERENCES_SCHEMA_VERSION,
        collectionEnabled: TELEMETRY_COLLECTION_ALWAYS_ON || value.collectionEnabled !== false,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    };
}

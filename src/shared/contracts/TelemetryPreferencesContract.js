export const TELEMETRY_PREFERENCES_SCHEMA_VERSION = 'telemetry-preferences.v1';
export const TELEMETRY_PREFERENCES_STORAGE_KEY = 'cuviosclash.telemetry-preferences.v1';

export function normalizeTelemetryPreferences(source = null) {
    const value = source && typeof source === 'object' ? source : {};
    return {
        schemaVersion: TELEMETRY_PREFERENCES_SCHEMA_VERSION,
        collectionEnabled: value.collectionEnabled !== false,
        updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
    };
}

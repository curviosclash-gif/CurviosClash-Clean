const APP_STORAGE_NAMESPACE = 'cuviosclash';
const LEGACY_APP_STORAGE_NAMESPACE = 'aero-arena-3d';

function buildStorageKey(namespace, suffix) {
    return `${namespace}.${suffix}`;
}

export const STORAGE_KEYS = Object.freeze({
    settings: buildStorageKey(APP_STORAGE_NAMESPACE, 'settings.v1'),
    settingsProfiles: buildStorageKey(APP_STORAGE_NAMESPACE, 'settings-profiles.v1'),
    menuPresets: buildStorageKey(APP_STORAGE_NAMESPACE, 'menu-presets.v1'),
    menuTextOverrides: buildStorageKey(APP_STORAGE_NAMESPACE, 'menu-text-overrides.v1'),
    menuTelemetry: buildStorageKey(APP_STORAGE_NAMESPACE, 'menu-telemetry.v1'),
    menuDrafts: buildStorageKey(APP_STORAGE_NAMESPACE, 'menu-drafts.v1'),
    // Note: arcadeVehicleProfile key is owned by src/state/arcade/ArcadeVehicleProfile.js
    // and must match: 'cuviosclash.arcade-vehicle-profile.v1'
    arcadeVehicleProfile: buildStorageKey(APP_STORAGE_NAMESPACE, 'arcade-vehicle-profile.v1'),
});

export const LEGACY_STORAGE_KEYS = Object.freeze({
    settings: Object.freeze([
        buildStorageKey(LEGACY_APP_STORAGE_NAMESPACE, 'settings.v1'),
        'mini-curve-fever-3d.settings.v4',
        'mini-curve-fever-3d.settings.v3',
    ]),
    settingsProfiles: Object.freeze([buildStorageKey(LEGACY_APP_STORAGE_NAMESPACE, 'settings-profiles.v1')]),
    menuPresets: Object.freeze([buildStorageKey(LEGACY_APP_STORAGE_NAMESPACE, 'menu-presets.v1')]),
    menuTextOverrides: Object.freeze([buildStorageKey(LEGACY_APP_STORAGE_NAMESPACE, 'menu-text-overrides.v1')]),
    menuTelemetry: Object.freeze([buildStorageKey(LEGACY_APP_STORAGE_NAMESPACE, 'menu-telemetry.v1')]),
    menuDrafts: Object.freeze([buildStorageKey(LEGACY_APP_STORAGE_NAMESPACE, 'menu-drafts.v1')]),
    arcadeVehicleProfile: Object.freeze([]),
});

export function readFirstAvailableStorageValue(storage, primaryKey, legacyKeys = []) {
    if (!storage || typeof storage.getItem !== 'function') {
        return null;
    }

    const keys = [primaryKey, ...legacyKeys];
    for (const candidate of keys) {
        const key = String(candidate || '').trim();
        if (!key) continue;
        const raw = storage.getItem(key);
        if (typeof raw !== 'string' || raw.length === 0) continue;
        return { key, raw };
    }
    return null;
}

export function migrateStorageValue(storage, primaryKey, resolvedEntry) {
    if (!storage || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
        return {
            primaryKey: String(primaryKey || '').trim(),
            sourceKey: String(resolvedEntry?.key || '').trim(),
            attempted: false,
            migrated: false,
            ok: true,
            writeOk: false,
            removeOk: false,
            status: 'idle',
            reason: 'missing_migration_context',
        };
    }

    const key = String(primaryKey || '').trim();
    if (!key || !resolvedEntry || resolvedEntry.key === key) {
        return {
            primaryKey: key,
            sourceKey: String(resolvedEntry?.key || '').trim(),
            attempted: false,
            migrated: false,
            ok: true,
            writeOk: false,
            removeOk: false,
            status: key && resolvedEntry?.key === key ? 'current_key' : 'idle',
            reason: key && resolvedEntry?.key === key ? 'already_current' : 'missing_migration_context',
        };
    }

    try {
        storage.setItem(key, resolvedEntry.raw);
    } catch (error) {
        return {
            primaryKey: key,
            sourceKey: String(resolvedEntry?.key || '').trim(),
            attempted: true,
            migrated: false,
            ok: false,
            writeOk: false,
            removeOk: false,
            status: 'write_failed',
            reason: String(error?.message || 'write_failed'),
        };
    }

    try {
        storage.removeItem(resolvedEntry.key);
        return {
            primaryKey: key,
            sourceKey: String(resolvedEntry?.key || '').trim(),
            attempted: true,
            migrated: true,
            ok: true,
            writeOk: true,
            removeOk: true,
            status: 'migrated',
            reason: 'ok',
        };
    } catch (error) {
        return {
            primaryKey: key,
            sourceKey: String(resolvedEntry?.key || '').trim(),
            attempted: true,
            migrated: false,
            ok: false,
            writeOk: true,
            removeOk: false,
            status: 'remove_failed',
            reason: String(error?.message || 'remove_failed'),
        };
    }
}

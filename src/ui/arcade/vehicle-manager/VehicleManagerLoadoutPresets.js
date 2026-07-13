import { resolveArtifactVersionState } from '../../../shared/contracts/ArtifactVersionMigrationContract.js';
import { isArcadeVehicleUpgradeSlot } from '../../../shared/contracts/ArcadeVehicleProfileContract.js';

const VEHICLE_LOADOUT_PRESET_STORAGE_KEY = 'cuviosclash.arcade-vehicle-loadouts.v1';
const VEHICLE_LOADOUT_PRESET_SCHEMA = 'arcade-vehicle-loadouts.v1';

function isPersistenceSuccess(result) {
    return result === undefined || result === true || result?.success === true;
}

function warnPersistenceFailure(contextLabel, result) {
    if (isPersistenceSuccess(result)) return;
    if (typeof console === 'undefined' || typeof console.warn !== 'function') return;
    console.warn(`[VehicleManagerLoadoutPresets] ${String(contextLabel || 'save')} failed`, {
        reason: String(result?.reason || ''),
        metadata: result?.metadata && typeof result.metadata === 'object'
            ? { ...result.metadata }
            : null,
    });
}

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function normalizeVehicleId(value, fallback = 'ship5') {
    return normalizeString(value, fallback).toLowerCase();
}

function toSafeTimestamp(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : Date.now();
}

function toSafeUpgradeMap(source) {
    const result = {};
    const invalidEntries = [];
    if (!source || typeof source !== 'object') {
        return { upgrades: result, invalidEntries };
    }
    const keys = Object.keys(source);
    for (let index = 0; index < keys.length; index += 1) {
        const key = normalizeString(keys[index]);
        if (!key) continue;
        const normalizedKey = key.toLowerCase();
        const value = normalizeString(source[key], 'T1').toUpperCase();
        if (!isArcadeVehicleUpgradeSlot(normalizedKey)) {
            invalidEntries.push({
                slotName: normalizedKey,
                targetTier: value,
                code: 'invalid_slot',
            });
            continue;
        }
        if (value !== 'T1' && value !== 'T2' && value !== 'T3') {
            invalidEntries.push({
                slotName: normalizedKey,
                targetTier: value,
                code: 'invalid_tier',
            });
            continue;
        }
        result[normalizedKey] = value;
    }
    return { upgrades: result, invalidEntries };
}

function safeReadFromLocalStorage() {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
        return window.localStorage.getItem(VEHICLE_LOADOUT_PRESET_STORAGE_KEY);
    } catch {
        return null;
    }
}

function safeWriteToLocalStorage(value) {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
        window.localStorage.setItem(VEHICLE_LOADOUT_PRESET_STORAGE_KEY, value);
    } catch {
        // ignore write failures
    }
}

function sanitizePresetRecord(source) {
    const normalized = source && typeof source === 'object' ? source : {};
    const normalizedVehicleId = normalizeVehicleId(normalized.vehicleId, 'ship5');
    const normalizedPresetId = normalizeString(normalized.presetId, `preset-${toSafeTimestamp(normalized.updatedAtMs)}`);
    const sanitizedUpgrades = toSafeUpgradeMap(normalized.upgrades);
    return {
        presetId: normalizedPresetId,
        vehicleId: normalizedVehicleId,
        name: normalizeString(normalized.name, normalizedPresetId),
        upgrades: sanitizedUpgrades.upgrades,
        invalidEntries: sanitizedUpgrades.invalidEntries,
        updatedAtMs: toSafeTimestamp(normalized.updatedAtMs),
    };
}

function sanitizeStorePayload(source) {
    const normalized = source && typeof source === 'object' ? source : {};
    const items = Array.isArray(normalized.presets) ? normalized.presets : [];
    const presets = items.map((entry) => sanitizePresetRecord(entry));
    return {
        schemaVersion: VEHICLE_LOADOUT_PRESET_SCHEMA,
        presets,
    };
}

function resolvePersistedPayload(source) {
    if (Array.isArray(source)) {
        return {
            payload: sanitizeStorePayload({ presets: source }),
            shouldPersist: true,
        };
    }
    if (!source || typeof source !== 'object') {
        return {
            payload: sanitizeStorePayload(null),
            shouldPersist: false,
        };
    }
    const versionState = resolveArtifactVersionState(source, {
        artifactType: 'arcade-vehicle-loadouts',
        versionFields: ['schemaVersion'],
        supportedVersions: [VEHICLE_LOADOUT_PRESET_SCHEMA],
        currentVersion: VEHICLE_LOADOUT_PRESET_SCHEMA,
        allowMissingVersion: true,
    });
    if (versionState.shouldReject) {
        return {
            payload: sanitizeStorePayload(null),
            shouldPersist: true,
        };
    }
    const rawPayload = versionState.hasVersionField
        ? source
        : (Array.isArray(source?.presets) ? source : { presets: source?.presets || [] });
    return {
        payload: sanitizeStorePayload(rawPayload),
        shouldPersist: versionState.shouldFallback || versionState.shouldUpgrade,
    };
}

function loadPayload(store) {
    if (store && typeof store.loadJsonRecord === 'function') {
        const loaded = store.loadJsonRecord(VEHICLE_LOADOUT_PRESET_STORAGE_KEY, null);
        const resolved = resolvePersistedPayload(loaded);
        if (resolved.shouldPersist && typeof store.saveJsonRecord === 'function') {
            const saveResult = store.saveJsonRecord(VEHICLE_LOADOUT_PRESET_STORAGE_KEY, resolved.payload);
            warnPersistenceFailure('canonical write-back', saveResult);
        }
        return resolved.payload;
    }
    const raw = safeReadFromLocalStorage();
    if (!raw) return sanitizeStorePayload(null);
    try {
        const resolved = resolvePersistedPayload(JSON.parse(raw));
        if (resolved.shouldPersist) {
            safeWriteToLocalStorage(JSON.stringify(resolved.payload));
        }
        return resolved.payload;
    } catch (error) {
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            console.warn('[VehicleManagerLoadoutPresets] loadPayload failed, using empty store.', error);
        }
        return sanitizeStorePayload(null);
    }
}

function persistPayload(store, payload) {
    const normalized = sanitizeStorePayload(payload);
    if (store && typeof store.saveJsonRecord === 'function') {
        const saveResult = store.saveJsonRecord(VEHICLE_LOADOUT_PRESET_STORAGE_KEY, normalized);
        warnPersistenceFailure('persistPayload', saveResult);
        return;
    }
    safeWriteToLocalStorage(JSON.stringify(normalized));
}

function createPresetId(vehicleId, name) {
    const prefix = normalizeString(name, vehicleId)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `${prefix || 'preset'}-${Date.now()}`;
}

export function createVehicleManagerLoadoutPresetStore({ store } = {}) {
    let payload = loadPayload(store);

    function persist() {
        persistPayload(store, payload);
    }

    function listPresets(vehicleId) {
        const normalizedVehicleId = normalizeVehicleId(vehicleId);
        return payload.presets
            .filter((entry) => entry.vehicleId === normalizedVehicleId)
            .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
            .map((entry) => ({
                presetId: entry.presetId,
                vehicleId: entry.vehicleId,
                name: entry.name,
                upgrades: { ...entry.upgrades },
                invalidEntries: Array.isArray(entry.invalidEntries) ? entry.invalidEntries.map((item) => ({ ...item })) : [],
                updatedAtMs: entry.updatedAtMs,
            }));
    }

    function savePreset(vehicleId, name, upgrades) {
        const normalizedVehicleId = normalizeVehicleId(vehicleId);
        const normalizedName = normalizeString(name, 'Preset');
        const nowMs = Date.now();
        const presetId = createPresetId(normalizedVehicleId, normalizedName);
        const nextPreset = sanitizePresetRecord({
            presetId,
            vehicleId: normalizedVehicleId,
            name: normalizedName,
            upgrades,
            updatedAtMs: nowMs,
        });
        payload.presets.unshift(nextPreset);
        if (payload.presets.length > 120) {
            payload.presets = payload.presets.slice(0, 120);
        }
        persist();
        return { ...nextPreset, upgrades: { ...nextPreset.upgrades } };
    }

    function deletePreset(vehicleId, presetId) {
        const normalizedVehicleId = normalizeVehicleId(vehicleId);
        const normalizedPresetId = normalizeString(presetId);
        const beforeCount = payload.presets.length;
        payload.presets = payload.presets.filter((entry) => {
            return !(entry.vehicleId === normalizedVehicleId && entry.presetId === normalizedPresetId);
        });
        if (payload.presets.length !== beforeCount) {
            persist();
            return true;
        }
        return false;
    }

    function loadPreset(vehicleId, presetId) {
        const normalizedVehicleId = normalizeVehicleId(vehicleId);
        const normalizedPresetId = normalizeString(presetId);
        const found = payload.presets.find((entry) => {
            return entry.vehicleId === normalizedVehicleId && entry.presetId === normalizedPresetId;
        });
        if (!found) return null;
        return {
            presetId: found.presetId,
            vehicleId: found.vehicleId,
            name: found.name,
            upgrades: { ...found.upgrades },
            invalidEntries: Array.isArray(found.invalidEntries) ? found.invalidEntries.map((item) => ({ ...item })) : [],
            updatedAtMs: found.updatedAtMs,
        };
    }

    return {
        listPresets,
        savePreset,
        deletePreset,
        loadPreset,
    };
}

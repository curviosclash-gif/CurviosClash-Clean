import {
    HANGAR_BUILD_STORAGE_KEYS,
    HANGAR_CAPABILITY_IDS,
} from '../../shared/contracts/HangarModeContract.js';
import { createHangarWorkshopPersistenceFacade } from './HangarWorkshopPersistenceFacade.js';
import { cloneHangarBuild, normalizeHangarBuild } from './HangarBuildDraftState.js';

export const HANGAR_BUILD_STORE_SCHEMA_VERSION = 'hangar-build-store.v2';
export { HANGAR_BUILD_STORAGE_KEYS };
export const LEGACY_ARCADE_LOADOUT_STORAGE_KEY = 'cuviosclash.arcade-vehicle-loadouts.v1';

function normalizeMode(value) {
    return String(value || '').trim().toLowerCase() === 'fight' ? 'fight' : 'arcade';
}

function cloneRecord(record) {
    return {
        schemaVersion: HANGAR_BUILD_STORE_SCHEMA_VERSION,
        mode: record.mode,
        builds: record.builds.map(cloneHangarBuild),
        activeBuildByVehicle: { ...record.activeBuildByVehicle },
    };
}

function normalizeRecord(source, mode = 'arcade') {
    const normalizedMode = normalizeMode(mode);
    const record = source && typeof source === 'object' ? source : {};
    const sourceBuilds = Array.isArray(record.builds)
        ? record.builds
        : (Array.isArray(record.presets) ? record.presets : []);
    const builds = [];
    const ids = new Set();
    for (const sourceBuild of sourceBuilds.slice(0, 120)) {
        const build = normalizeHangarBuild({ ...sourceBuild, mode: normalizedMode });
        if (ids.has(build.buildId)) continue;
        ids.add(build.buildId);
        builds.push(build);
    }
    const activeBuildByVehicle = {};
    const sourceActive = record.activeBuildByVehicle && typeof record.activeBuildByVehicle === 'object'
        ? record.activeBuildByVehicle
        : {};
    for (const [vehicleId, buildId] of Object.entries(sourceActive)) {
        if (builds.some((build) => build.buildId === buildId && build.vehicleId === vehicleId)) {
            activeBuildByVehicle[vehicleId] = buildId;
        }
    }
    return { schemaVersion: HANGAR_BUILD_STORE_SCHEMA_VERSION, mode: normalizedMode, builds, activeBuildByVehicle };
}

function isPersistenceSuccess(result) {
    return result === undefined || result === true || result?.success === true;
}

function saveRecord(store, key, record) {
    if (!store || typeof store.saveJsonRecord !== 'function') return { ok: false, code: 'store_unavailable' };
    const result = store.saveJsonRecord(key, record);
    return isPersistenceSuccess(result)
        ? { ok: true, record: cloneRecord(record) }
        : { ok: false, code: String(result?.reason || 'persistence_failed') };
}

export function readActiveHangarBuildFromStore({ store, mode = 'arcade', vehicleId = 'ship5' } = {}) {
    const normalizedMode = normalizeMode(mode);
    const normalizedVehicleId = String(vehicleId || 'ship5').trim().toLowerCase() || 'ship5';
    if (!store || typeof store.loadJsonRecord !== 'function') return null;
    const record = normalizeRecord(store.loadJsonRecord(HANGAR_BUILD_STORAGE_KEYS[normalizedMode], null), normalizedMode);
    const buildId = record.activeBuildByVehicle[normalizedVehicleId];
    return cloneHangarBuild(record.builds.find((build) => build.buildId === buildId && build.vehicleId === normalizedVehicleId));
}

export function createSettingsRecordHangarCapability({ store, mode = 'arcade' } = {}) {
    const normalizedMode = normalizeMode(mode);
    const storageKey = HANGAR_BUILD_STORAGE_KEYS[normalizedMode];

    function loadRecord() {
        if (!store || typeof store.loadJsonRecord !== 'function') {
            return { record: normalizeRecord(null, normalizedMode), migration: null };
        }
        const raw = store.loadJsonRecord(storageKey, null);
        if (raw && typeof raw === 'object') {
            return { record: normalizeRecord(raw, normalizedMode), migration: null };
        }
        if (normalizedMode === 'arcade') {
            const legacy = store.loadJsonRecord(LEGACY_ARCADE_LOADOUT_STORAGE_KEY, null);
            if (legacy && typeof legacy === 'object') {
                const migrated = normalizeRecord(legacy, normalizedMode);
                const persistence = saveRecord(store, storageKey, migrated);
                return {
                    record: migrated,
                    migration: {
                        attempted: true,
                        ok: persistence.ok === true,
                        code: persistence.ok === true ? 'migrated' : persistence.code,
                        sourceKey: LEGACY_ARCADE_LOADOUT_STORAGE_KEY,
                        storageKey,
                    },
                };
            }
        }
        return { record: normalizeRecord(null, normalizedMode), migration: null };
    }

    return (capabilityId, payload = {}) => {
        const loaded = loadRecord();
        const record = loaded.record;
        if (capabilityId === HANGAR_CAPABILITY_IDS.LOAD_CUSTOM_BLUEPRINT) {
            return {
                ok: loaded.migration?.ok !== false,
                code: loaded.migration?.ok === false ? loaded.migration.code : undefined,
                record: cloneRecord(record),
                migration: loaded.migration,
            };
        }
        if (capabilityId === HANGAR_CAPABILITY_IDS.SAVE_CUSTOM_BLUEPRINT) {
            const build = normalizeHangarBuild({ ...(payload.build || payload), mode: normalizedMode });
            const index = record.builds.findIndex((entry) => entry.buildId === build.buildId);
            if (index >= 0) record.builds[index] = build;
            else record.builds.unshift(build);
            if (payload.activate === true) record.activeBuildByVehicle[build.vehicleId] = build.buildId;
            return saveRecord(store, storageKey, record);
        }
        if (capabilityId === HANGAR_CAPABILITY_IDS.RENAME_CUSTOM_BLUEPRINT) {
            const buildId = String(payload.buildId || payload.id || '').trim();
            const build = record.builds.find((entry) => entry.buildId === buildId);
            if (!build) return { ok: false, code: 'build_not_found', message: 'Build nicht gefunden' };
            build.name = String(payload.name || '').trim() || build.name;
            build.updatedAtMs = Math.max(build.updatedAtMs + 1, Date.now());
            return saveRecord(store, storageKey, record);
        }
        if (capabilityId === HANGAR_CAPABILITY_IDS.DELETE_CUSTOM_BLUEPRINT) {
            const buildId = String(payload.buildId || payload.id || '').trim();
            const before = record.builds.length;
            record.builds = record.builds.filter((entry) => entry.buildId !== buildId);
            if (record.builds.length === before) return { ok: false, code: 'build_not_found', message: 'Build nicht gefunden' };
            for (const [vehicleId, activeBuildId] of Object.entries(record.activeBuildByVehicle)) {
                if (activeBuildId === buildId) delete record.activeBuildByVehicle[vehicleId];
            }
            return saveRecord(store, storageKey, record);
        }
        return { ok: false, code: 'capability_unavailable' };
    };
}

function unwrapRecord(facadeResult, fallback, mode) {
    const record = facadeResult?.result?.record || facadeResult?.result?.result?.record;
    return record ? normalizeRecord(record, mode) : fallback;
}

function createBuildId(vehicleId, name) {
    const prefix = String(name || 'build').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'build';
    return `${prefix}-${String(vehicleId || 'ship5').toLowerCase()}-${Date.now()}`;
}

export function createHangarBuildPersistenceAdapter(options = {}) {
    const mode = normalizeMode(options.mode);
    const invokeCapability = typeof options.invokeCapability === 'function'
        ? options.invokeCapability
        : createSettingsRecordHangarCapability({ store: options.store, mode });
    const facade = createHangarWorkshopPersistenceFacade({ invokeCapability });
    let record = normalizeRecord(null, mode);
    let localRevision = 0;

    async function hydrate() {
        const revisionAtStart = localRevision;
        const result = await facade.loadCustomVehicle({ mode, all: true });
        if (revisionAtStart === localRevision) record = unwrapRecord(result, record, mode);
        return { ok: result.ok === true, record: cloneRecord(record), result };
    }

    function listBuilds(vehicleId = '') {
        const normalizedVehicleId = String(vehicleId || '').trim().toLowerCase();
        return record.builds
            .filter((build) => !normalizedVehicleId || build.vehicleId === normalizedVehicleId)
            .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
            .map(cloneHangarBuild);
    }

    function listBuildsSorted(vehicleId = '', sort = 'updated') {
        const builds = listBuilds(vehicleId);
        if (sort === 'name') return builds.sort((a, b) => a.name.localeCompare(b.name, 'de'));
        if (sort === 'favorite') return builds.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAtMs - a.updatedAtMs);
        return builds;
    }

    function getBuild(buildId) {
        return cloneHangarBuild(record.builds.find((build) => build.buildId === buildId));
    }

    function getActiveBuild(vehicleId) {
        const normalizedVehicleId = String(vehicleId || '').trim().toLowerCase();
        return getBuild(record.activeBuildByVehicle[normalizedVehicleId]);
    }

    function upsertLocal(build, activate = false) {
        const normalized = normalizeHangarBuild({ ...build, mode });
        const index = record.builds.findIndex((entry) => entry.buildId === normalized.buildId);
        if (index >= 0) record.builds[index] = normalized;
        else record.builds.unshift(normalized);
        if (activate) record.activeBuildByVehicle[normalized.vehicleId] = normalized.buildId;
        return normalized;
    }

    async function saveBuild(build, saveOptions = {}) {
        const source = normalizeHangarBuild(build);
        const asNew = saveOptions.asNew === true;
        const next = normalizeHangarBuild({
            ...source,
            buildId: asNew ? createBuildId(source.vehicleId, saveOptions.name || source.name) : source.buildId,
            name: String(saveOptions.name || source.name).trim() || source.name,
            createdAtMs: asNew ? Date.now() : source.createdAtMs,
            updatedAtMs: Date.now(),
        });
        localRevision += 1;
        const result = await facade.saveCustomVehicle({ mode, build: next, activate: saveOptions.activate === true });
        if (result.ok === true) upsertLocal(next, saveOptions.activate === true);
        return { ok: result.ok === true, build: cloneHangarBuild(next), result };
    }

    async function renameBuild(buildId, name) {
        const build = record.builds.find((entry) => entry.buildId === buildId);
        if (!build) return { ok: false, code: 'build_not_found' };
        const next = normalizeHangarBuild({
            ...build,
            name: String(name || '').trim() || build.name,
            updatedAtMs: Date.now(),
        });
        localRevision += 1;
        const result = await facade.renameCustomVehicle({ mode, buildId, name: next.name });
        if (result.ok === true) upsertLocal(next);
        return { ok: result.ok === true, build: cloneHangarBuild(next), result };
    }

    async function deleteBuild(buildId) {
        if (!record.builds.some((entry) => entry.buildId === buildId)) return { ok: false, code: 'build_not_found' };
        localRevision += 1;
        const result = await facade.deleteCustomVehicle({ mode, buildId });
        if (result.ok === true) {
            record.builds = record.builds.filter((entry) => entry.buildId !== buildId);
            for (const [vehicleId, activeBuildId] of Object.entries(record.activeBuildByVehicle)) {
                if (activeBuildId === buildId) delete record.activeBuildByVehicle[vehicleId];
            }
        }
        return { ok: result.ok === true, result };
    }

    async function updateMetadata(buildId, metadata = {}) {
        const build = record.builds.find((entry) => entry.buildId === buildId);
        if (!build) return { ok: false, code: 'build_not_found' };
        const next = normalizeHangarBuild({ ...build, favorite: metadata.favorite ?? build.favorite, tags: metadata.tags ?? build.tags, updatedAtMs: Date.now() });
        return saveBuild(next, { name: next.name });
    }

    async function importBuilds(payload) {
        const candidates = Array.isArray(payload?.builds) ? payload.builds : (Array.isArray(payload) ? payload : []);
        const imported = [];
        for (const candidate of candidates.slice(0, 120)) {
            const normalized = normalizeHangarBuild(candidate);
            const result = await saveBuild(normalized, { asNew: true, name: normalized.name });
            if (result.ok) imported.push(result.build);
        }
        return { ok: imported.length > 0, builds: imported };
    }

    return Object.freeze({
        version: HANGAR_BUILD_STORE_SCHEMA_VERSION,
        mode,
        facade,
        hydrate,
        listBuilds,
        listBuildsSorted,
        getBuild,
        getActiveBuild,
        saveBuild,
        duplicateBuild: (build, name) => saveBuild(build, { asNew: true, name }),
        renameBuild,
        deleteBuild,
        updateMetadata,
        importBuilds,
        exportBuilds: (vehicleId = '') => ({ schemaVersion: HANGAR_BUILD_STORE_SCHEMA_VERSION, mode, builds: listBuilds(vehicleId) }),
        getSnapshot: () => cloneRecord(record),
    });
}

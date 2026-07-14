import { normalizeHangarBuild } from './HangarBuildDraftState.js';

export const HANGAR_DRAFT_SCHEMA_VERSION = 'hangar-draft.v1';
export const HANGAR_DRAFT_STORAGE_KEYS = Object.freeze({
    arcade: 'curviosclash.hangar.arcade-drafts.v1',
    fight: 'curviosclash.hangar.fight-drafts.v1',
});

export function createHangarDraftPersistence({ store, mode = 'arcade' } = {}) {
    const normalizedMode = mode === 'fight' ? 'fight' : 'arcade';
    const key = HANGAR_DRAFT_STORAGE_KEYS[normalizedMode];
    function readRecord() {
        const record = store?.loadJsonRecord?.(key, null);
        if (record?.schemaVersion !== HANGAR_DRAFT_SCHEMA_VERSION) return { schemaVersion: HANGAR_DRAFT_SCHEMA_VERSION, mode: normalizedMode, draftsByVehicle: {} };
        if (record.draftsByVehicle && typeof record.draftsByVehicle === 'object') return record;
        const legacyBuild = record.build?.vehicleId ? { [record.build.vehicleId]: record.build } : {};
        return { schemaVersion: HANGAR_DRAFT_SCHEMA_VERSION, mode: normalizedMode, draftsByVehicle: legacyBuild };
    }
    function load(vehicleId) {
        const build = readRecord().draftsByVehicle?.[vehicleId];
        return build ? normalizeHangarBuild(build) : null;
    }
    function save(build) {
        const normalized = normalizeHangarBuild(build);
        const record = readRecord();
        record.draftsByVehicle = { ...record.draftsByVehicle, [normalized.vehicleId]: normalized };
        return store?.saveJsonRecord?.(key, record);
    }
    function clear(vehicleId = '') {
        const record = readRecord();
        if (vehicleId) delete record.draftsByVehicle[vehicleId];
        else record.draftsByVehicle = {};
        return store?.saveJsonRecord?.(key, record);
    }
    return Object.freeze({ version: HANGAR_DRAFT_SCHEMA_VERSION, key, load, save, clear });
}

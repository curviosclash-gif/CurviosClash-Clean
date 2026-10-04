import { ARCADE_VEHICLE_PROFILE_STORAGE_KEY } from '../../shared/contracts/ArcadeVehicleProfileContract.js';
import { ARCADE_STONE_WORKSHOP_STORAGE_KEY, ARCADE_STONE_WORKSHOP_SCHEMA_VERSION } from '../../shared/contracts/ArcadeStoneWorkshopContract.js';
import { HANGAR_BUILD_STORAGE_KEYS } from '../../shared/contracts/HangarModeContract.js';
import { HANGAR_BUILD_STORE_SCHEMA_VERSION } from '../hangar/HangarBuildPersistence.js';
import { HANGAR_DRAFT_STORAGE_KEYS, HANGAR_DRAFT_SCHEMA_VERSION } from '../hangar/HangarDraftPersistence.js';

export function resolveLabScopeDefinition(scope) {
    return scope === 'arcade' ? Object.freeze({ scope: 'arcade' }) : null;
}

/** Remove records tied to one Lab ID without normalizing or rewriting unrelated values. */
export function clearArcadeLabShipState(store, id, commit = () => true) {
    if (!store?.loadJsonRecord || !store?.saveJsonRecord || !/^arcade_lab_[1-9][0-9]*$/.test(String(id))) return false;
    const updates = [];
    const originals = new Map();
    const load = (key) => {
        const read = store.readJsonRecordResult?.(key);
        if (read && read.status !== 'missing' && read.status !== 'found') throw new Error('Unreadable ship records');
        const value = store.loadJsonRecord(key, null);
        originals.set(key, value);
        return value;
    };
    try {
    const profiles = load(ARCADE_VEHICLE_PROFILE_STORAGE_KEY);
    if (profiles && typeof profiles === 'object' && !Array.isArray(profiles) && Object.hasOwn(profiles, id)) {
        const next = { ...profiles }; delete next[id]; updates.push([ARCADE_VEHICLE_PROFILE_STORAGE_KEY, next]);
    }
    const drafts = load(HANGAR_DRAFT_STORAGE_KEYS.arcade);
    if (drafts?.schemaVersion === HANGAR_DRAFT_SCHEMA_VERSION && drafts.draftsByVehicle?.[id]) {
        const byVehicle = { ...drafts.draftsByVehicle }; delete byVehicle[id];
        updates.push([HANGAR_DRAFT_STORAGE_KEYS.arcade, { ...drafts, draftsByVehicle: byVehicle }]);
    }
    const builds = load(HANGAR_BUILD_STORAGE_KEYS.arcade);
    if (builds?.schemaVersion === HANGAR_BUILD_STORE_SCHEMA_VERSION) {
        const retained = builds.builds?.filter((build) => build.vehicleId !== id) || [];
        if (retained.length !== builds.builds?.length || builds.activeBuildByVehicle?.[id]) {
            const active = { ...builds.activeBuildByVehicle }; delete active[id];
            updates.push([HANGAR_BUILD_STORAGE_KEYS.arcade, { ...builds, builds: retained, activeBuildByVehicle: active }]);
        }
    }
    const loadoutsKey = 'cuviosclash.arcade-vehicle-loadouts.v1';
    const loadouts = load(loadoutsKey);
    if (loadouts?.schemaVersion === 'arcade-vehicle-loadouts.v1' && Array.isArray(loadouts.presets)) {
        const presets = loadouts.presets.filter((entry) => entry.vehicleId !== id);
        if (presets.length !== loadouts.presets.length) updates.push([loadoutsKey, { ...loadouts, presets }]);
    }
    const stones = load(ARCADE_STONE_WORKSHOP_STORAGE_KEY);
    if (stones?.schemaVersion === ARCADE_STONE_WORKSHOP_SCHEMA_VERSION && Array.isArray(stones.stones)) {
        const next = stones.stones.map((stone) => stone.placement?.vehicleId === id ? { ...stone, placement: null } : stone);
        if (next.some((stone, index) => stone !== stones.stones[index])) updates.push([ARCADE_STONE_WORKSHOP_STORAGE_KEY, { ...stones, stones: next }]);
    }
    const written = [];
    try {
        for (const [key,value] of updates) {
            const result = store.saveJsonRecord(key,value);
            if (result !== true && result?.success !== true && result?.ok !== true) throw new Error('Ship record save failed');
            written.push(key);
        }
        if (!commit()) throw new Error('Ship deletion save failed');
        return true;
    } catch {
        for (const key of written.reverse()) store.saveJsonRecord(key, originals.get(key));
        return false;
    }
    } catch { return false; }
}

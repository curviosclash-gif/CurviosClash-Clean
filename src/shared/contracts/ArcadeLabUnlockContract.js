import { ARCADE_FACTORY_VEHICLE_IDS } from './ArcadeVehicleBalanceContract.js';
import { normalizeArcadeSizeProfileFields } from './ArcadeVehicleBuildContract.js';
import { ARCADE_PART_SIZE_GROUPS } from './ArcadeVehicleSizeContract.js';

export const ARCADE_LAB_UNLOCK_STORAGE_KEY = 'curviosclash.arcade-lab.unlock.v1';
export const ARCADE_LAB_UNLOCK_SCHEMA_VERSION = 'arcade-lab-unlock.v1';

export function isArcadeVehicleFullyGrown(profile) {
    const fields = normalizeArcadeSizeProfileFields(profile);
    return fields.sizeWorkshopUnlocked && ARCADE_PART_SIZE_GROUPS.every((group) => fields.partSizes[group] === 125);
}

export function evaluateArcadeLabUnlock(profiles, factoryIds = ARCADE_FACTORY_VEHICLE_IDS) {
    const ids = Array.isArray(factoryIds) ? factoryIds : [];
    const qualifiedIds = ids.filter((id) => isArcadeVehicleFullyGrown(profiles?.[id]));
    const required = Math.ceil(ids.length * 0.75);
    return { required, qualifiedIds, met: required > 0 && qualifiedIds.length >= required };
}

export function normalizeArcadeLabUnlockRecord(raw) {
    if (raw != null && (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schemaVersion !== ARCADE_LAB_UNLOCK_SCHEMA_VERSION)) return null;
    return { schemaVersion: ARCADE_LAB_UNLOCK_SCHEMA_VERSION, unlocked: raw?.unlocked === true,
        unlockedAtMs: Number(raw?.unlockedAtMs) || 0,
        qualifiedAtUnlock: Array.isArray(raw?.qualifiedAtUnlock) ? raw.qualifiedAtUnlock.filter((id) => typeof id === 'string') : [] };
}

export function applyArcadeLabUnlock(record, evaluation, nowMs = Date.now()) {
    const previous = normalizeArcadeLabUnlockRecord(record);
    if (!previous) return { record: null, changed: false };
    if (previous.unlocked || !evaluation?.met) return { record: previous, changed: false };
    return { record: { ...previous, unlocked: true, unlockedAtMs: nowMs,
        qualifiedAtUnlock: evaluation.qualifiedIds.slice() }, changed: true };
}

export function syncArcadeLabUnlock(store, profiles, nowMs = Date.now()) {
    try {
    const read = store?.readJsonRecordResult?.(ARCADE_LAB_UNLOCK_STORAGE_KEY);
    if (read && read.status !== 'missing' && (read.status !== 'found' || read.value == null)) return { record: null, changed: false, unavailable: true };
    const raw = store?.loadJsonRecord?.(ARCADE_LAB_UNLOCK_STORAGE_KEY, null);
    const next = applyArcadeLabUnlock(raw, evaluateArcadeLabUnlock(profiles), nowMs);
    if (next.changed) {
        const saved = store?.saveJsonRecord?.(ARCADE_LAB_UNLOCK_STORAGE_KEY, next.record);
        if (!(saved === true || saved?.success === true || saved?.ok === true)) return { record: normalizeArcadeLabUnlockRecord(raw), changed: false, saveFailed: true };
    }
    return next;
    } catch { return { record: null, changed: false, unavailable: true }; }
}

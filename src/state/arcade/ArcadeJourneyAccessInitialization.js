import { ARCADE_JOURNEY_STORAGE_KEY } from '../../shared/contracts/ArcadeJourneyContract.js';
import { loadArcadeJourneyProgress } from '../../shared/contracts/ArcadeJourneyProgressContract.js';
import {
    ARCADE_RUN_PROFILE_STORAGE_KEY,
    GAUNTLET_FREE_RUN_PROFILE_STORAGE_KEY,
    LEGACY_ARCADE_RUN_PROFILE_STORAGE_KEY,
} from '../../shared/contracts/ArcadeRunSettingsContract.js';

const PORTAL_RECORD_KEY = 'curviosclash.five-portals-records.v1';

function readHistoricalRecord(store, key, field) {
    const read = store.readJsonRecordResult(key);
    if (read?.status === 'missing') return { available: true, played: false };
    if (read?.status !== 'found' || !read.value || typeof read.value !== 'object'
        || !Number.isFinite(Number(read.value[field])) || Number(read.value[field]) < 0) {
        return { available: false, played: false };
    }
    return { available: true, played: Number(read.value[field]) > 0 };
}

/** Freeze the pre-Journey entitlement before any newly started run can change its history. */
export function initializeArcadeJourneyAccess(store) {
    const loaded = loadArcadeJourneyProgress(store);
    if (loaded.status === 'unavailable') return loaded;
    if (loaded.progress.legacyAccessInitialized === true) return loaded;
    if (typeof store?.readJsonRecordResult !== 'function' || typeof store?.saveJsonRecord !== 'function') {
        return { status: 'unavailable', progress: loaded.progress };
    }
    try {
        const records = [
            readHistoricalRecord(store, ARCADE_RUN_PROFILE_STORAGE_KEY, 'runsPlayed'),
            readHistoricalRecord(store, GAUNTLET_FREE_RUN_PROFILE_STORAGE_KEY, 'runsPlayed'),
            readHistoricalRecord(store, LEGACY_ARCADE_RUN_PROFILE_STORAGE_KEY, 'runsPlayed'),
            readHistoricalRecord(store, PORTAL_RECORD_KEY, 'bestTotalMs'),
        ];
        if (records.some((record) => !record.available)) return { status: 'unavailable', progress: loaded.progress };
        const existingMedal = Object.values(loaded.progress.stages).some((stage) =>
            stage && typeof stage === 'object' && Object.values(stage.medals || {}).some((medal) =>
                Number.isInteger(medal?.medal) && medal.medal > 0));
        const grandfathered = loaded.progress.allStagesUnlocked === true
            || existingMedal || records.some((record) => record.played);
        const progress = { ...loaded.progress, legacyAccessInitialized: true,
            ...(grandfathered ? { allStagesUnlocked: true } : {}) };
        const saved = store.saveJsonRecord(ARCADE_JOURNEY_STORAGE_KEY, progress);
        return saved === true || saved?.ok === true || saved?.success === true
            ? { status: 'saved', progress } : { status: 'unavailable', progress: loaded.progress };
    } catch {
        return { status: 'unavailable', progress: loaded.progress };
    }
}

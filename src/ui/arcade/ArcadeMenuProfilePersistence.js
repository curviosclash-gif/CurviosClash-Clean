import { resolveArcadeDailySettings } from '../../shared/contracts/ArcadeDailyRulesContract.js';
import { resolveArcadeRunVehicleId } from '../../shared/contracts/ArcadeVehicleBalanceContract.js';
import {
    ARCADE_LAST_RUN_STORAGE_KEY,
    ARCADE_SEED_STORAGE_KEY,
    createArcadeLastRunRecord,
    createArcadeSeedRecord,
    readArcadeLastRunRecord,
    readArcadeSeedRecord,
} from '../../shared/contracts/ArcadeMenuPersistenceContract.js';

function safeReadLocalStorage(key) {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeWriteLocalStorage(key, value) {
    try {
        window.localStorage.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

export function loadSeed(store = null) {
    const raw = store ? store.loadJsonRecord?.(ARCADE_SEED_STORAGE_KEY, null)
        : safeReadLocalStorage(ARCADE_SEED_STORAGE_KEY);
    let parsed = raw;
    try {
        if (typeof raw !== 'string') throw new TypeError('already_parsed');
        parsed = JSON.parse(raw);
    } catch {
        // Legacy seed payloads were stored as plain integer strings.
    }
    const result = readArcadeSeedRecord(parsed);
    if (result.record) {
        if (result.shouldPersist) {
            if (store?.saveJsonRecord) store.saveJsonRecord(ARCADE_SEED_STORAGE_KEY, result.record);
            else safeWriteLocalStorage(ARCADE_SEED_STORAGE_KEY, JSON.stringify(result.record));
        }
        return result.record.seed;
    }
    return Math.floor(Math.random() * 1_000_000) + 1;
}

export function saveSeed(seed, store = null) {
    const record = createArcadeSeedRecord(seed);
    if (store?.saveJsonRecord) store.saveJsonRecord(ARCADE_SEED_STORAGE_KEY, record);
    else safeWriteLocalStorage(ARCADE_SEED_STORAGE_KEY, JSON.stringify(record));
}

export function loadLastRunSnapshot(store = null) {
    const raw = store ? store.loadJsonRecord?.(ARCADE_LAST_RUN_STORAGE_KEY, null)
        : safeReadLocalStorage(ARCADE_LAST_RUN_STORAGE_KEY);
    if (!raw) return null;
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const result = readArcadeLastRunRecord(parsed);
        if (result.record && result.shouldPersist) {
            if (store?.saveJsonRecord) store.saveJsonRecord(ARCADE_LAST_RUN_STORAGE_KEY, result.record);
            else safeWriteLocalStorage(ARCADE_LAST_RUN_STORAGE_KEY, JSON.stringify(result.record));
        }
        return result.record;
    } catch {
        return null;
    }
}

export function saveLastRunSnapshot(snapshot, store = null) {
    const record = createArcadeLastRunRecord(snapshot);
    if (store?.saveJsonRecord) store.saveJsonRecord(ARCADE_LAST_RUN_STORAGE_KEY, record);
    else safeWriteLocalStorage(ARCADE_LAST_RUN_STORAGE_KEY, JSON.stringify(record));
}


/** The persisted launch snapshot uses the effective seed and equipment of this run. */
export function createArcadeRunSnapshot(settings, seed, hangarBuild = null) {
    settings = resolveArcadeDailySettings(settings);
    if (settings.arcade?.dailyChallenge || settings.arcade?.runType === 'endless_parcours') seed = settings.arcade.seed;
    return createArcadeLastRunRecord({
        at: new Date().toISOString(), mapKey: settings?.mapKey,
        vehicleId: resolveArcadeRunVehicleId(settings?.vehicles?.PLAYER_1),
        botCount: settings?.numBots, botDifficulty: settings?.botDifficulty,
        seed, dailyChallenge: settings?.arcade?.dailyChallenge === true,
        buildId: hangarBuild?.buildId, buildSchemaVersion: hangarBuild?.schemaVersion,
    });
}

import { normalizeString } from './ContractNormalizeUtils.js';

export const ARCADE_SEED_STORAGE_KEY = 'cuviosclash.arcade.seed.v1';
export const ARCADE_SEED_SCHEMA_VERSION = 'arcade-seed.v1';
export const ARCADE_LAST_RUN_STORAGE_KEY = 'cuviosclash.arcade.last_run.v1';
export const ARCADE_LAST_RUN_SCHEMA_VERSION = 'arcade-last-run.v1';

function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeInteger(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const numeric = Math.trunc(Number(value));
    return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
}

function isUnsupportedSchema(source, currentVersion) {
    const schemaVersion = normalizeString(source?.schemaVersion);
    return !!schemaVersion && schemaVersion !== currentVersion;
}

export function createArcadeSeedRecord(seed) {
    return {
        schemaVersion: ARCADE_SEED_SCHEMA_VERSION,
        seed: normalizeInteger(seed, 0, 1, 2_147_483_647),
    };
}

export function readArcadeSeedRecord(source) {
    if (isRecord(source) && isUnsupportedSchema(source, ARCADE_SEED_SCHEMA_VERSION)) {
        return { record: null, shouldPersist: false, reason: 'unsupported_schema' };
    }
    const rawSeed = isRecord(source) ? source.seed : source;
    const record = createArcadeSeedRecord(rawSeed);
    if (record.seed <= 0) {
        return { record: null, shouldPersist: false, reason: 'invalid_seed' };
    }
    return {
        record,
        shouldPersist: !isRecord(source) || source.schemaVersion !== ARCADE_SEED_SCHEMA_VERSION,
        reason: 'ok',
    };
}

export function createArcadeLastRunRecord(source = null) {
    const input = isRecord(source) ? source : {};
    return {
        schemaVersion: ARCADE_LAST_RUN_SCHEMA_VERSION,
        at: normalizeString(input.at),
        mapKey: normalizeString(input.mapKey, 'standard'),
        vehicleId: normalizeString(input.vehicleId, 'ship5'),
        botCount: normalizeInteger(input.botCount, 0, 0, 128),
        botDifficulty: normalizeString(input.botDifficulty, 'NORMAL').toUpperCase(),
        seed: normalizeInteger(input.seed, 0, 0, 2_147_483_647),
        dailyChallenge: input.dailyChallenge === true,
        buildId: normalizeString(input.buildId),
        buildSchemaVersion: normalizeString(input.buildSchemaVersion),
    };
}

export function readArcadeLastRunRecord(source) {
    if (!isRecord(source)) {
        return { record: null, shouldPersist: false, reason: 'invalid_record' };
    }
    if (isUnsupportedSchema(source, ARCADE_LAST_RUN_SCHEMA_VERSION)) {
        return { record: null, shouldPersist: false, reason: 'unsupported_schema' };
    }
    const record = createArcadeLastRunRecord(source);
    if (!record.at || record.seed <= 0) {
        return { record: null, shouldPersist: false, reason: 'incomplete_record' };
    }
    return {
        record,
        shouldPersist: source.schemaVersion !== ARCADE_LAST_RUN_SCHEMA_VERSION,
        reason: 'ok',
    };
}

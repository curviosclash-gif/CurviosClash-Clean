export const ENDLESS_PARCOURS_RECORDS_STORAGE_KEY = 'curviosclash.endless-parcours-records.v1';
export const ENDLESS_PARCOURS_RECORDS_SCHEMA_VERSION = 'endless-parcours-records.v1';

function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function integer(value, fallback = 0) {
    return Math.floor(number(value, fallback));
}

function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeMetrics(value = null) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
        score: integer(source.score),
        distanceMeters: number(source.distanceMeters),
        survivalSeconds: number(source.survivalSeconds),
        completedModules: integer(source.completedModules),
        botKills: integer(source.botKills),
        seed: integer(source.seed),
        date: text(source.date),
    };
}

export function normalizeEndlessParcoursRecords(value = null) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        && value.schemaVersion === ENDLESS_PARCOURS_RECORDS_SCHEMA_VERSION
        ? value
        : {};
    return {
        schemaVersion: ENDLESS_PARCOURS_RECORDS_SCHEMA_VERSION,
        best: normalizeMetrics(source.best),
        last: normalizeMetrics(source.last),
    };
}

export function updateEndlessParcoursRecords(records, summary, date = '') {
    const current = normalizeEndlessParcoursRecords(records);
    const last = normalizeMetrics({ ...summary, date });
    const isNewRecord = last.score > current.best.score;
    return {
        records: {
            schemaVersion: ENDLESS_PARCOURS_RECORDS_SCHEMA_VERSION,
            best: isNewRecord ? { ...last } : { ...current.best },
            last,
        },
        isNewRecord,
    };
}

export function loadEndlessParcoursRecords(store) {
    if (!store || typeof store.loadJsonRecord !== 'function') return normalizeEndlessParcoursRecords();
    try {
        return normalizeEndlessParcoursRecords(store.loadJsonRecord(ENDLESS_PARCOURS_RECORDS_STORAGE_KEY, null));
    } catch {
        return normalizeEndlessParcoursRecords();
    }
}

export function saveEndlessParcoursRecords(store, records) {
    if (!store || typeof store.saveJsonRecord !== 'function') return { ok: false, reason: 'storage_unavailable' };
    try {
        const result = store.saveJsonRecord(
            ENDLESS_PARCOURS_RECORDS_STORAGE_KEY,
            normalizeEndlessParcoursRecords(records)
        );
        if (result === false || result?.ok === false || result?.success === false) {
            return { ok: false, reason: String(result?.reason || 'save_failed') };
        }
        return { ok: true, reason: 'ok' };
    } catch (error) {
        return { ok: false, reason: String(error?.message || 'save_failed') };
    }
}

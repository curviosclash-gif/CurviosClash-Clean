import {
    ENDLESS_PARCOURS_RECORDS_STORAGE_KEY,
    normalizeEndlessParcoursRecords,
} from '../../shared/contracts/EndlessParcoursRecordsContract.js';

/**
 * Ablage der Endlos-Rekorde. Die Datenform selbst liegt im Vertrag, damit auch
 * das Menue sie lesen darf; hier bleibt nur der Zugriff auf den Speicher.
 */
export {
    ENDLESS_PARCOURS_RECORDS_LEGACY_SCHEMA_VERSION,
    ENDLESS_PARCOURS_RECORDS_SCHEMA_VERSION,
    ENDLESS_PARCOURS_RECORDS_STORAGE_KEY,
    ENDLESS_PARCOURS_TOP_RUNS,
    normalizeEndlessParcoursRecords,
    updateEndlessParcoursRecords,
} from '../../shared/contracts/EndlessParcoursRecordsContract.js';

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

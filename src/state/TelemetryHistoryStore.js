// ============================================
// TelemetryHistoryStore.js - IndexedDB-based persistent telemetry
// for cross-session comparison (max 500 entries, auto-pruning)
// ============================================
//
// Achtung beim Auswerten: IndexedDB haengt an der Herkunft, also auch am Port.
// Der Desktop-Lauf nutzt einen festen Port und sammelt durchgehend; Playwright
// waehlt bewusst pro Testlauf einen eigenen Port und damit eine eigene, leere
// Datenbank. Zahlen aus Testlaeufen sind deshalb Wegwerfdaten.

import {
    matchesTelemetryHistoryFilters,
    normalizeTelemetryHistoryEntry,
} from './telemetry/TelemetryHistoryEntry.js';
import { computeTelemetryHistorySummary } from './telemetry/TelemetryHistorySummary.js';

export { normalizeTelemetryHistoryEntry };

const DB_NAME = 'cuviosclash-telemetry';
const DB_VERSION = 1;
const STORE_NAME = 'rounds';
const MAX_ENTRIES = 500;
const PRUNE_BATCH = 50;
const DB_RETRY_ATTEMPTS = 2;

function openDb() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB not available'));
            return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('at', 'at', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('indexeddb-open-failed'));
        request.onblocked = () => reject(new Error('indexeddb-open-blocked'));
    });
}

function isRetryableDbError(error) {
    const name = String(error?.name || '').trim();
    if (!name) return false;
    return (
        name === 'AbortError'
        || name === 'InvalidStateError'
        || name === 'TransactionInactiveError'
        || name === 'UnknownError'
        || name === 'NotReadableError'
        || name === 'QuotaExceededError'
    );
}

export class TelemetryHistoryStore {
    constructor() {
        this._dbPromise = null;
        this._db = null;
    }

    async _getDb() {
        if (this._db) {
            return this._db;
        }
        if (!this._dbPromise) {
            this._dbPromise = openDb()
                .then((db) => {
                    this._db = db;
                    return db;
                })
                .catch(() => {
                    this._dbPromise = null;
                    this._db = null;
                    return null;
                });
        }
        const db = await this._dbPromise;
        if (!db) {
            this._dbPromise = null;
        }
        return db;
    }

    _invalidateDb() {
        if (this._db && typeof this._db.close === 'function') {
            try {
                this._db.close();
            } catch {
                // Ignore close errors.
            }
        }
        this._db = null;
        this._dbPromise = null;
    }

    async _runWithDbRetry(operation, fallbackValue) {
        for (let attempt = 0; attempt <= DB_RETRY_ATTEMPTS; attempt += 1) {
            const db = await this._getDb();
            if (!db) return fallbackValue;

            try {
                return await operation(db);
            } catch (error) {
                const shouldRetry = attempt < DB_RETRY_ATTEMPTS && isRetryableDbError(error);
                this._invalidateDb();
                if (!shouldRetry) {
                    return fallbackValue;
                }
            }
        }
        return fallbackValue;
    }

    async recordRound(payload) {
        const entry = normalizeTelemetryHistoryEntry(payload);
        return this._runWithDbRetry(async (db) => new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                store.add(entry);
                tx.oncomplete = () => {
                    this._pruneIfNeeded(db).then(() => resolve(true)).catch(reject);
                };
                tx.onerror = () => reject(tx.error || new Error('record-round-failed'));
                tx.onabort = () => reject(tx.error || new Error('record-round-aborted'));
            } catch (error) {
                reject(error);
            }
        }), false);
    }

    async _pruneIfNeeded(db) {
        return new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const countReq = store.count();
                countReq.onsuccess = () => {
                    const total = countReq.result;
                    if (total <= MAX_ENTRIES) {
                        resolve();
                        return;
                    }
                    const deleteCount = total - MAX_ENTRIES + PRUNE_BATCH;
                    const cursor = store.openCursor();
                    let deleted = 0;
                    cursor.onsuccess = (event) => {
                        const c = /** @type {IDBRequest<IDBCursorWithValue | null>} */ (event.target).result;
                        if (c && deleted < deleteCount) {
                            c.delete();
                            deleted += 1;
                            c.continue();
                            return;
                        }
                        resolve();
                    };
                    cursor.onerror = () => reject(cursor.error || new Error('prune-cursor-failed'));
                };
                countReq.onerror = () => reject(countReq.error || new Error('prune-count-failed'));
                tx.onerror = () => reject(tx.error || new Error('prune-tx-failed'));
                tx.onabort = () => reject(tx.error || new Error('prune-tx-aborted'));
            } catch (error) {
                reject(error);
            }
        });
    }

    async getCount() {
        return this._runWithDbRetry(async (db) => new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.count();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error || new Error('count-failed'));
                tx.onerror = () => reject(tx.error || new Error('count-tx-failed'));
                tx.onabort = () => reject(tx.error || new Error('count-tx-aborted'));
            } catch (error) {
                reject(error);
            }
        }), 0);
    }

    async getEntries(filters = null) {
        return this._runWithDbRetry(async (db) => new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.getAll();
                req.onsuccess = () => {
                    const rows = (req.result || [])
                        .map(normalizeTelemetryHistoryEntry)
                        .filter((entry) => matchesTelemetryHistoryFilters(entry, filters));
                    resolve(rows);
                };
                req.onerror = () => reject(req.error || new Error('summary-failed'));
                tx.onerror = () => reject(tx.error || new Error('summary-tx-failed'));
                tx.onabort = () => reject(tx.error || new Error('summary-tx-aborted'));
            } catch (error) {
                reject(error);
            }
        }), []);
    }

    async getSummary(filters = null) {
        return computeTelemetryHistorySummary(await this.getEntries(filters));
    }

    summarizeEntries(rows = []) {
        return computeTelemetryHistorySummary(Array.isArray(rows) ? rows : []);
    }

    async clear() {
        return this._runWithDbRetry(async (db) => new Promise((resolve, reject) => {
            try {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                tx.objectStore(STORE_NAME).clear();
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => reject(tx.error || new Error('clear-failed'));
                tx.onabort = () => reject(tx.error || new Error('clear-aborted'));
            } catch (error) {
                reject(error);
            }
        }), false);
    }
}

import { ARCADE_LAB_ID_PREFIX, listValidArcadeLabShips, readArcadeLabRecord, saveArcadeLabShip, validateArcadeLabShip } from './ArcadeLabContract.js';
import { registerArcadeLabShips } from './ArcadeLabRegistryContract.js';

export const ARCADE_LAB_SHIPS_STORAGE_KEY = 'curviosclash.arcade-lab.ships.v1';

export function loadArcadeLabShips(store) {
    try {
        if (store?.readJsonRecordResult) {
            const read = store.readJsonRecordResult(ARCADE_LAB_SHIPS_STORAGE_KEY);
            if (read?.status === 'missing') return readArcadeLabRecord(null);
            return read?.status === 'found' && read.value != null ? readArcadeLabRecord(read.value) : null;
        }
        return readArcadeLabRecord(store?.loadJsonRecord?.(ARCADE_LAB_SHIPS_STORAGE_KEY, null));
    }
    catch { return null; }
}

export function saveArcadeLabShips(store, record) {
    try {
    if (!store?.saveJsonRecord || !readArcadeLabRecord(record) || !loadArcadeLabShips(store)) return false;
    const saved = store.saveJsonRecord(ARCADE_LAB_SHIPS_STORAGE_KEY, record);
    return saved === true || saved?.success === true || saved?.ok === true;
    } catch { return false; }
}

export function registerArcadeLabShipsFromStore(store) {
    const record = loadArcadeLabShips(store);
    registerArcadeLabShips(record?.unlocked ? listValidArcadeLabShips(record).map((entry) => ({
        id: entry.id, label: entry.label, role: validateArcadeLabShip(entry).role, config: entry.config,
    })) : []);
    return record;
}

export function createArcadeLabShip(record, config, nowMs = Date.now()) {
    const source = readArcadeLabRecord(record);
    if (!source?.unlocked) return { ok: false, reason: 'locked' };
    const serial = Math.max(1, Number(source.nextSerial) || 1);
    const id = `${ARCADE_LAB_ID_PREFIX}${serial}`;
    if (source.ships.some((entry) => entry.id === id)) return { ok: false, reason: 'id_collision' };
    const result = saveArcadeLabShip(source, { id, label: config?.label, config, createdAtMs: nowMs, updatedAtMs: nowMs, draft: null });
    if (!result.ok) return result;
    return { ...result, record: { ...result.record, nextSerial: serial + 1 } };
}

export function saveArcadeLabDraft(record, id, config) {
    const source = readArcadeLabRecord(record);
    if (!source) return null;
    return { ...source, ships: source.ships.map((entry) => entry.id === id ? { ...entry, draft: config } : entry) };
}

export function commitArcadeLabDraft(record, id, nowMs = Date.now()) {
    const source = readArcadeLabRecord(record);
    const existing = source?.ships.find((entry) => entry.id === id);
    if (!existing) return { ok: false, reason: 'missing' };
    return saveArcadeLabShip(source, { ...existing, config: existing.draft || existing.config, draft: null, updatedAtMs: nowMs });
}

export function renameArcadeLabShip(record, id, label) {
    const source = readArcadeLabRecord(record);
    if (!source || !String(label || '').trim()) return null;
    const name = String(label).trim().slice(0, 80);
    return { ...source, ships: source.ships.map((entry) => entry.id === id
        ? { ...entry, label: name, config: { ...entry.config, label: name } } : entry) };
}

export function deleteArcadeLabShip(record, id) {
    const source = readArcadeLabRecord(record);
    if (!source) return null;
    return { ...source, ships: source.ships.filter((entry) => entry.id !== id) };
}

export function isArcadeLabShipsStorageKey(key) {
    return String(key || '') === ARCADE_LAB_SHIPS_STORAGE_KEY || String(key || '').endsWith('.arcade-lab.ships.v1');
}

import { HUNT_PARCOURS_RIVAL_STORAGE_KEY, isWritableHuntParcoursRivalState } from '../../shared/contracts/HuntParcoursRivalContract.js';
import { isWritableHuntParcoursMedalRecord } from '../../shared/contracts/HuntParcoursMedalRecordContract.js';
import { createRuntimeClock } from '../../shared/contracts/RuntimeClockContract.js';

function writable(key, value) {
    return key === HUNT_PARCOURS_RIVAL_STORAGE_KEY
        ? isWritableHuntParcoursRivalState(value) : isWritableHuntParcoursMedalRecord(value);
}

/** Absolute targets make retries idempotent; pending progress survives run resets. */
export class HuntParcoursRecords {
    constructor(clock = createRuntimeClock()) { this.clock = clock; this.pending = []; this.nextRetryMs = 0; }

    _read(store, key) {
        try { return store?.readJsonRecordResult?.(key) || { status: 'unavailable' }; }
        catch { return { status: 'read_failed' }; }
    }

    read(store, key) {
        const read = this._read(store, key);
        const entry = this.pending.find(item => item.store === store && item.key === key);
        // A known local target remains a valid logical base during transient read
        // failures. Actual writes still require the strict check in _try().
        return entry && !(read.status === 'found' && !writable(key, read.value))
            ? { status: 'found', value: structuredClone(entry.value) } : read;
    }

    _try(entry) {
        const read = this._read(entry.store, entry.key);
        if (read.status !== 'missing' && (read.status !== 'found' || !writable(entry.key, read.value))) return false;
        const expected = JSON.stringify(entry.value);
        try {
            if (read.status !== 'found' || JSON.stringify(read.value) !== expected) {
                entry.store.saveJsonRecord(entry.key, entry.value);
            }
            const check = this._read(entry.store, entry.key);
            if (check.status !== 'found' || JSON.stringify(check.value) !== expected) return false;
        } catch { return false; }
        this.pending.splice(this.pending.indexOf(entry), 1);
        for (const failures of entry.owners) {
            const index = failures.indexOf(entry.key);
            if (index >= 0) failures.splice(index, 1);
        }
        return true;
    }

    queue(store, key, value, failures) {
        let entry = this.pending.find(item => item.store === store && item.key === key);
        if (!entry) { entry = { store, key, value: null, owners: new Set() }; this.pending.push(entry); }
        entry.value = structuredClone(value);
        entry.owners.add(failures);
        if (!failures.includes(key)) failures.push(key);
        return this._try(entry);
    }

    maintain(nowMs = this.clock.nowHighRes()) {
        if (!this.pending.length || nowMs < this.nextRetryMs) return false;
        this.nextRetryMs = nowMs + 250;
        const entry = this.pending[0];
        if (this._try(entry)) return true;
        this.pending.push(this.pending.shift());
        return false;
    }
}

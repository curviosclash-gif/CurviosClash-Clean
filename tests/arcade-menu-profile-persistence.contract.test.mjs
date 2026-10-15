import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSeed, saveSeed, loadLastRunSnapshot, saveLastRunSnapshot } from '../src/ui/arcade/ArcadeMenuProfilePersistence.js';
import { ARCADE_SEED_STORAGE_KEY, ARCADE_LAST_RUN_STORAGE_KEY, createArcadeSeedRecord, createArcadeLastRunRecord } from '../src/shared/contracts/ArcadeMenuPersistenceContract.js';

test('an empty scoped profile never imports another profile through the global menu fallback', () => {
    const previousWindow = globalThis.window;
    const globalRecords = new Map([
        [ARCADE_SEED_STORAGE_KEY, JSON.stringify(createArcadeSeedRecord(12345))],
        [ARCADE_LAST_RUN_STORAGE_KEY, JSON.stringify(createArcadeLastRunRecord({ seed: 12345, at: '2026-10-15T00:00:00Z', mapKey: 'standard', vehicleId: 'ship5' }))],
    ]);
    let globalReads = 0;
    let globalWrites = 0;
    globalThis.window = { localStorage: {
        getItem: key => { globalReads++; return globalRecords.get(key); },
        setItem: () => { globalWrites++; },
    } };
    const scopedRecords = new Map();
    const scopedStore = { loadJsonRecord: (key, fallback) => scopedRecords.get(key) ?? fallback,
        saveJsonRecord: (key, value) => { scopedRecords.set(key, value); return true; } };
    try {
        assert.ok(Number.isInteger(loadSeed(scopedStore)));
        assert.equal(loadLastRunSnapshot(scopedStore), null);
        assert.equal(globalReads, 0, 'missing scoped values are not a license to consult shared legacy storage');
        saveSeed(77, scopedStore);
        saveLastRunSnapshot({ seed: 77, at: '2026-10-15T00:00:00Z', mapKey: 'standard', vehicleId: 'ship5' }, scopedStore);
        assert.equal(loadSeed(scopedStore), 77);
        assert.equal(loadLastRunSnapshot(scopedStore).seed, 77);
        assert.equal(globalWrites, 0);
        assert.equal(loadSeed(), 12345, 'the legacy path remains available without a profile port');
        assert.equal(globalReads, 1);
    } finally {
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ARCADE_LAST_RUN_SCHEMA_VERSION,
    ARCADE_LAST_RUN_STORAGE_KEY,
    ARCADE_SEED_SCHEMA_VERSION,
    ARCADE_SEED_STORAGE_KEY,
    createArcadeLastRunRecord,
    createArcadeSeedRecord,
    readArcadeLastRunRecord,
    readArcadeSeedRecord,
} from '../src/shared/contracts/ArcadeMenuPersistenceContract.js';

test('Arcade menu persistence keeps stable keys with versioned payloads', () => {
    assert.equal(ARCADE_SEED_STORAGE_KEY, 'cuviosclash.arcade.seed.v1');
    assert.equal(ARCADE_LAST_RUN_STORAGE_KEY, 'cuviosclash.arcade.last_run.v1');
    assert.deepEqual(createArcadeSeedRecord(4711), {
        schemaVersion: ARCADE_SEED_SCHEMA_VERSION,
        seed: 4711,
    });
    assert.equal(
        createArcadeLastRunRecord({ at: '2026-08-11T10:00:00.000Z', seed: 4711 }).schemaVersion,
        ARCADE_LAST_RUN_SCHEMA_VERSION
    );
});

test('Arcade menu persistence migrates legacy seed and last-run payloads once', () => {
    const seed = readArcadeSeedRecord('4711');
    assert.equal(seed.record?.seed, 4711);
    assert.equal(seed.shouldPersist, true);
    assert.equal(readArcadeSeedRecord(seed.record).shouldPersist, false);

    const legacyLastRun = {
        at: '2026-08-11T10:00:00.000Z',
        mapKey: 'maze',
        vehicleId: 'ship5',
        seed: 4711,
    };
    const lastRun = readArcadeLastRunRecord(legacyLastRun);
    assert.equal(lastRun.record?.schemaVersion, ARCADE_LAST_RUN_SCHEMA_VERSION);
    assert.equal(lastRun.record?.mapKey, 'maze');
    assert.equal(lastRun.shouldPersist, true);
    assert.equal(readArcadeLastRunRecord(lastRun.record).shouldPersist, false);
});

test('Arcade menu persistence rejects incomplete and unknown future payloads', () => {
    assert.equal(readArcadeSeedRecord({ schemaVersion: 'arcade-seed.v99', seed: 4711 }).record, null);
    assert.equal(readArcadeLastRunRecord({
        schemaVersion: 'arcade-last-run.v99',
        at: '2026-08-11T10:00:00.000Z',
        seed: 4711,
    }).record, null);
    assert.equal(readArcadeLastRunRecord({ seed: 4711 }).record, null);
});

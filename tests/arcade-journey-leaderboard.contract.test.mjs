import test from 'node:test';
import assert from 'node:assert/strict';

import { ARCADE_JOURNEY_SCHEMA, ARCADE_JOURNEY_STORAGE_KEY } from '../src/shared/contracts/ArcadeJourneyContract.js';
import {
    getArcadeJourneyLeaderboard,
    recordArcadeJourneyResult,
} from '../src/state/arcade/ArcadeJourneyProgress.js';

function createStore(initial = null, { readStatus = '', saveResult = { success: true } } = {}) {
    let value = initial === null ? null : structuredClone(initial);
    const writes = [];
    return {
        writes,
        readJsonRecordResult(key) {
            assert.equal(key, ARCADE_JOURNEY_STORAGE_KEY);
            if (readStatus) return { status: readStatus, ok: false };
            return value === null ? { status: 'missing' } : { status: 'found', value: structuredClone(value) };
        },
        saveJsonRecord(key, next) {
            writes.push({ key, value: structuredClone(next) });
            if (typeof saveResult === 'function') return saveResult(next);
            if (saveResult === true || saveResult?.ok === true || saveResult?.success === true) value = structuredClone(next);
            return saveResult;
        },
        readValue() { return value === null ? null : structuredClone(value); },
    };
}

function result(overrides = {}) {
    return { stageId: 'first_run', tierId: 'normal', medal: 1, runId: 'run-1', value: 10000, playerCount: 1, ...overrides };
}

test('personal boards are isolated by player count and tier', () => {
    const store = createStore();
    for (const playerCount of [1, 2, 3]) {
        assert.equal(recordArcadeJourneyResult(store, result({ playerCount, runId: `count-${playerCount}`, value: playerCount * 1000 })).status, 'saved');
    }
    assert.equal(recordArcadeJourneyResult(store, result({ tierId: 'hard', runId: 'hard-run', value: 4000 })).status, 'saved');
    assert.deepEqual(getArcadeJourneyLeaderboard(store.readValue(), 'first_run', 'normal', 1).map((row) => row.runId), ['count-1']);
    assert.deepEqual(getArcadeJourneyLeaderboard(store.readValue(), 'first_run', 'normal', 2).map((row) => row.runId), ['count-2']);
    assert.deepEqual(getArcadeJourneyLeaderboard(store.readValue(), 'first_run', 'normal', 3).map((row) => row.runId), ['count-3']);
    assert.deepEqual(getArcadeJourneyLeaderboard(store.readValue(), 'first_run', 'hard', 1).map((row) => row.runId), ['hard-run']);
});

test('metric sorting uses ascending time and place, descending score and ratio, then lexical run ID', () => {
    const store = createStore();
    for (const row of [
        result({ stageId: 'five_portals', tierId: 'normal', medal: 2, runId: 'time-slower', value: 180000 }),
        result({ stageId: 'five_portals', tierId: 'normal', medal: 3, runId: 'time-fast-b', value: 120000 }),
        result({ stageId: 'five_portals', tierId: 'normal', medal: 3, runId: 'time-fast-a', value: 120000 }),
        result({ stageId: 'weapon_race', tierId: 'normal', medal: 0, runId: 'place-2', value: 2 }),
        result({ stageId: 'weapon_race', tierId: 'normal', medal: 3, runId: 'place-1', value: 1 }),
        result({ stageId: 'demolition', tierId: 'normal', medal: 2, runId: 'ratio-low', value: 0.75 }),
        result({ stageId: 'demolition', tierId: 'normal', medal: 3, runId: 'ratio-high', value: 0.95 }),
        result({ stageId: 'first_run', tierId: 'normal', medal: 2, runId: 'score-low', value: 20000 }),
        result({ stageId: 'first_run', tierId: 'normal', medal: 3, runId: 'score-high', value: 40000 }),
    ]) {
        assert.equal(recordArcadeJourneyResult(store, row).status, 'saved');
    }
    assert.deepEqual(getArcadeJourneyLeaderboard(store.readValue(), 'five_portals', 'normal', 1).map((row) => row.runId),
        ['time-fast-a', 'time-fast-b', 'time-slower']);
    assert.deepEqual(getArcadeJourneyLeaderboard(store.readValue(), 'weapon_race', 'normal', 1).map((row) => row.runId), ['place-1', 'place-2']);
    assert.deepEqual(getArcadeJourneyLeaderboard(store.readValue(), 'demolition', 'normal', 1).map((row) => row.runId), ['ratio-high', 'ratio-low']);
    assert.deepEqual(getArcadeJourneyLeaderboard(store.readValue(), 'first_run', 'normal', 1).map((row) => row.runId), ['score-high', 'score-low']);
});

test('repeated receipts do not add rows, while weaker medals can add a new result without lowering best medal', () => {
    const store = createStore();
    assert.equal(recordArcadeJourneyResult(store, result({ medal: 3, runId: 'gold', value: 40000 })).status, 'saved');
    assert.equal(recordArcadeJourneyResult(store, result({ medal: 1, runId: 'bronze', value: 1000 })).status, 'saved');
    const repeated = recordArcadeJourneyResult(store, result({ medal: 3, runId: 'bronze', value: 50000 }));
    assert.equal(repeated.status, 'unchanged');
    assert.equal(store.writes.length, 2);
    assert.equal(store.readValue().stages.first_run.medals.normal.medal, 3);
    assert.equal(store.readValue().stages.first_run.medals.normal.runId, 'gold');
    assert.deepEqual(getArcadeJourneyLeaderboard(store.readValue(), 'first_run', 'normal', 1).map((row) => row.runId), ['gold', 'bronze']);
});

test('top ten is deterministic and getter rejects unavailable partitions', () => {
    const store = createStore();
    for (let index = 12; index >= 0; index -= 1) {
        assert.ok(['saved', 'unchanged'].includes(recordArcadeJourneyResult(store,
            result({ runId: `run-${String(index).padStart(2, '0')}`, value: index, medal: 0 })).status));
    }
    const rows = getArcadeJourneyLeaderboard(store.readValue(), 'first_run', 'normal', 1);
    assert.equal(rows.length, 10);
    assert.equal(rows[0].runId, 'run-12');
    assert.equal(rows.at(-1).runId, 'run-03');
    assert.deepEqual(getArcadeJourneyLeaderboard(store.readValue(), 'weapon_race', 'normal', 2), []);
    assert.deepEqual(getArcadeJourneyLeaderboard({ schema: 'future', stages: {}, boards: {} }, 'first_run', 'normal', 1), []);
});

test('invalid requests, nonpositive time and malformed target boards fail closed', () => {
    const store = createStore();
    for (const invalid of [
        result({ playerCount: 0 }), result({ playerCount: 4 }), result({ playerCount: 2, stageId: 'weapon_race' }),
        result({ stageId: 'unknown' }), result({ tierId: 'any' }), result({ runId: ' ' }),
        result({ medal: -1 }), result({ medal: 4 }), result({ value: Infinity }), result({ value: -1 }),
        result({ value: undefined }), result({ value: null }), result({ value: '4000' }),
        result({ stageId: 'five_portals', value: 0 }),
    ]) {
        assert.equal(recordArcadeJourneyResult(store, invalid).status, 'invalid');
    }
    assert.equal(store.writes.length, 0);
    const corrupt = createStore({ schema: ARCADE_JOURNEY_SCHEMA, stages: {}, boards: { 'first_run:normal:1:v2': [{ runId: 'bad', value: 5, medal: 1, playerCount: 2 }] } });
    const before = corrupt.readValue();
    assert.equal(recordArcadeJourneyResult(corrupt, result()).status, 'unavailable');
    assert.deepEqual(corrupt.readValue(), before);
    assert.equal(corrupt.writes.length, 0);
});

test('one atomic write preserves medallions, unknown fields and unrelated boards; failure leaves data intact', () => {
    const initial = {
        schema: ARCADE_JOURNEY_SCHEMA,
        custom: { keep: true },
        stages: { first_run: { note: 'keep', medals: { normal: { medal: 3, runId: 'best-medal' } } } },
        boards: { 'future_stage:nightmare:2': [{ future: true }] },
    };
    const store = createStore(initial);
    assert.equal(recordArcadeJourneyResult(store, result({ medal: 1, runId: 'new-low-medal', value: 20000 })).status, 'saved');
    assert.equal(store.writes.length, 1);
    assert.equal(store.readValue().stages.first_run.note, 'keep');
    assert.equal(store.readValue().stages.first_run.medals.normal.medal, 3);
    assert.deepEqual(store.readValue().custom, { keep: true });
    assert.deepEqual(store.readValue().boards['future_stage:nightmare:2'], [{ future: true }]);

    const failing = createStore(initial, { saveResult: { success: false } });
    const snapshot = failing.readValue();
    const resultOnFailure = recordArcadeJourneyResult(failing, result({ medal: 1, runId: 'failed', value: 10000 }));
    assert.equal(resultOnFailure.status, 'unavailable');
    assert.deepEqual(failing.readValue(), snapshot);
    assert.equal(failing.writes.length, 1, 'medal and board share one atomic save attempt');
});

test('read errors and future schemas are never overwritten', () => {
    const future = createStore({ schema: 'arcade-journey.v2', stages: {}, boards: {} });
    const futureBefore = future.readValue();
    assert.equal(recordArcadeJourneyResult(future, result()).status, 'unavailable');
    assert.deepEqual(future.readValue(), futureBefore);
    assert.equal(future.writes.length, 0);
    const readError = createStore(null, { readStatus: 'read_failed' });
    assert.equal(recordArcadeJourneyResult(readError, result()).status, 'unavailable');
    assert.equal(readError.writes.length, 0);
});


test('a stored zero-time row is hidden and cannot be overwritten as if it were valid', () => {
    const initial = { schema: ARCADE_JOURNEY_SCHEMA, stages: {}, boards: {
        'five_portals:normal:1': [{ runId: 'corrupt-time', value: 0, medal: 3, playerCount: 1 }],
    } };
    const store = createStore(initial);
    assert.deepEqual(getArcadeJourneyLeaderboard(initial, 'five_portals', 'normal', 1), []);
    assert.equal(recordArcadeJourneyResult(store, result({ stageId: 'five_portals', value: 1000 })).status, 'unavailable');
    assert.equal(store.writes.length, 0); assert.deepEqual(store.readValue(), initial);
});

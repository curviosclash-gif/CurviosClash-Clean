import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ARCADE_JOURNEY_SCHEMA,
    ARCADE_JOURNEY_STORAGE_KEY,
    getArcadeJourneyStageStars,
    loadArcadeJourneyProgress,
    recordArcadeJourneyMedal,
} from '../src/state/arcade/ArcadeJourneyProgress.js';

function createStore(initial = null, options = {}) {
    const { readStatus = '' } = options;
    const saveResult = Object.hasOwn(options, 'saveResult') ? options.saveResult : { success: true };
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

const entry = (overrides = {}) => ({ stageId: 'skyline_route', tierId: 'normal', medal: 1, runId: 'run-1', nowMs: 1234, ...overrides });

test('missing store data is read-only until a valid medal is recorded', () => {
    const store = createStore();
    const loaded = loadArcadeJourneyProgress(store);
    assert.equal(loaded.status, 'created');
    assert.deepEqual(loaded.progress, { schema: ARCADE_JOURNEY_SCHEMA, stages: {} });
    assert.equal(store.writes.length, 0);
    assert.equal(getArcadeJourneyStageStars(loaded.progress, 'skyline_route'), 0);
    assert.equal(recordArcadeJourneyMedal(store, entry()).status, 'saved');
    assert.equal(getArcadeJourneyStageStars(store.readValue(), 'skyline_route'), 1);
});

test('tier medals only improve, duplicate run receipts and equal or weaker results do not write', () => {
    const store = createStore();
    assert.equal(recordArcadeJourneyMedal(store, entry({ tierId: 'hard', medal: 2 })).status, 'saved');
    assert.equal(recordArcadeJourneyMedal(store, entry({ tierId: 'hard', medal: 1, runId: 'run-2' })).status, 'unchanged');
    assert.equal(recordArcadeJourneyMedal(store, entry({ tierId: 'nightmare', medal: 3, runId: 'run-1' })).status, 'unchanged');
    assert.equal(recordArcadeJourneyMedal(store, entry({ tierId: 'hard', medal: 3, runId: 'run-3' })).status, 'saved');
    assert.equal(store.writes.length, 2);
    assert.equal(store.readValue().stages.skyline_route.medals.hard.medal, 3);
    assert.equal(getArcadeJourneyStageStars(store.readValue(), 'skyline_route'), 3);
});

test('only an exact current schema is writable; corrupt, future, and read-error data are preserved', () => {
    for (const [initial, readStatus] of [
        [{ schema: 'arcade-journey.v2', stages: {} }, ''],
        [{ schema: ARCADE_JOURNEY_SCHEMA, stages: [] }, ''],
        [null, 'error'],
    ]) {
        const store = createStore(initial, { readStatus });
        const before = store.readValue();
        assert.equal(loadArcadeJourneyProgress(store).status, 'unavailable');
        assert.equal(recordArcadeJourneyMedal(store, entry()).status, 'unavailable');
        assert.deepEqual(store.readValue(), before);
        assert.equal(store.writes.length, 0);
    }
});

test('profile stores stay isolated and unknown journey fields and stages survive updates', () => {
    const a = createStore({
        schema: ARCADE_JOURNEY_SCHEMA,
        custom: { keep: true },
        stages: {
            old_stage: { note: 'keep', medals: {} },
            skyline_route: { medals: { normal: { medal: 1, runId: 'old-run', imported: 'keep' } } },
        },
    });
    const b = createStore();
    assert.equal(recordArcadeJourneyMedal(a, entry({ medal: 2, runId: 'run-a' })).status, 'saved');
    assert.equal(recordArcadeJourneyMedal(b, entry({ tierId: 'nightmare', medal: 3, runId: 'run-b' })).status, 'saved');
    assert.equal(a.readValue().stages.old_stage.note, 'keep');
    assert.deepEqual(a.readValue().custom, { keep: true });
    assert.equal(a.readValue().stages.skyline_route.medals.normal.medal, 2);
    assert.equal(a.readValue().stages.skyline_route.medals.normal.imported, 'keep');
    assert.equal(b.readValue().stages.skyline_route.medals.nightmare.medal, 3);
    assert.equal(b.readValue().stages.skyline_route.medals.normal, undefined);
});

test('invalid award inputs and failed writes never turn into successful progress', () => {
    const store = createStore();
    for (const invalid of [
        entry({ stageId: '../other' }), entry({ stageId: 'x'.repeat(65) }), entry({ tierId: 'Nightmare' }),
        entry({ medal: 0 }), entry({ medal: 2.5 }), entry({ runId: ' ' }),
    ]) {
        assert.equal(recordArcadeJourneyMedal(store, invalid).status, 'invalid');
    }
    assert.equal(store.writes.length, 0);
    const failed = createStore(null, { saveResult: { success: false } });
    assert.equal(recordArcadeJourneyMedal(failed, entry()).status, 'unavailable');
    assert.equal(failed.readValue(), null);
    assert.equal(failed.writes.length, 1);
});

test('atomic save acknowledgements accept the supported success shapes only', () => {
    for (const saveResult of [true, { ok: true }, { success: true }]) {
        const store = createStore(null, { saveResult });
        assert.equal(recordArcadeJourneyMedal(store, entry()).status, 'saved');
    }
    for (const saveResult of [undefined, false, { ok: false }, { success: false }]) {
        const store = createStore(null, { saveResult });
        assert.equal(recordArcadeJourneyMedal(store, entry()).status, 'unavailable');
    }
});

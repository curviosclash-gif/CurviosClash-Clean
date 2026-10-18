import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCADE_JOURNEY_SCHEMA, ARCADE_JOURNEY_STAGES, getArcadeJourneyStars, resolveArcadeJourneyAccess } from '../src/shared/contracts/ArcadeJourneyContract.js';
import { getArcadeJourneyLeaderboard, getArcadeJourneyLegacyLeaderboard, leaderboardKey, loadArcadeJourneyProgress } from '../src/shared/contracts/ArcadeJourneyProgressContract.js';
import { recordArcadeJourneyResult } from '../src/state/arcade/ArcadeJourneyProgress.js';
import { createArcadeJourneyRunBinding, settleArcadeJourneyRun } from '../src/core/arcade/ArcadeJourneyRunBinding.js';

const row = (runId, value, playerCount = 1) => ({ runId, value, medal: 3, playerCount });
function initial() {
    return { schema: ARCADE_JOURNEY_SCHEMA, note: { keep: true },
        stages: { first_run: { note: 'earned', medals: { normal: { medal: 3, runId: 'old-gold', custom: 7 } } } },
        boards: { 'first_run:normal:1': [row('old-gold', 99999)],
            'first_run:normal:1:v2': [row('old-course-v2', 42000)],
            'first_run:hard:2': [row('old-hard', 80000, 2)], 'unknown:future': [{ opaque: true }] } };
}
function store(seed = initial(), failedWrites = 0) {
    let data = structuredClone(seed), attempts = 0;
    return { get data() { return data; }, get attempts() { return attempts; },
        readJsonRecordResult: () => ({ status: 'found', value: structuredClone(data) }),
        saveJsonRecord(_key, value) { attempts++; if (attempts <= failedWrites) return false; data = structuredClone(value); return true; } };
}
const result = (extra = {}) => ({ stageId: 'first_run', tierId: 'normal', playerCount: 1,
    value: 40000, medal: 2, runId: 'new-course', leaderboardVersion: 3, ...extra });

test('changed First Run and Five Fronts use new board keys; earlier values remain historical', () => {
    const port = store(), before = structuredClone(port.data);
    for (const stage of ARCADE_JOURNEY_STAGES) {
        const version = stage.id === 'first_run' ? 3 : stage.id === 'five_fronts' ? 2 : 1;
        assert.equal(stage.leaderboardVersion, version);
        assert.equal(leaderboardKey(stage.id, 'normal', 1), `${stage.id}:normal:1${version > 1 ? `:v${version}` : ''}`);
    }
    assert.deepEqual(getArcadeJourneyLeaderboard(port.data, 'first_run', 'normal', 1), []);
    assert.deepEqual(getArcadeJourneyLegacyLeaderboard(port.data, 'first_run', 'normal', 1), [
        ...before.boards['first_run:normal:1'].map(row => ({ ...row, version: 1 })),
        ...before.boards['first_run:normal:1:v2'].map(row => ({ ...row, version: 2 })),
    ]);
    assert.equal(loadArcadeJourneyProgress(port).status, 'ok'); assert.equal(port.attempts, 0);
    assert.deepEqual(port.data, before);
    assert.equal(getArcadeJourneyStars(port.data, 'first_run'), 3);
    assert.equal(resolveArcadeJourneyAccess('notre_dame', port.data).unlocked, true);
});

test('one atomic result adds the current board while preserving old scores, earned gold and unknown metadata', () => {
    const port = store(), before = structuredClone(port.data);
    assert.equal(recordArcadeJourneyResult(port, result()).status, 'saved'); assert.equal(port.attempts, 1);
    assert.deepEqual(getArcadeJourneyLeaderboard(port.data, 'first_run', 'normal', 1), [{ ...row('new-course', 40000), medal: 2 }]);
    for (const [key, rows] of Object.entries(before.boards)) assert.deepEqual(port.data.boards[key], rows);
    assert.deepEqual(port.data.stages, before.stages); assert.deepEqual(port.data.note, before.note);
    const reloaded = store(port.data);
    assert.equal(getArcadeJourneyLeaderboard(reloaded.data, 'first_run', 'normal', 1)[0].value, 40000);
    assert.deepEqual(getArcadeJourneyLegacyLeaderboard(reloaded.data, 'first_run', 'normal', 1).map(row => row.value), [99999, 42000]);
    assert.equal(recordArcadeJourneyResult(reloaded, result({ value: 90000 })).status, 'unchanged');
    assert.equal(reloaded.attempts, 0);
});

test('difficulty and one, two, three players stay separate in both current and historical lists', () => {
    const port = store();
    for (const playerCount of [1, 2, 3]) for (const tierId of ['normal', 'hard', 'nightmare']) {
        assert.equal(recordArcadeJourneyResult(port, result({ tierId, playerCount, runId: `${tierId}-${playerCount}` })).status, 'saved');
        assert.equal(getArcadeJourneyLeaderboard(port.data, 'first_run', tierId, playerCount)[0].runId, `${tierId}-${playerCount}`);
    }
    assert.deepEqual(getArcadeJourneyLegacyLeaderboard(port.data, 'first_run', 'normal', 2), []);
    assert.equal(getArcadeJourneyLegacyLeaderboard(port.data, 'first_run', 'hard', 2)[0].runId, 'old-hard');
});

test('binding freezes the current rules and retries the same partition/result for only failed recipients', () => {
    const a = store(), b = store(initial(), 1);
    const binding = createArcadeJourneyRunBinding({ stageId: 'first_run', runType: 'gauntlet', tierId: 'normal', runId: 'retry',
        participants: [{ profileId: 'a', store: a }, { profileId: 'b', store: b }] });
    assert.equal(binding.leaderboardVersion, 3);
    assert.throws(() => { binding.leaderboardVersion = 1; }, TypeError);
    assert.equal(settleArcadeJourneyRun(binding, { succeeded: true, value: 40000 }).pending, true);
    assert.equal(settleArcadeJourneyRun(binding, { succeeded: true, value: 99999 }).pending, false);
    assert.equal(a.attempts, 1); assert.equal(b.attempts, 2);
    for (const port of [a, b]) {
        assert.equal(port.data.boards['first_run:normal:2:v3'][0].value, 40000);
        assert.deepEqual(port.data.boards['first_run:normal:1'], initial().boards['first_run:normal:1']);
    }
});

test('stale or future rule requests fail without writing; valid storage failures preserve the complete record', () => {
    const port = store();
    for (const leaderboardVersion of [0, 1, 2, 4, '3', null, NaN]) {
        assert.equal(recordArcadeJourneyResult(port, result({ leaderboardVersion })).status, 'invalid');
    }
    assert.equal(port.attempts, 0); assert.deepEqual(port.data, initial());
    const failing = store(initial(), 1);
    assert.equal(recordArcadeJourneyResult(failing, result()).status, 'unavailable');
    assert.deepEqual(failing.data, initial());
});

test('malformed historical rows are preserved without being ranked or blocking the independent current board', () => {
    const data = initial(); data.boards['first_run:normal:1'] = [{ value: 'unknown', opaque: true }];
    const port = store(data);
    assert.deepEqual(getArcadeJourneyLegacyLeaderboard(port.data, 'first_run', 'normal', 1),
        data.boards['first_run:normal:1:v2'].map(row => ({ ...row, version: 2 })));
    assert.equal(recordArcadeJourneyResult(port, result()).status, 'saved');
    assert.deepEqual(port.data.boards['first_run:normal:1'], data.boards['first_run:normal:1']);
    assert.deepEqual(getArcadeJourneyLegacyLeaderboard(port.data, 'notre_dame', 'normal', 1), []);
    assert.deepEqual(getArcadeJourneyLegacyLeaderboard({ ...data, schema: 'future' }, 'first_run', 'normal', 1), []);
});

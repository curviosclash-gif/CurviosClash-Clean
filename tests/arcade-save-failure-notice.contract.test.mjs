// A full storage must not lose arcade progress silently: the parcours board keeps a ghost clip
// only for its best entry (the only one ever played back), and a save the store rejects reaches
// the result screen as a visible notice instead of a console line.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    LEADERBOARD_STORAGE_KEY,
    insertLeaderboardEntry,
    loadLeaderboard,
    saveLeaderboard,
} from '../src/state/arcade/ArcadeLeaderboard.js';
import { ArcadeRunPersistenceScheduler } from '../src/core/arcade/ArcadeRunPersistenceScheduler.js';
import {
    flushArcadePersistenceSavesResult,
    scheduleArcadeLeaderboardSave,
    scheduleArcadeVehicleProfilesSave,
} from '../src/core/arcade/ArcadeRunPersistenceOps.js';
import { createArcadeRunBlocks } from '../src/ui/arcade/postrun/ArcadePostRunBlocks.js';

const clip = (id) => ({ id, frames: [1, 2, 3] });

function createStore({ full = false } = {}) {
    const data = new Map();
    return {
        data,
        full,
        loadJsonRecord: (key, fallback) => (data.has(key) ? structuredClone(data.get(key)) : fallback),
        saveJsonRecord(key, value) {
            if (this.full) return { success: false, reason: 'quota_exceeded' };
            data.set(key, structuredClone(value));
            return true;
        },
    };
}

test('the parcours board keeps a ghost clip only on its best entry', () => {
    let board = {};
    board = insertLeaderboardEntry(board, 'route', { totalTimeMs: 3000, ghostClip: clip('a') });
    board = insertLeaderboardEntry(board, 'route', { totalTimeMs: 2000, ghostClip: clip('b') });
    board = insertLeaderboardEntry(board, 'route', { totalTimeMs: 1000, ghostClip: clip('c') });
    assert.deepEqual(board.route.map((entry) => entry.ghostClip?.id ?? null), ['c', null, null]);

    const store = createStore();
    saveLeaderboard(store, { route: [
        { totalTimeMs: 1000, date: '2026-01-01T00:00:00.000Z', ghostClip: clip('best') },
        { totalTimeMs: 2000, date: '2026-01-01T00:00:00.000Z', ghostClip: clip('old') },
    ] });
    assert.deepEqual(store.data.get(LEADERBOARD_STORAGE_KEY).route.map((entry) => entry.ghostClip?.id ?? null), ['best', null]);
});

test('loading an old board with clips on every entry keeps all entries intact', () => {
    const store = createStore();
    const stored = { route: [
        { totalTimeMs: 1000, date: '2026-01-01T00:00:00.000Z', vehicleId: 'ship5', ghostClip: clip('best') },
        { totalTimeMs: 2000, date: '2026-01-02T00:00:00.000Z', vehicleId: 'ship1', ghostClip: clip('old') },
    ] };
    store.data.set(LEADERBOARD_STORAGE_KEY, stored);
    const board = loadLeaderboard(store);
    assert.equal(board.route.length, 2);
    assert.deepEqual(board.route.map((entry) => entry.totalTimeMs), [1000, 2000]);
    assert.equal(board.route[0].ghostClip.id, 'best');
    assert.equal(board.route[1].ghostClip?.id, 'old', 'an old entry on place 2 keeps its clip when loaded');
    assert.deepEqual(store.data.get(LEADERBOARD_STORAGE_KEY), stored, 'loading never rewrites the stored board');
});

test('an entry pushed off place 1 keeps its times and only drops the clip', () => {
    const first = { totalTimeMs: 2000, penaltyTimeMs: 300, segmentSplitsMs: [700, 1400], vehicleId: 'ship5',
        date: '2026-01-01T00:00:00.000Z', ghostClip: clip('first') };
    let board = insertLeaderboardEntry({}, 'route', first);
    board = insertLeaderboardEntry(board, 'route', { totalTimeMs: 1500, vehicleId: 'ship1', ghostClip: clip('faster') });
    assert.equal(board.route[0].ghostClip.id, 'faster');
    const pushed = board.route[1];
    assert.deepEqual(
        { totalTimeMs: pushed.totalTimeMs, penaltyTimeMs: pushed.penaltyTimeMs, segmentSplitsMs: pushed.segmentSplitsMs,
            vehicleId: pushed.vehicleId, date: pushed.date },
        { totalTimeMs: 2000, penaltyTimeMs: 300, segmentSplitsMs: [700, 1400], vehicleId: 'ship5', date: first.date },
    );
    assert.equal(pushed.ghostClip, null);
});

test('a rejected save marks the post-run summary until a retry succeeds', () => {
    const store = createStore({ full: true });
    const runtime = {
        settingsManager: { getPlayerRecordStorePort: () => store },
        _persistenceScheduler: new ArcadeRunPersistenceScheduler({ saveThrottleMs: 0, logger: { warn() {} } }),
        _vehicleProfiles: { ship5: { vehicleId: 'ship5', xp: 10 } },
        _leaderboard: { route: [{ totalTimeMs: 1000 }] },
        _state: { postRunSummary: { score: 10 } },
    };
    scheduleArcadeVehicleProfilesSave(runtime);
    scheduleArcadeLeaderboardSave(runtime);
    assert.deepEqual(runtime._state.postRunSummary.saveFailures, ['vehicleProfiles', 'leaderboard']);

    store.full = false;
    assert.equal(flushArcadePersistenceSavesResult(runtime).ok, true);
    assert.equal(runtime._state.postRunSummary.saveFailures, undefined, 'the notice goes away once the data is stored');
});

test('the result screen shows a save failure notice only when saves failed', () => {
    const withFailure = createArcadeRunBlocks({ score: 10, saveFailures: ['vehicleProfiles'] });
    const notice = withFailure.find((block) => block.id === 'arcade-save-failure');
    assert.ok(notice, 'a failed save gets its own card');
    assert.ok(notice.rows.some((row) => /Fortschritt konnte nicht gespeichert werden/.test(String(row.value))));
    assert.ok(notice.rows.some((row) => /Fahrzeug-XP/.test(String(row.value))));
    assert.equal(createArcadeRunBlocks({ score: 10 }).some((block) => block.id === 'arcade-save-failure'), false);
});

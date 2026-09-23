import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createLeaderboardProjection,
    getBestEntry,
    insertLeaderboardEntry,
    loadLeaderboard,
} from '../src/state/arcade/ArcadeLeaderboard.js';
import { applyParcoursLeaderboardEvent } from '../src/core/arcade/ArcadeParcoursLeaderboardOps.js';

function storeWith(value) {
    return { loadJsonRecord() { return structuredClone(value); } };
}

test('persisted leaderboard entries are normalized and sorted before the top ten is selected', () => {
    const route = Array.from({ length: 12 }, (_, index) => ({
        totalTimeMs: 12_000 - index * 500,
        date: `2026-09-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    }));
    const leaderboard = loadLeaderboard(storeWith({ route }));

    assert.equal(leaderboard.route.length, 10);
    assert.deepEqual(
        leaderboard.route.map((entry) => entry.totalTimeMs),
        [6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000, 10500, 11000]
    );
    assert.equal(getBestEntry(leaderboard, 'route')?.totalTimeMs, 6500);
});

test('invalid total times cannot create an unbeatable leaderboard entry', () => {
    const existing = { route: [{ totalTimeMs: 1234, date: '2026-09-01T10:00:00.000Z' }] };

    assert.equal(insertLeaderboardEntry(existing, 'route', { totalTimeMs: 0 }), existing);
    assert.equal(insertLeaderboardEntry(existing, 'route', { totalTimeMs: Number.NaN }), existing);
    assert.equal(insertLeaderboardEntry(existing, 'route', { totalTimeMs: -50 }), existing);

    const loaded = loadLeaderboard(storeWith({
        route: [null, 'broken', { totalTimeMs: 0 }, { totalTimeMs: 'nope' }, { totalTimeMs: 1234 }],
    }));
    assert.deepEqual(loaded.route.map((entry) => entry.totalTimeMs), [1234]);
});

test('equal times use their recorded date as deterministic tie breaker', () => {
    const loaded = loadLeaderboard(storeWith({ route: [
        { totalTimeMs: 2000, vehicleId: 'late', date: '2026-09-02T10:00:00.000Z' },
        { totalTimeMs: 2000, vehicleId: 'early', date: '2026-09-01T10:00:00.000Z' },
    ] }));

    assert.deepEqual(loaded.route.map((entry) => entry.vehicleId), ['early', 'late']);
});

test('leaderboard projection excludes ghost payloads from the menu boundary', () => {
    const projection = createLeaderboardProjection({ route: [{
        totalTimeMs: 2000,
        vehicleId: 'ship1',
        ghostClip: { frames: [{ time: 0 }] },
    }] });

    assert.equal(projection.route[0].totalTimeMs, 2000);
    assert.equal(Object.hasOwn(projection.route[0], 'ghostClip'), false);
});

test('finish processing rejects invalid total time without persistence or XP', () => {
    let saves = 0;
    let xpAwards = 0;
    const runtime = {
        _enabled: true,
        _leaderboard: { route: [{ totalTimeMs: 2000 }] },
        _activeVehicleId: 'ship1',
        _config: {},
        _resolveGhostLibraryBudgetOptions: () => ({}),
        _resolveSettingsRecordStore: () => null,
        _scheduleLeaderboardSave: () => { saves += 1; },
        applyParcoursXpEvent: () => { xpAwards += 1; },
    };

    const result = applyParcoursLeaderboardEvent(runtime, {
        type: 'finish',
        routeId: 'route',
        totalTimeMs: 0,
    });

    assert.equal(result.reason, 'invalid_total_time');
    assert.equal(result.inserted, false);
    assert.equal(saves, 0);
    assert.equal(xpAwards, 0);
    assert.equal(runtime._leaderboard.route[0].totalTimeMs, 2000);
});

test('finish result describes a new best with rank and exact improvement', () => {
    const runtime = {
        _enabled: true,
        _leaderboard: { route: [{
            totalTimeMs: 2500,
            penaltyTimeMs: 0,
            segmentSplitsMs: [],
            vehicleId: 'ship2',
            date: '2026-09-01T10:00:00.000Z',
            ghostClip: null,
        }] },
        _ghostLibrary: {},
        _activeVehicleId: 'ship1',
        _config: {},
        _resolveGhostLibraryBudgetOptions: () => ({}),
        _resolveSettingsRecordStore: () => null,
        _scheduleLeaderboardSave() {},
        _mergeGhostLibraryTelemetryDelta() {},
        _scheduleGhostLibrarySave() {},
        applyParcoursXpEvent() {},
    };

    const result = applyParcoursLeaderboardEvent(runtime, {
        type: 'finish', routeId: 'route', totalTimeMs: 2000, ghostClip: null,
    });

    assert.equal(result.status, 'new_best');
    assert.equal(result.rank, 1);
    assert.equal(result.previousBestTimeMs, 2500);
    assert.equal(result.bestTimeMs, 2000);
    assert.equal(result.improvementMs, 500);
    assert.equal(result.deltaToBestMs, 0);
    assert.equal(result.qualified, true);
});

test('finish result uses competition rank for a tied time', () => {
    const date = '2026-09-01T10:00:00.000Z';
    const runtime = {
        _enabled: true,
        _activeVehicleId: 'ship5',
        _leaderboard: { route: [{ totalTimeMs: 2000, penaltyTimeMs: 0, vehicleId: 'ship4', date }] },
        _config: {},
        _resolveSettingsRecordStore: () => null,
        _resolveGhostLibraryBudgetOptions: () => ({}),
        _scheduleLeaderboardSave() {},
        _mergeGhostLibraryTelemetryDelta() {},
        _scheduleGhostLibrarySave() {},
        applyParcoursXpEvent() {},
        _ghostLibrary: {},
    };

    const result = applyParcoursLeaderboardEvent(runtime, {
        type: 'finish', routeId: 'route', totalTimeMs: 2000, ghostClip: null,
    });

    assert.equal(result.rank, 1);
    assert.equal(result.status, 'ranked');
});

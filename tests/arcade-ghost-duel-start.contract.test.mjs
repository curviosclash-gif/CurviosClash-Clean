// The best-time ghost is recorded from the first checkpoint on (that is when the parcours clock
// starts), but it used to start playing at round start and loop. Every duel therefore gave the
// ghost a head start of the flight to the first ring, and the later start at the ring was dropped
// as a duplicate. The duel ghost now leaves with the player's clock and runs once.
import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/core/Config.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { applyParcoursLeaderboardEvent } from '../src/core/arcade/ArcadeParcoursLeaderboardOps.js';

function clip(seconds) {
    return {
        frames: [
            { time: 0, players: [{ idx: 0, x: 0, y: 0, z: 0 }] },
            { time: seconds, players: [{ idx: 0, x: 10, y: 0, z: 10 }] },
        ],
        players: [{ idx: 0, color: 0xffffff }], sourceDuration: seconds, displayDuration: seconds,
    };
}

function duel(ghostDuelMode) {
    const runtime = new ArcadeRunRuntime({ ghostLibrarySaveThrottleMs: 0 });
    runtime._enabled = true;
    runtime._config = { ghostDuelMode };
    runtime._state = {};
    runtime._leaderboard = { route_alpha: [{ totalTimeMs: 10000, segmentSplitsMs: [4000], ghostClip: clip(10) }] };
    runtime._ghostLibrary = { route_alpha: { routeId: 'route_alpha', longestGhostClip: clip(12), durationMs: 12000, updatedAt: '2026-10-13T10:00:00.000Z' } };
    const plays = [];
    runtime.setGhostPlaybackHandler((played, options) => plays.push({ played, options }));
    const start = (source) => applyParcoursLeaderboardEvent(runtime, { type: 'ghost_start', routeId: 'route_alpha', source });
    return { plays, start };
}

test('the best-time ghost waits for the parcours clock and then runs once', () => {
    const { plays, start } = duel('self_best_time_ghost');
    const roundStart = start('match_round_start');
    assert.equal(roundStart.started, false, 'no head start at round start');
    assert.equal(plays.length, 0);

    const ringStart = start('parcours_checkpoint_start');
    assert.equal(ringStart.started, true, 'the first ring starts the ghost with the clock');
    assert.equal(plays.length, 1);
    assert.equal(plays[0].played.sourceDuration, 10);
    assert.equal(plays[0].options?.loop, false, 'a duel ghost does not lap the player');
});

test('the longest-trail ghost keeps starting at round start', () => {
    const { plays, start } = duel('self_longest_ghost');
    assert.equal(start('match_round_start').started, true);
    assert.equal(plays.length, 1);
    assert.equal(start('parcours_checkpoint_start').reason, 'duplicate_checkpoint_start');
});

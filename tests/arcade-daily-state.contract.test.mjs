import test from 'node:test';
import assert from 'node:assert/strict';

import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import {
    createArcadeDailyProjection,
    createArcadeDailyRunResult,
} from '../src/state/arcade/ArcadeDailyState.js';
import { createArcadeRunState } from '../src/state/arcade/ArcadeRunState.js';
import { mergeArcadeRunRecords } from '../src/state/arcade/ArcadeScoreOps.js';
import { computeDailySeed } from '../src/shared/utils/ArcadeUtils.js';

test('Arcade Daily projection hides the previous day and exposes only the current German seed', () => {
    const records = {
        daily: {
            seed: 20260817,
            runsPlayed: 3,
            bestScore: 4200,
            bestRunAt: '2026-08-17T12:00:00.000Z',
            lastScore: 3900,
            lastRunAt: '2026-08-17T13:00:00.000Z',
        },
    };

    // Midnight in Germany is 22:00 UTC during summer time.
    assert.deepEqual(createArcadeDailyProjection(records, '2026-08-17T21:59:59.999Z'), {
        seed: 20260817,
        status: 'played',
        playedToday: true,
        runsPlayed: 3,
        bestScore: 4200,
        bestRunAt: '2026-08-17T12:00:00.000Z',
        lastScore: 3900,
        lastRunAt: '2026-08-17T13:00:00.000Z',
    });
    assert.deepEqual(createArcadeDailyProjection(records, '2026-08-17T22:00:00.000Z'), {
        seed: 20260818,
        status: 'unplayed',
        playedToday: false,
        runsPlayed: 0,
        bestScore: 0,
        bestRunAt: '',
        lastScore: 0,
        lastRunAt: '',
    });
});

test('Arcade Daily result distinguishes a new best from a tied best', () => {
    const previousRecords = {
        daily: {
            seed: 20260817,
            runsPlayed: 2,
            bestScore: 4200,
        },
    };

    assert.deepEqual(createArcadeDailyRunResult({
        previousRecords,
        completedRecords: {
            daily: {
                seed: 20260817,
                runsPlayed: 3,
                bestScore: 4800,
            },
        },
        summary: {
            isDailyChallenge: true,
            seed: 20260817,
            score: 4800,
        },
    }), {
        seed: 20260817,
        attempt: 3,
        succeeded: false, completedSectors: 0,
        score: 4800,
        previousBestScore: 4200,
        bestScore: 4800,
        isNewBest: true,
        tiedBest: false,
    });

    assert.equal(createArcadeDailyRunResult({
        previousRecords,
        completedRecords: {
            daily: {
                seed: 20260817,
                runsPlayed: 3,
                bestScore: 4200,
            },
        },
        summary: {
            isDailyChallenge: true,
            seed: 20260817,
            score: 4200,
        },
    })?.tiedBest, true);
});

test('Arcade runtime projects current Daily records and attaches the completed attempt result', () => {
    const nowMs = Date.now();
    const dailySeed = computeDailySeed(new Date(nowMs));
    const runtime = new ArcadeRunRuntime({ now: () => nowMs });
    runtime._enabled = true;
    runtime._records = mergeArcadeRunRecords(null, {
        score: 3200,
        completedSectors: 4,
        finishedAtIso: '2026-08-17T12:00:00.000Z',
        isDailyChallenge: true,
        seed: dailySeed,
    });
    runtime._state = createArcadeRunState({
        config: { enabled: true, dailyChallenge: true, seed: dailySeed },
        records: runtime._records,
        nowMs,
        runId: 'daily-runtime-contract',
    });
    runtime._state.isDailyChallenge = true;
    runtime._state.score.total = 4500;
    runtime._state.completedSectors = 5;

    runtime._finalizeRun(nowMs);

    assert.deepEqual(runtime.getPostRunSummary()?.dailyResult, {
        seed: dailySeed,
        attempt: 2,
        succeeded: false, completedSectors: 5,
        score: 4500,
        previousBestScore: 3200,
        bestScore: 4500,
        isNewBest: true,
        tiedBest: false,
    });
    const menuState = runtime.getMenuSurfaceState();
    assert.equal(menuState.daily.seed, dailySeed);
    assert.equal(menuState.daily.playedToday, true);
    assert.equal(menuState.daily.runsPlayed, 2);
    assert.equal(menuState.daily.bestScore, 4500);
});

test('a first Daily attempt without a single point is no new best', () => {
    // The first run of the day used to count as a best whatever it scored, so a run that
    // ended before the player flew at all was celebrated as "Neuer Tagesbestwert".
    const result = createArcadeDailyRunResult({
        previousRecords: null,
        completedRecords: { daily: { seed: 20260929, runsPlayed: 1, bestScore: 0 } },
        summary: { isDailyChallenge: true, seed: 20260929, score: 0 },
    });

    assert.equal(result?.attempt, 1);
    assert.equal(result?.isNewBest, false, 'zero points are no daily best');
    assert.equal(result?.tiedBest, false);

    const firstScoringRun = createArcadeDailyRunResult({
        previousRecords: null,
        completedRecords: { daily: { seed: 20260929, runsPlayed: 1, bestScore: 150 } },
        summary: { isDailyChallenge: true, seed: 20260929, score: 150 },
    });
    assert.equal(firstScoringRun?.isNewBest, true, 'the first run that scores sets the daily best');
});

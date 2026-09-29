import assert from 'node:assert/strict';
import test from 'node:test';

import { HEURISTIC_IMPROVEMENT_BASELINE, resolveHeuristicBenchmarkSetup } from '../scripts/heuristic-improvement-baseline.mjs';
import { createMatchPool, resolveMatchWorkerCount } from '../scripts/heuristic-improvement-pool.mjs';

function benchmarkJobs() {
    const jobs = [];
    for (const [seedIndex, seed] of [2, 5, 13].entries()) {
        for (const candidateSlot of [0, 3]) {
            jobs.push({
                profile: 'balanced',
                seed,
                setup: resolveHeuristicBenchmarkSetup(seedIndex),
                candidateFields: { ...HEURISTIC_IMPROVEMENT_BASELINE.balanced, strafeDistance: 0.6 },
                candidateSlot,
                maxTicks: 360,
                respawnEnabled: true,
            });
        }
    }
    return jobs;
}

test('matches spread over worker threads give bit-identical results to a serial run', async () => {
    const jobs = benchmarkJobs();
    const serial = createMatchPool({ workerCount: 1 });
    const parallel = createMatchPool({ workerCount: 3 });
    try {
        const serialResults = await serial.runMatches(jobs);
        // Reversed order on one thread: no match may depend on what ran before it in the process.
        const reversedResults = (await serial.runMatches([...jobs].reverse())).reverse();
        const parallelResults = await parallel.runMatches(jobs);
        assert.deepEqual(reversedResults, serialResults);
        assert.deepEqual(parallelResults, serialResults);
        assert.deepEqual(parallelResults.map((result) => result.matchSeed), jobs.map((job) => job.seed));
    } finally {
        await parallel.close();
    }
});

test('a failing match rejects instead of hanging the pool', async () => {
    const pool = createMatchPool({ workerCount: 2 });
    try {
        await assert.rejects(
            pool.runMatches([{ ...benchmarkJobs()[0], candidateSlot: 99 }]),
            /candidate slot 99/
        );
    } finally {
        await pool.close();
    }
});

test('worker count defaults to at most four and follows HEURISTIC_LOOP_WORKERS', () => {
    assert.ok(resolveMatchWorkerCount({}) >= 1 && resolveMatchWorkerCount({}) <= 4);
    assert.equal(resolveMatchWorkerCount({ HEURISTIC_LOOP_WORKERS: '1' }), 1);
    assert.equal(resolveMatchWorkerCount({ HEURISTIC_LOOP_WORKERS: '2' }), 2);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
    DEFAULT_GAP_THRESHOLD_SECONDS,
    SLOW_TEST_LIMIT,
    collectPlaywrightTestAttempts,
    formatPlaywrightDurations,
    summarizePlaywrightDurations,
} from '../scripts/playwright-durations.mjs';
import { summarizePlaywrightResultsFile } from '../scripts/summarize-playwright-results.mjs';

// The fixture mirrors `JSONReport` from node_modules/playwright/types/testReporter.d.ts:
// every attempt of a test is one entry in JSONReportTest.results, carrying `startTime`,
// `duration`, `retry`, `status` and `workerIndex`. Two specs, five tests, one deliberate
// skip, one retried test and a 100 s hole in the middle - the shape P0 has to measure.

const BASE_MS = Date.parse('2026-09-17T10:00:00.000Z');

function at(offsetMs) {
    return new Date(BASE_MS + offsetMs).toISOString();
}

function attempt({ startMs, duration, retry = 0, status = 'passed', workerIndex = 0 }) {
    return {
        workerIndex,
        parallelIndex: workerIndex,
        status,
        duration,
        errors: [],
        stdout: [],
        stderr: [],
        retry,
        startTime: at(startMs),
        annotations: [],
        attachments: [],
    };
}

function spec(file, title, line, tests) {
    return { title, ok: true, tags: [], id: `${file}-${title}`, file, line, column: 1, tests };
}

/**
 * Timeline of the fixture (offsets in seconds from the first start):
 *   T1  a.spec.js   0 → 5     runs
 *   T2  a.spec.js   5 → 5     deliberate skip, zero duration
 *   T3  a.spec.js   6 → 10    runs                     (1 s gap after T1)
 *   T4  b.spec.js 110 → 113   first attempt            (100 s gap after T3)
 *   T4  b.spec.js 114 → 116   retry, then green        (1 s gap)
 *   T5  b.spec.js 117 → 118   runs                     (1 s gap)
 */
function createReport({ workerIndexOf = () => 0, dropWorkerIndex = false } = {}) {
    const make = (options) => {
        const result = attempt({ ...options, workerIndex: workerIndexOf(options.key) });
        if (dropWorkerIndex) {
            delete result.workerIndex;
            delete result.parallelIndex;
        }
        return result;
    };
    return {
        config: { projects: [] },
        errors: [],
        stats: { startTime: at(0), duration: 118_000, expected: 3, unexpected: 0, flaky: 1, skipped: 1 },
        suites: [
            {
                title: 'a.spec.js',
                file: 'a.spec.js',
                line: 0,
                column: 0,
                specs: [
                    spec('a.spec.js', 'T1: the menu opens', 10, [{
                        timeout: 60_000,
                        annotations: [],
                        expectedStatus: 'passed',
                        status: 'expected',
                        results: [make({ key: 'T1', startMs: 0, duration: 5000 })],
                    }]),
                    spec('a.spec.js', 'T2: skipped on purpose', 20, [{
                        timeout: 60_000,
                        annotations: [{ type: 'skip', description: 'needs a CDN' }],
                        expectedStatus: 'skipped',
                        status: 'skipped',
                        results: [make({ key: 'T2', startMs: 5000, duration: 0, status: 'skipped' })],
                    }]),
                    spec('a.spec.js', 'T3: the hangar lists the vehicles', 30, [{
                        timeout: 60_000,
                        annotations: [],
                        expectedStatus: 'passed',
                        status: 'expected',
                        results: [make({ key: 'T3', startMs: 6000, duration: 4000 })],
                    }]),
                ],
                suites: [],
            },
            {
                title: 'b.spec.js',
                file: 'b.spec.js',
                line: 0,
                column: 0,
                specs: [],
                suites: [{
                    title: 'three player split',
                    file: 'b.spec.js',
                    line: 40,
                    column: 0,
                    specs: [
                        spec('b.spec.js', 'T4: three player split', 45, [{
                            timeout: 60_000,
                            annotations: [],
                            expectedStatus: 'passed',
                            status: 'flaky',
                            results: [
                                make({ key: 'T4a', startMs: 110_000, duration: 3000, status: 'failed' }),
                                make({ key: 'T4b', startMs: 114_000, duration: 2000, retry: 1 }),
                            ],
                        }]),
                        spec('b.spec.js', 'T5: the round ends', 55, [{
                            timeout: 60_000,
                            annotations: [],
                            expectedStatus: 'passed',
                            status: 'expected',
                            results: [make({ key: 'T5', startMs: 117_000, duration: 1000 })],
                        }]),
                    ],
                    suites: [],
                }],
            },
        ],
    };
}

test('playwright durations: the threshold and the slow list are named constants', () => {
    assert.equal(DEFAULT_GAP_THRESHOLD_SECONDS, 60);
    assert.equal(SLOW_TEST_LIMIT, 15);
});

test('playwright durations: a skipped test neither costs time nor closes a gap', () => {
    const attempts = collectPlaywrightTestAttempts(createReport());
    assert.deepEqual(
        attempts.map((entry) => [entry.title, entry.startMs - BASE_MS, entry.durationMs]),
        [
            ['T1: the menu opens', 0, 5000],
            ['T3: the hangar lists the vehicles', 6000, 4000],
            ['T4: three player split', 110_000, 3000],
            ['T4: three player split', 114_000, 2000],
            ['T5: the round ends', 117_000, 1000],
        ],
        'the zero-length skip would have split the 100 s hole into two small ones'
    );
});

test('playwright durations: spec sums, slow list and overhead of a mixed run', () => {
    const durations = summarizePlaywrightDurations(createReport());

    assert.deepEqual(durations.specs, [
        { spec: 'a.spec.js', ms: 9000, tests: 2 },
        { spec: 'b.spec.js', ms: 6000, tests: 2 },
    ], 'both attempts of the retried test belong to their spec, the skip does not');

    assert.deepEqual(durations.slowest.map((entry) => [entry.spec, entry.title, entry.ms]), [
        ['a.spec.js', 'T1: the menu opens', 5000],
        ['b.spec.js', 'T4: three player split', 5000],
        ['a.spec.js', 'T3: the hangar lists the vehicles', 4000],
        ['b.spec.js', 'T5: the round ends', 1000],
    ], 'a retried test is as expensive as the sum of its attempts');

    assert.deepEqual(durations.overhead, {
        tests: 4,
        attempts: 5,
        testTimeMs: 15_000,
        wallMs: 118_000,
        gapMs: 103_000,
        medianGapMs: 1000,
        workers: 1,
    });
    assert.equal(durations.gapsAvailable, true);
    assert.equal(
        durations.overhead.testTimeMs + durations.overhead.gapMs,
        durations.overhead.wallMs,
        'test time plus gaps has to add up to the wall clock of one worker'
    );
});

test('playwright durations: only gaps above the threshold are reported, with both titles', () => {
    const durations = summarizePlaywrightDurations(createReport());
    assert.deepEqual(durations.gaps.map((gap) => [gap.ms, gap.previousTitle, gap.nextTitle]), [
        [100_000, 'T3: the hangar lists the vehicles', 'T4: three player split'],
    ]);

    const everything = summarizePlaywrightDurations(createReport(), { gapThresholdMs: 500 });
    assert.deepEqual(everything.gaps.map((gap) => gap.ms), [100_000, 1000, 1000, 1000]);
    assert.equal(everything.overhead.gapMs, 103_000, 'the threshold hides lines, it never changes the sum');

    const silent = summarizePlaywrightDurations(createReport(), { gapThresholdMs: 200_000 });
    assert.deepEqual(silent.gaps, []);
    assert.equal(silent.overhead.gapMs, 103_000);
});

test('playwright durations: the printed block is ordered and rounded to tenths of a second', () => {
    const text = formatPlaywrightDurations(summarizePlaywrightDurations(createReport()));
    const lines = text.split('\n').filter((line) => line.length > 0);
    assert.deepEqual(lines, [
        '[playwright:spec] 9.0s tests=2 a.spec.js',
        '[playwright:spec] 6.0s tests=2 b.spec.js',
        '[playwright:slow] 5.0s a.spec.js › T1: the menu opens',
        '[playwright:slow] 5.0s b.spec.js › T4: three player split',
        '[playwright:slow] 4.0s a.spec.js › T3: the hangar lists the vehicles',
        '[playwright:slow] 1.0s b.spec.js › T5: the round ends',
        '[playwright:gap] 100.0s nach "T3: the hangar lists the vehicles" vor "T4: three player split"',
        '[playwright:overhead] tests=4 testTimeMs=15000 wallMs=118000 gapMs=103000 medianGapMs=1000',
    ]);
});

test('playwright durations: two workers are measured separately, a missing index stops the gaps', () => {
    const parallel = summarizePlaywrightDurations(
        createReport({ workerIndexOf: (key) => (key === 'T4a' || key === 'T4b' || key === 'T5' ? 1 : 0) })
    );
    assert.equal(parallel.overhead.workers, 2);
    assert.equal(parallel.gapsAvailable, true);
    // Worker 0: T1 → T3 = 1 s. Worker 1: T4 → retry = 1 s, retry → T5 = 1 s. The 100 s hole
    // belonged to one worker waiting for the other, so it is no longer an overhead gap.
    assert.equal(parallel.overhead.gapMs, 3000);
    assert.deepEqual(parallel.gaps, []);

    const unattributable = summarizePlaywrightDurations(createReport({ dropWorkerIndex: true }));
    assert.equal(unattributable.gapsAvailable, false);
    assert.deepEqual(unattributable.gaps, []);
    assert.equal(unattributable.overhead.gapMs, 0);
    const text = formatPlaywrightDurations(unattributable);
    assert.match(text, /\[playwright:gaps\] .*workerIndex/, 'the missing field is stated, not guessed');
    const lines = text.split('\n').filter((line) => line.length > 0);
    assert.match(lines[lines.length - 1], /^\[playwright:overhead\] /);
});

test('playwright durations: with one configured worker a restarted worker keeps the gap', () => {
    // A desktop run is configured with workers=1, yet a crashed worker is replaced by a fresh
    // one with a new workerIndex. Grouping by index would hide exactly the hole this package
    // hunts (a desktop-flows run once idled 513 s between two tests).
    const report = createReport({ workerIndexOf: (key) => (key === 'T1' || key === 'T2' || key === 'T3' ? 0 : 4) });
    report.config = { workers: 1, projects: [] };

    const durations = summarizePlaywrightDurations(report);
    assert.equal(durations.gapsAvailable, true);
    assert.equal(durations.overhead.gapMs, 103_000, 'the restart hole is idle time, not parallel work');
    assert.deepEqual(durations.gaps.map((gap) => [gap.ms, gap.previousTitle, gap.nextTitle]), [
        [100_000, 'T3: the hangar lists the vehicles', 'T4: three player split'],
    ]);
});

test('playwright durations: an empty report prints zeros instead of crashing', () => {
    const durations = summarizePlaywrightDurations({ suites: [], stats: {} });
    assert.deepEqual(durations.specs, []);
    assert.deepEqual(durations.slowest, []);
    assert.equal(durations.overhead.tests, 0);
    assert.equal(durations.overhead.wallMs, 0);
    assert.equal(durations.overhead.medianGapMs, 0);
    assert.match(formatPlaywrightDurations(durations), /^\[playwright:overhead\] tests=0 /);

    const broken = summarizePlaywrightDurations(null);
    assert.equal(broken.overhead.tests, 0);
});

test('playwright durations: the slow list is capped at the named limit', () => {
    const report = { suites: [{ title: 'many.spec.js', file: 'many.spec.js', specs: [], suites: [] }], stats: {} };
    for (let index = 0; index < SLOW_TEST_LIMIT + 5; index += 1) {
        report.suites[0].specs.push(spec('many.spec.js', `T${index}: case ${index}`, index, [{
            annotations: [],
            expectedStatus: 'passed',
            status: 'expected',
            results: [attempt({ startMs: index * 10_000, duration: (index + 1) * 100 })],
        }]));
    }
    const durations = summarizePlaywrightDurations(report);
    assert.equal(durations.slowest.length, SLOW_TEST_LIMIT);
    assert.equal(durations.overhead.tests, SLOW_TEST_LIMIT + 5, 'the overhead line counts every test');
});

function withTempReport(report, run) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'curvios-durations-'));
    const resultsPath = path.join(directory, 'results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(report), 'utf8');
    try {
        return run(resultsPath, directory);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

test('playwright durations: without the switch the printed output is byte for byte the old one', () => {
    withTempReport(createReport(), (resultsPath) => {
        const logged = [];
        const summary = summarizePlaywrightResultsFile(resultsPath, {
            knownFailuresPath: path.join(os.tmpdir(), 'curvios-no-known-failures.json'),
            log: (line) => logged.push(line),
        });
        assert.equal(summary.exitCode, 0);
        assert.deepEqual(logged, [
            '[playwright:summary] passed=3 failed=0 skipped=1 didNotRun=0 flaky=1 known=0 new=0',
        ]);
    });
});

test('playwright durations: with the switch the duration lines come first and the summary stays last', () => {
    withTempReport(createReport(), (resultsPath) => {
        const logged = [];
        summarizePlaywrightResultsFile(resultsPath, {
            knownFailuresPath: path.join(os.tmpdir(), 'curvios-no-known-failures.json'),
            log: (line) => logged.push(line),
            durations: true,
        });
        const lines = logged.join('\n').split('\n').filter((line) => line.length > 0);
        assert.equal(lines[0], '[playwright:spec] 9.0s tests=2 a.spec.js');
        assert.match(lines[lines.length - 2], /^\[playwright:overhead\] /);
        assert.equal(
            lines[lines.length - 1],
            '[playwright:summary] passed=3 failed=0 skipped=1 didNotRun=0 flaky=1 known=0 new=0',
            'the machine-readable verdict keeps its format and its place'
        );
    });
});

test('playwright durations: the gap threshold is configurable from the command line', () => {
    withTempReport(createReport(), (resultsPath) => {
        const logged = [];
        summarizePlaywrightResultsFile(resultsPath, {
            knownFailuresPath: path.join(os.tmpdir(), 'curvios-no-known-failures.json'),
            log: (line) => logged.push(line),
            durations: true,
            gapThresholdMs: 500,
        });
        const gaps = logged.join('\n').split('\n').filter((line) => line.startsWith('[playwright:gap]'));
        assert.equal(gaps.length, 4);
    });
});

test('playwright durations: a missing or broken results.json stays one clear line', () => {
    const logged = [];
    const missing = summarizePlaywrightResultsFile(path.join(os.tmpdir(), 'curvios-durations-absent', 'results.json'), {
        log: (line) => logged.push(line),
        durations: true,
    });
    assert.equal(missing, null);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /^\[playwright:summary\] no results\.json at /);

    withTempReport({}, (resultsPath) => {
        fs.writeFileSync(resultsPath, '{ this is not json', 'utf8');
        const brokenLog = [];
        const broken = summarizePlaywrightResultsFile(resultsPath, {
            log: (line) => brokenLog.push(line),
            durations: true,
        });
        assert.equal(broken, null);
        assert.match(brokenLog[0], /^\[playwright:summary\] no results\.json at /);
    });
});

test('playwright durations: the summarizer understands --durations and --gap-threshold', () => {
    const source = fs.readFileSync(
        new URL('../scripts/summarize-playwright-results.mjs', import.meta.url),
        'utf8'
    );
    assert.match(source, /--durations/);
    assert.match(source, /--gap-threshold/);
    assert.match(source, /usage: node scripts\/summarize-playwright-results\.mjs/);
});

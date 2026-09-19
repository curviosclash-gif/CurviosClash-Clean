import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
    CONTRACT_LOAD_TIME_SCALE,
    CONTRACT_SLOW_FILE_COUNT,
    CONTRACT_TEST_TIMEOUT_MS,
    buildContractSummaryReporterArgs,
    resolveAutoTimeScaleEnv,
    formatContractSlowFileLines,
    formatContractSummaryLine,
    resolveContractSummaryPath,
    resolveContractTestArgs,
    resolveTestTimeScale,
    runContractTests,
} from '../scripts/run-contract-tests.mjs';
import contractSummaryReporter from '../scripts/contract-summary-reporter.mjs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

async function collectReporterOutput(events, options = undefined) {
    const chunks = [];
    for await (const chunk of contractSummaryReporter((async function* emit() {
        for (const event of events) yield event;
    })(), options)) {
        chunks.push(chunk);
    }
    return chunks.join('');
}

test('every contract test gets a hard time limit', () => {
    assert.equal(CONTRACT_TEST_TIMEOUT_MS, 120000);
    assert.ok(resolveContractTestArgs({}, 8).includes('--test-timeout=120000'));
});

const FORCE_EXIT = '--test-force-exit';

test('parallel contract runs do not force-exit before worker reports are flushed', () => {
    const args = resolveContractTestArgs({}, 6);
    assert.ok(args.includes('--test-concurrency=4'));
    assert.equal(args.includes(FORCE_EXIT), false);
});

test('contract concurrency leaves two cores for the rest of the machine', () => {
    assert.deepEqual(resolveContractTestArgs({}, 8), ['--test-timeout=120000', '--test-concurrency=6']);
    assert.deepEqual(resolveContractTestArgs({}, 6), ['--test-timeout=120000', '--test-concurrency=4']);
    assert.deepEqual(resolveContractTestArgs({}, 2), ['--test-timeout=120000', '--test-concurrency=2']);
    assert.deepEqual(resolveContractTestArgs({}, 0), ['--test-timeout=120000', '--test-concurrency=2']);
});

test('CURVIOS_TEST_CONCURRENCY overrides the detected core count', () => {
    assert.deepEqual(
        resolveContractTestArgs({ CURVIOS_TEST_CONCURRENCY: '3' }, 16),
        ['--test-timeout=120000', '--test-concurrency=3']
    );
    for (const invalidValue of ['0', '-4', 'auto', '']) {
        assert.deepEqual(
            resolveContractTestArgs({ CURVIOS_TEST_CONCURRENCY: invalidValue }, 8),
            ['--test-timeout=120000', '--test-concurrency=6'],
            `invalid override ${invalidValue} must fall back`
        );
    }
});

// Measured 16.09.2026: with a cluster on the GPU the online handoff took 9.1 s instead of 0.4 s
// and went red; the runner now stretches the budgets itself when the Playwright lock is held.
test('the runner scales time budgets by itself while a Playwright run holds the lock', () => {
    assert.equal(CONTRACT_LOAD_TIME_SCALE, 3);
    assert.deepEqual(resolveAutoTimeScaleEnv({}, true), { CURVIOS_TEST_TIME_SCALE: '3' });
    assert.deepEqual(resolveAutoTimeScaleEnv({}, false), {});
    assert.deepEqual(resolveAutoTimeScaleEnv({ CURVIOS_TEST_TIME_SCALE: '2' }, true), {}, 'a hand-set scale wins');
});

test('the time scale only ever stretches budgets, never shortens them', () => {
    assert.equal(resolveTestTimeScale({}), 1);
    assert.equal(resolveTestTimeScale({ CURVIOS_TEST_TIME_SCALE: '3' }), 3);
    assert.equal(resolveTestTimeScale({ CURVIOS_TEST_TIME_SCALE: '2.5' }), 2.5);
    assert.equal(resolveTestTimeScale({ CURVIOS_TEST_TIME_SCALE: '0.5' }), 1);
    assert.equal(resolveTestTimeScale({ CURVIOS_TEST_TIME_SCALE: '-2' }), 1);
    assert.equal(resolveTestTimeScale({ CURVIOS_TEST_TIME_SCALE: 'schnell' }), 1);
});

test('the summary reporter writes machine readable counts next to the run', () => {
    const summaryPath = resolveContractSummaryPath('2026-09-15T10-11-12Z');
    assert.match(summaryPath.replace(/\\/g, '/'), /tmp\/contract\/2026-09-15T10-11-12Z\/summary\.json$/);

    const reporterArgs = buildContractSummaryReporterArgs(summaryPath);
    assert.ok(reporterArgs.includes('--test-reporter=./scripts/contract-summary-reporter.mjs'));
    assert.ok(reporterArgs.includes(`--test-reporter-destination=${summaryPath}`));
});

test('the runner ends with one parseable summary line', () => {
    const line = formatContractSummaryLine({
        tests: 2359,
        pass: 2356,
        fail: 2,
        skipped: 1,
        duration_ms: 62792.575,
        failingFiles: ['tests/ci-automation.contract.test.mjs'],
    }, 'F:/tmp/contract/run/summary.json');

    assert.equal(
        line,
        '[contract:summary] pass=2356 fail=2 skipped=1 durationMs=62793 summary=F:/tmp/contract/run/summary.json'
    );
    assert.equal(
        formatContractSummaryLine(null, 'F:/tmp/contract/run/summary.json'),
        '[contract:summary] pass=0 fail=0 skipped=0 durationMs=0 summary=F:/tmp/contract/run/summary.json'
    );
});

test('the reporter turns node test events into the summary payload', async () => {
    const coverage = { workingDirectory: 'F:/repo', files: [{ path: 'F:/repo/src/state/Foo.js' }] };
    const output = await collectReporterOutput([
        { type: 'test:start', data: {} },
        { type: 'test:coverage', data: { summary: coverage } },
        {
            type: 'test:summary',
            data: {
                file: 'F:/repo/tests/green.contract.test.mjs',
                success: true,
                duration_ms: 12,
                counts: { tests: 3, passed: 3, failed: 0, skipped: 0, todo: 0 },
            },
        },
        {
            type: 'test:summary',
            data: {
                file: 'F:/repo/tests/red.contract.test.mjs',
                success: false,
                duration_ms: 20,
                counts: { tests: 2, passed: 1, failed: 1, skipped: 0, todo: 0 },
            },
        },
        {
            type: 'test:summary',
            data: {
                file: undefined,
                success: false,
                duration_ms: 131.5,
                counts: { tests: 5, passed: 4, failed: 1, skipped: 1, todo: 0 },
            },
        },
    ]);

    const summary = JSON.parse(output);
    assert.equal(summary.tests, 5);
    assert.equal(summary.pass, 4);
    assert.equal(summary.fail, 1);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.duration_ms, 131.5);
    assert.deepEqual(summary.failingFiles, ['F:/repo/tests/red.contract.test.mjs']);
    assert.deepEqual(summary.coverage, coverage);
});

// Node emits one test:summary per file next to the run summary; those per-file events already
// carry duration_ms, so the slowest contract files can be named without a second measurement.
test('the reporter ranks the file summaries by duration', async () => {
    const testFile = (fileName) => path.join(process.cwd(), 'tests', fileName);
    const output = await collectReporterOutput([
        {
            type: 'test:summary',
            data: {
                file: testFile('quick.contract.test.mjs'),
                success: true,
                duration_ms: 40.6,
                counts: { tests: 3, passed: 3, failed: 0, skipped: 0, todo: 0 },
            },
        },
        {
            type: 'test:summary',
            data: {
                file: testFile('slow.contract.test.mjs'),
                success: false,
                duration_ms: 12000,
                counts: { tests: 4, passed: 2, failed: 1, skipped: 1, todo: 0 },
            },
        },
        {
            type: 'test:summary',
            data: {
                file: undefined,
                success: false,
                duration_ms: 12100,
                counts: { tests: 7, passed: 5, failed: 1, skipped: 1, todo: 0 },
            },
        },
    ]);

    const summary = JSON.parse(output);
    assert.deepEqual(summary.files, [
        { file: 'tests/slow.contract.test.mjs', duration_ms: 12000, pass: 2, fail: 1, skipped: 1 },
        { file: 'tests/quick.contract.test.mjs', duration_ms: 40.6, pass: 3, fail: 0, skipped: 0 },
    ]);
    assert.equal(summary.tests, 7, 'the run totals keep coming from the root summary');
});

// A file that kills its own process (or is cut off by --test-force-exit) never sends a
// test:summary: measured 17.09.2026 with node 24, the run summary still counts its tests.
// The reporter must not invent an entry for it, and an event without a usable duration
// stays in the list with duration_ms null instead of pretending to be the fastest file.
test('the reporter survives missing and unusable file durations', async () => {
    const testFile = (fileName) => path.join(process.cwd(), 'tests', fileName);
    const output = await collectReporterOutput([
        {
            type: 'test:summary',
            data: {
                file: testFile('no-duration.contract.test.mjs'),
                success: false,
                duration_ms: undefined,
                counts: { tests: 1, passed: 0, failed: 1, skipped: 0, todo: 0 },
            },
        },
        {
            type: 'test:summary',
            data: {
                file: testFile('measured.contract.test.mjs'),
                success: true,
                duration_ms: 7,
                counts: { tests: 1, passed: 1, failed: 0, skipped: 0, todo: 0 },
            },
        },
        {
            type: 'test:summary',
            data: { file: undefined, success: false, duration_ms: 20, counts: { tests: 3, passed: 1, failed: 2 } },
        },
    ]);

    const summary = JSON.parse(output);
    assert.deepEqual(summary.files.map((entry) => entry.file), [
        'tests/measured.contract.test.mjs',
        'tests/no-duration.contract.test.mjs',
    ]);
    assert.equal(summary.files[1].duration_ms, null);
});

// Windows only: drive letters compare case-insensitively there, and a file on another drive
// has no relative path at all. path.relative follows the host platform, so the case is
// meaningless elsewhere.
test('the reporter keeps files outside the repo root absolute', { skip: process.platform !== 'win32' }, async () => {
    const fileSummary = (file) => ({
        type: 'test:summary',
        data: { file, success: true, duration_ms: 1, counts: { tests: 1, passed: 1 } },
    });
    const output = await collectReporterOutput([
        fileSummary('F:\\repo\\tests\\inside.contract.test.mjs'),
        fileSummary('f:\\repo\\tests\\lowercase-drive.contract.test.mjs'),
        fileSummary('F:\\elsewhere\\outside.contract.test.mjs'),
        fileSummary('C:\\other-drive\\far.contract.test.mjs'),
    ], { rootDirectory: 'F:\\repo' });

    assert.deepEqual(JSON.parse(output).files.map((entry) => entry.file).sort(), [
        'C:/other-drive/far.contract.test.mjs',
        'F:/elsewhere/outside.contract.test.mjs',
        'tests/inside.contract.test.mjs',
        'tests/lowercase-drive.contract.test.mjs',
    ]);
});

test('the slow file lines stay above the summary line and skip unusable durations', () => {
    assert.equal(CONTRACT_SLOW_FILE_COUNT, 5);
    // Deliberately unsorted, with the unrankable entry first: the formatter must not rely on
    // the order the reporter happened to write.
    const files = [
        { file: 'tests/g.contract.test.mjs', duration_ms: null },
        { file: 'tests/f.contract.test.mjs', duration_ms: 100 },
        { file: 'tests/b.contract.test.mjs', duration_ms: 12000 },
        { file: 'tests/c.contract.test.mjs', duration_ms: 9900 },
        { file: 'tests/d.contract.test.mjs', duration_ms: 800 },
        { file: 'tests/e.contract.test.mjs', duration_ms: 500 },
        { file: 'tests/a.contract.test.mjs', duration_ms: 61234 },
    ];

    assert.deepEqual(formatContractSlowFileLines({ files }), [
        '[contract:slow] 61.2s tests/a.contract.test.mjs',
        '[contract:slow] 12.0s tests/b.contract.test.mjs',
        '[contract:slow] 9.9s tests/c.contract.test.mjs',
        '[contract:slow] 0.8s tests/d.contract.test.mjs',
        '[contract:slow] 0.5s tests/e.contract.test.mjs',
    ]);
    assert.deepEqual(formatContractSlowFileLines({ files: files.slice(0, 3) }), [
        '[contract:slow] 12.0s tests/b.contract.test.mjs',
        '[contract:slow] 0.1s tests/f.contract.test.mjs',
    ]);
    assert.deepEqual(formatContractSlowFileLines({ files: [files[0]] }), [], 'no duration, nothing to rank');
    assert.deepEqual(formatContractSlowFileLines({}), [], 'an older summary without files is not an error');
    assert.deepEqual(formatContractSlowFileLines(null), []);
});

// Other scripts read the last line of a run, so the slow files are printed above it.
test('the runner prints the slowest files just above the summary line', () => {
    const summaryRoot = mkdtempSync(path.join(tmpdir(), 'curvios-contract-slow-'));
    const contractSummaryPath = path.join(summaryRoot, 'summary.json');
    const lines = [];
    try {
        writeFileSync(contractSummaryPath, JSON.stringify({
            pass: 3,
            fail: 0,
            skipped: 0,
            duration_ms: 1234,
            files: [
                { file: 'tests/slow.contract.test.mjs', duration_ms: 61234, pass: 1, fail: 0, skipped: 0 },
                { file: 'tests/quick.contract.test.mjs', duration_ms: 400, pass: 2, fail: 0, skipped: 0 },
            ],
        }), 'utf8');

        const status = runContractTests(['fast'], {
            contractSummaryPath,
            log: (line) => lines.push(String(line)),
            spawn: () => ({ status: 0 }),
        });
        assert.equal(status, 0);
    } finally {
        rmSync(summaryRoot, { recursive: true, force: true });
    }

    assert.deepEqual(lines.filter((line) => line.startsWith('[contract:')), [
        '[contract:slow] 61.2s tests/slow.contract.test.mjs',
        '[contract:slow] 0.4s tests/quick.contract.test.mjs',
        `[contract:summary] pass=3 fail=0 skipped=0 durationMs=1234 summary=${contractSummaryPath}`,
    ]);
    assert.ok(lines.at(-1).startsWith('[contract:summary] '), 'nothing may follow the summary line');
});

test('the load sensitive tests read their budgets from the time scale', () => {
    for (const relativePath of [
        'tests/council-benchmark.contract.test.mjs',
        'tests/multiplayer-lifecycle-and-signaling.contract.test.mjs',
    ]) {
        const source = readRepoFile(relativePath);
        assert.ok(
            source.includes('resolveTestTimeScale'),
            `${relativePath} must scale its time budget under load`
        );
    }
});

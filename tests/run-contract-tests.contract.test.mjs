import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    CONTRACT_LOAD_TIME_SCALE,
    CONTRACT_TEST_TIMEOUT_MS,
    buildContractSummaryReporterArgs,
    resolveAutoTimeScaleEnv,
    formatContractSummaryLine,
    resolveContractSummaryPath,
    resolveContractTestArgs,
    resolveTestTimeScale,
} from '../scripts/run-contract-tests.mjs';
import contractSummaryReporter from '../scripts/contract-summary-reporter.mjs';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

async function collectReporterOutput(events) {
    const chunks = [];
    for await (const chunk of contractSummaryReporter((async function* emit() {
        for (const event of events) yield event;
    })())) {
        chunks.push(chunk);
    }
    return chunks.join('');
}

test('every contract test gets a hard time limit', () => {
    assert.equal(CONTRACT_TEST_TIMEOUT_MS, 120000);
    assert.ok(resolveContractTestArgs({}, 8).includes('--test-timeout=120000'));
});

const FORCE_EXIT = '--test-force-exit';

test('contract concurrency leaves two cores for the rest of the machine', () => {
    assert.deepEqual(resolveContractTestArgs({}, 8), ['--test-timeout=120000', '--test-concurrency=6', FORCE_EXIT]);
    assert.deepEqual(resolveContractTestArgs({}, 6), ['--test-timeout=120000', '--test-concurrency=4', FORCE_EXIT]);
    assert.deepEqual(resolveContractTestArgs({}, 2), ['--test-timeout=120000', '--test-concurrency=2', FORCE_EXIT]);
    assert.deepEqual(resolveContractTestArgs({}, 0), ['--test-timeout=120000', '--test-concurrency=2', FORCE_EXIT]);
});

test('CURVIOS_TEST_CONCURRENCY overrides the detected core count', () => {
    assert.deepEqual(
        resolveContractTestArgs({ CURVIOS_TEST_CONCURRENCY: '3' }, 16),
        ['--test-timeout=120000', '--test-concurrency=3', FORCE_EXIT]
    );
    for (const invalidValue of ['0', '-4', 'auto', '']) {
        assert.deepEqual(
            resolveContractTestArgs({ CURVIOS_TEST_CONCURRENCY: invalidValue }, 8),
            ['--test-timeout=120000', '--test-concurrency=6', FORCE_EXIT],
            `invalid override ${invalidValue} must fall back`
        );
    }
});

// A file whose server socket stays open after its last test kept a run alive for four
// hours at zero CPU (seen 15.09.2026); the per-test timeout cannot end that process.
test('the runner forces the child to exit once the last test is done', () => {
    assert.ok(resolveContractTestArgs({}, 8).includes(FORCE_EXIT));
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
    const output = await collectReporterOutput([
        { type: 'test:start', data: {} },
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

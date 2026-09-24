import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
    PLAYWRIGHT_ENV_FAILURE_PATTERNS,
    formatPlaywrightSummary,
    matchesKnownFailure,
    matchesKnownFailureCause,
    summarizePlaywrightResults,
} from '../scripts/summarize-playwright-results.mjs';

// The shapes below follow `JSONReport` from node_modules/playwright/types/testReporter.d.ts:
//   JSONReportTest.status       = outcome: 'skipped' | 'expected' | 'unexpected' | 'flaky'
//   JSONReportTest.expectedStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted'
//   JSONReportTest.annotations  = [{ type, description }] — `test.skip()` leaves a 'skip' entry
// A test the runner never reached (serial chain aborted after the first red) therefore shows
// outcome 'skipped' while still expecting 'passed' and carrying no skip annotation. That is the
// "did not run" bucket the list reporter only prints as prose.

function passingTest() {
    return {
        expectedStatus: 'passed',
        status: 'expected',
        annotations: [],
        results: [{ status: 'passed', errors: [] }],
    };
}

function failingTest(message) {
    return {
        expectedStatus: 'passed',
        status: 'unexpected',
        annotations: [],
        results: [{ status: 'failed', errors: [{ message }] }],
    };
}

function spec(title, line, tests) {
    return { title, line, column: 1, ok: tests.every((entry) => entry.status === 'expected'), tags: [], id: title, file: 'core-targeted-surface.spec.js', tests };
}

function createReport() {
    return {
        config: { projects: [] },
        errors: [],
        stats: { startTime: '2026-09-15T10:00:00.000Z', duration: 12_000, expected: 1, unexpected: 3, flaky: 1, skipped: 2 },
        suites: [{
            title: 'core-targeted-surface.spec.js',
            file: 'core-targeted-surface.spec.js',
            line: 0,
            column: 0,
            specs: [
                spec('T1: the menu opens', 12, [passingTest()]),
                spec('T66b: hangar shows the unlocked level', 40, [failingTest('expect(received).toBe(expected)\n\nExpected: 1\nReceived: 0')]),
                spec('T99: brand new regression', 60, [failingTest('TypeError: renderer.reportImpact is not a function')]),
            ],
            suites: [{
                title: 'surface chain',
                file: 'core-targeted-surface.spec.js',
                line: 70,
                column: 0,
                specs: [
                    spec('T50: closes under load', 75, [failingTest('Target page, context or browser has been closed')]),
                    spec('T51: skipped on purpose', 80, [{
                        expectedStatus: 'skipped',
                        status: 'skipped',
                        annotations: [{ type: 'skip', description: 'needs a CDN' }],
                        results: [],
                    }]),
                    spec('T52: never reached', 85, [{
                        expectedStatus: 'passed',
                        status: 'skipped',
                        annotations: [],
                        results: [],
                    }]),
                    spec('T53: passes on retry', 90, [{
                        expectedStatus: 'passed',
                        status: 'flaky',
                        annotations: [],
                        results: [
                            { status: 'failed', errors: [{ message: 'flaked once' }] },
                            { status: 'passed', errors: [] },
                        ],
                    }]),
                ],
            }],
        }],
    };
}

const KNOWN = [{
    spec: 'tests/core-targeted-surface.spec.js',
    title: 'T66b: hangar shows the unlocked level',
    since: '2026-08-19',
    commit: 'b81170e',
    reason: 'stale expectation',
    kind: 'stale-test',
    errorIncludes: 'Received: 0',
}];

test('playwright summary: counts every bucket of a mixed run', () => {
    const summary = summarizePlaywrightResults(createReport(), KNOWN);
    assert.equal(summary.passed, 1);
    assert.equal(summary.failed, 3);
    assert.equal(summary.skipped, 1, 'an explicit test.skip() is not a missing run');
    assert.equal(summary.didNotRun, 1, 'expectedStatus passed + outcome skipped means the chain aborted');
    assert.equal(summary.flaky, 1);
    assert.equal(summary.known, 1);
    assert.equal(summary.new, 1);
    assert.equal(summary.env, 1);
});

test('playwright summary: the fixed line is the last line of the report', () => {
    const summary = summarizePlaywrightResults(createReport(), KNOWN);
    const text = formatPlaywrightSummary(summary);
    const lines = text.split('\n').filter((line) => line.length > 0);
    assert.equal(
        lines[lines.length - 1],
        '[playwright:summary] passed=1 failed=3 skipped=1 didNotRun=1 flaky=1 known=1 new=1'
    );
    assert.equal(summary.line, lines[lines.length - 1]);
});

test('playwright summary: every red test is listed with file, line, title and classification', () => {
    const summary = summarizePlaywrightResults(createReport(), KNOWN);
    const byTitle = new Map(summary.failures.map((failure) => [failure.title, failure]));

    const known = byTitle.get('T66b: hangar shows the unlocked level');
    assert.equal(known.classification, 'known');
    assert.equal(known.file, 'core-targeted-surface.spec.js');
    assert.equal(known.line, 40);
    assert.equal(known.error, 'expect(received).toBe(expected)');

    const fresh = byTitle.get('T99: brand new regression');
    assert.equal(fresh.classification, 'new');
    assert.equal(fresh.error, 'TypeError: renderer.reportImpact is not a function');

    const env = byTitle.get('T50: closes under load');
    assert.equal(env.classification, 'env');

    const text = formatPlaywrightSummary(summary);
    assert.match(text, /core-targeted-surface\.spec\.js:40/);
    assert.match(text, /T52: never reached/, 'tests that never ran are named too');
});

test('playwright summary: exit code 0 needs zero new or environment failures and zero missing runs', () => {
    const cleanReport = createReport();
    // Drop the new regression and let the aborted test run.
    cleanReport.suites[0].specs = cleanReport.suites[0].specs.filter((entry) => !entry.title.startsWith('T99'));
    const stillMissing = summarizePlaywrightResults(cleanReport, KNOWN);
    assert.equal(stillMissing.new, 0);
    assert.equal(stillMissing.didNotRun, 1);
    assert.equal(stillMissing.exitCode, 1, 'a chain that stopped early is not a green run');

    cleanReport.suites[0].suites[0].specs = cleanReport.suites[0].suites[0].specs
        .filter((entry) => !entry.title.startsWith('T52') && !entry.title.startsWith('T50'));
    const green = summarizePlaywrightResults(cleanReport, KNOWN);
    assert.equal(green.new, 0);
    assert.equal(green.didNotRun, 0);
    assert.equal(green.known, 1);
    assert.equal(green.exitCode, 0, 'known old failures alone do not make a run red');
});

test('playwright summary: a known test needs its recorded failure cause', () => {
    const report = createReport();
    report.suites[0].specs[1].tests = [failingTest('TypeError: missing renderer bridge')];
    const summary = summarizePlaywrightResults(report, KNOWN);
    assert.equal(summary.failures.find((failure) => failure.title.startsWith('T66b')).classification, 'new');
    assert.equal(matchesKnownFailureCause(KNOWN[0], 'TypeError: missing renderer bridge'), false);
    assert.equal(matchesKnownFailureCause(KNOWN[0], 'expect(received).toBe(expected)\nReceived: 2'), false);
    assert.equal(matchesKnownFailureCause({ errorIncludes: ['Received: true', 'expect(result.playerHit)'] }, 'Received: true'), false);
});

test('playwright summary: an environment error fails even when its test is on the known list', () => {
    const report = createReport();
    const knownEnvironment = [{
        spec: 'tests/core-targeted-surface.spec.js',
        title: 'T50: closes under load',
        kind: 'env',
    }];
    const summary = summarizePlaywrightResults(report, knownEnvironment);
    assert.equal(summary.failures.find((failure) => failure.title.startsWith('T50')).classification, 'env');
    assert.equal(summary.exitCode, 1);
});

test('playwright summary: known entries match by spec file and test id', () => {
    const entry = { spec: 'tests/core-targeted-surface.spec.js', title: 'T66b: hangar shows the unlocked level' };
    assert.equal(matchesKnownFailure(entry, { file: 'core-targeted-surface.spec.js', title: 'T66b: hangar shows the unlocked level' }), true);
    assert.equal(matchesKnownFailure(entry, { file: 'core-targeted-surface.spec.js', title: 'T66b: hangar shows the unlocked level after reload' }), true, 'the id prefix carries the identity');
    assert.equal(matchesKnownFailure(entry, { file: 'core-targeted-runtime.spec.js', title: 'T66b: hangar shows the unlocked level' }), false, 'a different spec is a different test');
    assert.equal(matchesKnownFailure(entry, { file: 'core-targeted-surface.spec.js', title: 'T66: hangar shows the unlocked level' }), false);
});

test('playwright summary: environment noise is recognised by message', () => {
    assert.deepEqual(PLAYWRIGHT_ENV_FAILURE_PATTERNS, [
        'Target page, context or browser has been closed',
        'Failed to fetch dynamically imported module',
    ]);
});

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

// Source assurances in the style of ci-automation: a run without the JSON reporter leaves no
// machine-readable record at all, so the wiring itself is part of the contract.
test('playwright summary: the config always writes results.json into the run folder', () => {
    const config = readRepoFile('playwright.config.js');
    assert.match(config, /\['json',\s*\{\s*outputFile:\s*jsonResultsFile\s*\}\]/, 'the json reporter is registered');
    assert.match(config, /const jsonResultsFile = path\.join\(outputDir, 'results\.json'\)/);
    assert.equal(
        (config.match(/\['list'\]/g) || []).length >= 1,
        true,
        'the readable list reporter stays next to the json one'
    );
});

test('playwright summary: both runners report the summary after a run', () => {
    const profile = readRepoFile('scripts/playwright-run-profile.mjs');
    assert.match(profile, /summarizePlaywrightResultsFile/);
    assert.match(profile, /summary\.txt/);
    assert.match(profile, /reportPlaywrightRunSummary\(env\)/);

    const clusters = readRepoFile('scripts/run-playwright-targeted-clusters.mjs');
    assert.match(clusters, /summarizePlaywrightResultsFile/);
    assert.match(clusters, /printClusterSummaries\(summaries\)/);
});

test('playwright summary: an empty report fails the gate', () => {
    const summary = summarizePlaywrightResults({ suites: [], stats: {} }, []);
    assert.equal(summary.exitCode, 1);
    assert.equal(summary.line, '[playwright:summary] passed=0 failed=0 skipped=0 didNotRun=0 flaky=0 known=0 new=0');
});

test('playwright summary: a top-level reporter error fails the gate', () => {
    const report = { suites: [{ specs: [spec('passes', 1, [passingTest()])] }], errors: [{ message: 'worker crashed' }] };
    const summary = summarizePlaywrightResults(report, []);
    assert.equal(summary.exitCode, 1);
    assert.match(formatPlaywrightSummary(summary), /REPORT_ERROR worker crashed/);
});

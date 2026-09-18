// ============================================
// summarize-playwright-results.mjs - one machine-readable verdict per Playwright run
// ============================================
//
// The `list` reporter prints prose: "1 failed, 54 did not run, 12 passed". Nothing of that
// reaches the exit code, and on Windows a redirected log turns into UTF-16 that later greps
// read as empty. This reads the JSON reporter output instead and prints one fixed last line:
//
//   [playwright:summary] passed=N failed=N skipped=N didNotRun=N flaky=N known=N new=N
//
// Buckets follow `JSONReport` in node_modules/playwright/types/testReporter.d.ts:
//   JSONReportTest.status         = outcome 'skipped' | 'expected' | 'unexpected' | 'flaky'
//   JSONReportTest.expectedStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted'
//   JSONReportTest.annotations    = [{ type }], where `test.skip()` leaves a 'skip' entry
// A test the runner never reached - a serial chain that aborted after its first red - is
// reported as outcome 'skipped' while it still expects 'passed' and carries no skip annotation.
// That is `didNotRun`, and it is the number agents kept missing.
//
// `--durations` adds the timing block from ./playwright-durations.mjs in front of that line:
// sum per spec, the slowest tests, the gaps between tests and the overhead figure. Without the
// switch the output stays byte for byte the same, because other scripts parse it.
//
// Usage: node scripts/summarize-playwright-results.mjs <results.json> [--known <file>]
//        [--out <summary.txt>] [--durations] [--gap-threshold=<seconds>]

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
    DEFAULT_GAP_THRESHOLD_SECONDS,
    formatPlaywrightDurations,
    summarizePlaywrightDurations,
} from './playwright-durations.mjs';

export const PLAYWRIGHT_SUMMARY_PREFIX = '[playwright:summary]';

/** Failures that say "the machine wobbled", not "the product broke". */
export const PLAYWRIGHT_ENV_FAILURE_PATTERNS = Object.freeze([
    'Target page, context or browser has been closed',
    'Failed to fetch dynamically imported module',
]);

export const DEFAULT_KNOWN_FAILURES_PATH = path.join('scripts', 'architecture', 'playwright-known-failures.json');

// Built from a char code so the source carries no raw control character.
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const TEST_ID_PATTERN = /^([A-Za-z][A-Za-z0-9]*[0-9][A-Za-z0-9]*):/;

function stripAnsi(value) {
    return String(value ?? '').replace(ANSI_PATTERN, '');
}

function toSpecKey(file) {
    return path.basename(String(file || '').replace(/\\/g, '/'));
}

function toTestId(title) {
    return TEST_ID_PATTERN.exec(String(title || ''))?.[1] || '';
}

/**
 * A known entry points at one spec file plus one test. Titles drift (wording changes, a suffix
 * is added), so an entry whose title starts with a test id such as `T66b:` matches every test
 * of that spec carrying the same id. Entries without an id must match the title exactly.
 */
export function matchesKnownFailure(entry, test) {
    if (!entry || !test) return false;
    if (toSpecKey(entry.spec) !== toSpecKey(test.file)) return false;
    const entryId = toTestId(entry.title);
    if (entryId) return toTestId(test.title) === entryId;
    return String(entry.title || '') === String(test.title || '');
}

function firstErrorLine(result) {
    const messages = Array.isArray(result?.errors) ? result.errors : [];
    const raw = messages[0]?.message || result?.error?.message || '';
    return stripAnsi(raw).split('\n').map((line) => line.trim()).find((line) => line.length > 0) || '';
}

function isEnvFailure(message) {
    const text = String(message || '');
    return PLAYWRIGHT_ENV_FAILURE_PATTERNS.some((pattern) => text.includes(pattern));
}

function hasSkipAnnotation(test) {
    const annotations = Array.isArray(test?.annotations) ? test.annotations : [];
    return annotations.some((annotation) => {
        const type = String(annotation?.type || '').toLowerCase();
        return type === 'skip' || type === 'fixme';
    });
}

function* iterateTests(suite, titlePath = []) {
    if (!suite || typeof suite !== 'object') return;
    const nextPath = suite.title ? [...titlePath, String(suite.title)] : titlePath;
    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
        for (const test of Array.isArray(spec.tests) ? spec.tests : []) {
            yield {
                test,
                title: String(spec.title || ''),
                titlePath: nextPath,
                file: String(spec.file || suite.file || ''),
                line: Number(spec.line) || 0,
            };
        }
    }
    for (const child of Array.isArray(suite.suites) ? suite.suites : []) {
        yield* iterateTests(child, nextPath);
    }
}

/**
 * Turns a Playwright JSON report into the counts and the red-test list.
 * Pure: no disk, no clock, no environment.
 */
export function summarizePlaywrightResults(report, knownFailures = []) {
    const known = Array.isArray(knownFailures) ? knownFailures : [];
    const counts = { passed: 0, failed: 0, skipped: 0, didNotRun: 0, flaky: 0, known: 0, new: 0, env: 0 };
    const failures = [];
    const missing = [];

    for (const suite of Array.isArray(report?.suites) ? report.suites : []) {
        for (const entry of iterateTests(suite)) {
            const outcome = String(entry.test?.status || '');
            if (outcome === 'expected') {
                counts.passed += 1;
                continue;
            }
            if (outcome === 'flaky') {
                counts.flaky += 1;
                continue;
            }
            if (outcome === 'skipped') {
                const deliberate = String(entry.test?.expectedStatus || '') === 'skipped' || hasSkipAnnotation(entry.test);
                if (deliberate) counts.skipped += 1;
                else {
                    counts.didNotRun += 1;
                    missing.push({ file: entry.file, line: entry.line, title: entry.title, titlePath: entry.titlePath });
                }
                continue;
            }
            if (outcome !== 'unexpected') continue;

            counts.failed += 1;
            const results = Array.isArray(entry.test?.results) ? entry.test.results : [];
            const error = firstErrorLine(results[results.length - 1]);
            const matched = known.find((candidate) => matchesKnownFailure(candidate, entry));
            let classification = 'new';
            if (matched) classification = 'known';
            else if (isEnvFailure(error)) classification = 'env';
            counts[classification] += 1;
            failures.push({
                file: entry.file,
                line: entry.line,
                title: entry.title,
                titlePath: entry.titlePath,
                error,
                classification,
                since: matched?.since || '',
                reason: matched?.reason || '',
            });
        }
    }

    const line = formatPlaywrightSummaryLine(counts);
    return { ...counts, failures, missing, line, exitCode: counts.new === 0 && counts.didNotRun === 0 ? 0 : 1 };
}

/** The one fixed line every agent may parse. */
export function formatPlaywrightSummaryLine(counts, prefix = PLAYWRIGHT_SUMMARY_PREFIX) {
    const value = (key) => Number(counts?.[key]) || 0;
    return `${prefix} passed=${value('passed')} failed=${value('failed')} `
        + `skipped=${value('skipped')} didNotRun=${value('didNotRun')} flaky=${value('flaky')} `
        + `known=${value('known')} new=${value('new')}`;
}

/** Plain UTF-8 text, no ANSI, summary line last. */
export function formatPlaywrightSummary(summary) {
    const lines = [];
    for (const failure of summary.failures) {
        const where = `${failure.file}:${failure.line}`;
        const context = failure.titlePath.length > 1 ? ` [${failure.titlePath.slice(1).join(' > ')}]` : '';
        lines.push(`${PLAYWRIGHT_SUMMARY_PREFIX} ${failure.classification.toUpperCase()} ${where} ${failure.title}${context}`);
        if (failure.error) lines.push(`    ${failure.error}`);
        if (failure.classification === 'known' && failure.since) {
            lines.push(`    known since ${failure.since}${failure.reason ? `: ${failure.reason}` : ''}`);
        }
    }
    for (const entry of summary.missing) {
        lines.push(`${PLAYWRIGHT_SUMMARY_PREFIX} DIDNOTRUN ${entry.file}:${entry.line} ${entry.title}`);
    }
    lines.push(summary.line);
    return `${lines.join('\n')}\n`;
}

export function readKnownFailures(knownFailuresPath = DEFAULT_KNOWN_FAILURES_PATH) {
    try {
        const parsed = JSON.parse(fs.readFileSync(knownFailuresPath, 'utf8'));
        const entries = Array.isArray(parsed) ? parsed : parsed?.entries;
        return Array.isArray(entries) ? entries : [];
    } catch {
        return [];
    }
}

/**
 * Reads one results.json, prints the summary and optionally mirrors it next to the run.
 * Returns the summary; never throws when the file is missing - a run that died before the
 * reporter wrote anything is reported as such instead of masking the real error.
 */
export function summarizePlaywrightResultsFile(resultsPath, options = {}) {
    const { knownFailuresPath, summaryPath, log = console.log, durations = false, gapThresholdMs } = options;
    let report = null;
    try {
        report = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    } catch {
        log(`${PLAYWRIGHT_SUMMARY_PREFIX} no results.json at ${resultsPath}`);
        return null;
    }

    const summary = summarizePlaywrightResults(report, readKnownFailures(knownFailuresPath || DEFAULT_KNOWN_FAILURES_PATH));
    // The timing block goes first so the `[playwright:summary]` line stays the last one.
    const timing = durations
        ? formatPlaywrightDurations(summarizePlaywrightDurations(report, { gapThresholdMs }))
        : '';
    const text = `${timing}${formatPlaywrightSummary(summary)}`;
    log(text.trimEnd());
    if (summaryPath) {
        try {
            fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
            fs.writeFileSync(summaryPath, text, 'utf8');
        } catch { /* the summary is a convenience, never a reason to fail a run */ }
    }
    return summary;
}

function toGapThresholdMs(rawSeconds) {
    const seconds = Number(String(rawSeconds || '').trim());
    if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_GAP_THRESHOLD_SECONDS * 1000;
    return Math.round(seconds * 1000);
}

function parseCliArgs(argv) {
    const options = {
        resultsPath: '',
        knownFailuresPath: '',
        summaryPath: '',
        durations: false,
        gapThresholdMs: DEFAULT_GAP_THRESHOLD_SECONDS * 1000,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '');
        if (value === '--known') options.knownFailuresPath = String(argv[++index] || '');
        else if (value.startsWith('--known=')) options.knownFailuresPath = value.slice('--known='.length);
        else if (value === '--out') options.summaryPath = String(argv[++index] || '');
        else if (value.startsWith('--out=')) options.summaryPath = value.slice('--out='.length);
        else if (value === '--durations') options.durations = true;
        else if (value === '--gap-threshold') options.gapThresholdMs = toGapThresholdMs(argv[++index]);
        else if (value.startsWith('--gap-threshold=')) {
            options.gapThresholdMs = toGapThresholdMs(value.slice('--gap-threshold='.length));
        } else if (value === '--file') options.resultsPath = String(argv[++index] || '');
        else if (value.startsWith('--file=')) options.resultsPath = value.slice('--file='.length);
        else if (!value.startsWith('-') && !options.resultsPath) options.resultsPath = value;
    }
    return options;
}

function main(argv) {
    const options = parseCliArgs(argv);
    if (!options.resultsPath) {
        console.error('usage: node scripts/summarize-playwright-results.mjs <results.json> [--known <file>] '
            + '[--out <summary.txt>] [--durations] [--gap-threshold=<seconds>]');
        process.exit(2);
    }
    const summary = summarizePlaywrightResultsFile(options.resultsPath, options);
    process.exit(summary ? summary.exitCode : 1);
}

function isDirectRun() {
    const entry = String(process.argv[1] || '');
    if (!entry) return false;
    try {
        return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
}

if (isDirectRun()) {
    main(process.argv.slice(2));
}

// ============================================
// playwright-durations.mjs - where the wall clock of a Playwright run actually goes
// ============================================
//
// The `[playwright:summary]` line answers "how many tests were green". It never answers
// "why did the run take twenty minutes". This module reads the same results.json and turns
// the timing fields of the JSON reporter into four answers:
//
//   [playwright:spec]     <sek>s tests=<n> <spec>            sum per spec file, descending
//   [playwright:slow]     <sek>s <spec> > <title>            the slowest tests
//   [playwright:gap]      <sek>s nach "<a>" vor "<b>"        idle time between two tests
//   [playwright:overhead] tests=… testTimeMs=… wallMs=…      the base price per test
//
// A gap is the time between the end of one test and the start of the next one on the same
// worker. Nothing of it is inside a test body, so it is the measured base price: launching
// Electron, loading the game, closing the app - plus the occasional hang (a desktop-flows run
// showed 513 s with no trace at all).
//
// Fields per attempt follow `JSONReportTestResult` in
// node_modules/playwright/types/testReporter.d.ts: `startTime` (ISO string), `duration` (ms),
// `status`, `retry`, `workerIndex`.

export const DEFAULT_GAP_THRESHOLD_SECONDS = 60;
export const SLOW_TEST_LIMIT = 15;

export const PLAYWRIGHT_SPEC_PREFIX = '[playwright:spec]';
export const PLAYWRIGHT_SLOW_PREFIX = '[playwright:slow]';
export const PLAYWRIGHT_GAP_PREFIX = '[playwright:gap]';
export const PLAYWRIGHT_GAPS_NOTE_PREFIX = '[playwright:gaps]';
export const PLAYWRIGHT_OVERHEAD_PREFIX = '[playwright:overhead]';

// Playwright itself separates spec file and title with this arrow; written as an escape so the
// source file stays plain ASCII for the encoding guard.
const TITLE_SEPARATOR = ' › ';

function toSpecFile(value) {
    return String(value || '').replace(/\\/g, '/');
}

function toMilliseconds(isoTime) {
    const parsed = Date.parse(String(isoTime || ''));
    return Number.isFinite(parsed) ? parsed : null;
}

function toWorkerIndex(result) {
    const value = result?.workerIndex;
    return Number.isFinite(Number(value)) && value !== null && value !== undefined ? Number(value) : null;
}

function* iterateReportSpecs(suite) {
    if (!suite || typeof suite !== 'object') return;
    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) {
        yield {
            file: toSpecFile(spec?.file || suite.file || ''),
            title: String(spec?.title || ''),
            line: Number(spec?.line) || 0,
            tests: Array.isArray(spec?.tests) ? spec.tests : [],
        };
    }
    for (const child of Array.isArray(suite.suites) ? suite.suites : []) {
        yield* iterateReportSpecs(child);
    }
}

/**
 * Flattens a JSON report into one entry per *attempt*, sorted by start time.
 *
 * Two deliberate decisions, because both would otherwise falsify the numbers:
 *  - Retries (`retry > 0`) each get their own entry. The worker really spent that time, so a
 *    flaky test must show the full price; per test the attempts are summed again later.
 *  - Skipped attempts are dropped. They cost nothing, but they carry a start time with a zero
 *    duration - kept, such an empty point would split one real gap into two harmless ones.
 * Attempts without a parseable `startTime` are dropped for the same reason: they cannot be
 * placed on the timeline.
 *
 * Pure: no disk, no clock, no environment.
 */
export function collectPlaywrightTestAttempts(report) {
    const attempts = [];
    for (const suite of Array.isArray(report?.suites) ? report.suites : []) {
        for (const spec of iterateReportSpecs(suite)) {
            for (const test of spec.tests) {
                for (const result of Array.isArray(test?.results) ? test.results : []) {
                    if (String(result?.status || '') === 'skipped') continue;
                    const startMs = toMilliseconds(result?.startTime);
                    if (startMs === null) continue;
                    const durationMs = Math.max(0, Number(result?.duration) || 0);
                    attempts.push({
                        spec: spec.file,
                        title: spec.title,
                        testKey: `${spec.file}:${spec.line}:${spec.title}`,
                        retry: Number(result?.retry) || 0,
                        workerIndex: toWorkerIndex(result),
                        startMs,
                        durationMs,
                        endMs: startMs + durationMs,
                    });
                }
            }
        }
    }
    return attempts.sort((left, right) => left.startMs - right.startMs);
}

function sumBySpec(attempts) {
    const bySpec = new Map();
    for (const attempt of attempts) {
        const entry = bySpec.get(attempt.spec) || { spec: attempt.spec, ms: 0, tests: new Set() };
        entry.ms += attempt.durationMs;
        entry.tests.add(attempt.testKey);
        bySpec.set(attempt.spec, entry);
    }
    return [...bySpec.values()]
        .map((entry) => ({ spec: entry.spec, ms: entry.ms, tests: entry.tests.size }))
        .sort((left, right) => right.ms - left.ms || left.spec.localeCompare(right.spec));
}

function sumByTest(attempts) {
    const byTest = new Map();
    for (const attempt of attempts) {
        const entry = byTest.get(attempt.testKey)
            || { spec: attempt.spec, title: attempt.title, ms: 0, attempts: 0 };
        entry.ms += attempt.durationMs;
        entry.attempts += 1;
        byTest.set(attempt.testKey, entry);
    }
    return [...byTest.values()].sort((left, right) => right.ms - left.ms
        || left.spec.localeCompare(right.spec)
        || left.title.localeCompare(right.title));
}

/**
 * Decides how gaps may be counted at all.
 *
 * `timeline`   - one test at a time, so every hole in the timeline is idle time. This is the
 *                desktop case (`playwright.config.js` pins `workers` to 1). Note that a single
 *                configured worker still produces several `workerIndex` values: Playwright
 *                replaces a crashed worker with a fresh one. Grouping by index would hide
 *                exactly those restart holes.
 * `per-worker` - real parallelism, where a hole in one worker usually means another worker was
 *                still busy. Mixing them would invent overhead that never existed.
 * `none`       - parallel work whose attempts carry no `workerIndex`; the gaps cannot be
 *                attributed, and a guess is worse than a missing line.
 */
function resolveGapMode(report, attempts) {
    const configured = Number(report?.config?.workers)
        || Number(report?.config?.metadata?.actualWorkers)
        || 0;
    if (configured === 1) return 'timeline';
    const missing = attempts.some((attempt) => attempt.workerIndex === null);
    if (missing) return 'none';
    if (configured > 1) return 'per-worker';
    const indices = new Set(attempts.map((attempt) => attempt.workerIndex));
    return indices.size > 1 ? 'per-worker' : 'timeline';
}

/** Idle time between neighbouring tests, grouped as `resolveGapMode` allows. */
function collectGaps(report, attempts) {
    const mode = resolveGapMode(report, attempts);
    if (mode === 'none') return { gaps: [], available: false };

    const byWorker = new Map();
    for (const attempt of attempts) {
        const key = mode === 'timeline' ? 0 : attempt.workerIndex;
        const bucket = byWorker.get(key) || [];
        bucket.push(attempt);
        byWorker.set(key, bucket);
    }
    const gaps = [];
    for (const [, bucket] of byWorker) {
        const ordered = [...bucket].sort((left, right) => left.startMs - right.startMs);
        for (let index = 1; index < ordered.length; index += 1) {
            const previous = ordered[index - 1];
            const next = ordered[index];
            const ms = next.startMs - previous.endMs;
            if (ms <= 0) continue;
            gaps.push({
                ms,
                mode,
                workerIndex: next.workerIndex,
                previousWorkerIndex: previous.workerIndex,
                previousSpec: previous.spec,
                previousTitle: previous.title,
                nextSpec: next.spec,
                nextTitle: next.title,
            });
        }
    }
    return { gaps: gaps.sort((left, right) => right.ms - left.ms), available: true };
}

function median(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    const value = sorted.length % 2 === 1
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
    return Math.round(value);
}

/**
 * Turns a Playwright JSON report into spec sums, the slowest tests, the gaps above the
 * threshold and the overhead figure. Pure: no disk, no clock, no environment.
 */
export function summarizePlaywrightDurations(report, options = {}) {
    const gapThresholdMs = Number.isFinite(Number(options.gapThresholdMs))
        ? Math.max(0, Number(options.gapThresholdMs))
        : DEFAULT_GAP_THRESHOLD_SECONDS * 1000;
    const slowLimit = Number.isFinite(Number(options.slowLimit))
        ? Math.max(0, Number(options.slowLimit))
        : SLOW_TEST_LIMIT;

    const attempts = collectPlaywrightTestAttempts(report);
    const specs = sumBySpec(attempts);
    const tests = sumByTest(attempts);
    const { gaps, available } = collectGaps(report, attempts);
    const gapValues = gaps.map((gap) => gap.ms);

    const testTimeMs = attempts.reduce((total, attempt) => total + attempt.durationMs, 0);
    const starts = attempts.map((attempt) => attempt.startMs);
    const ends = attempts.map((attempt) => attempt.endMs);
    const wallMs = attempts.length === 0 ? 0 : Math.max(...ends) - Math.min(...starts);
    const workers = new Set(attempts.map((attempt) => attempt.workerIndex).filter((value) => value !== null));

    return {
        specs,
        slowest: tests.slice(0, slowLimit),
        gaps: gaps.filter((gap) => gap.ms >= gapThresholdMs),
        gapsAvailable: available,
        gapThresholdMs,
        overhead: {
            tests: tests.length,
            attempts: attempts.length,
            testTimeMs,
            wallMs,
            gapMs: gapValues.reduce((total, value) => total + value, 0),
            medianGapMs: median(gapValues),
            workers: workers.size,
        },
    };
}

function toSeconds(ms) {
    return (Number(ms) / 1000).toFixed(1);
}

/** Plain UTF-8 text, no ANSI, overhead line last - the summary line is appended after it. */
export function formatPlaywrightDurations(durations) {
    if (!durations) return '';
    const lines = [];
    for (const entry of durations.specs) {
        lines.push(`${PLAYWRIGHT_SPEC_PREFIX} ${toSeconds(entry.ms)}s tests=${entry.tests} ${entry.spec}`);
    }
    for (const entry of durations.slowest) {
        lines.push(`${PLAYWRIGHT_SLOW_PREFIX} ${toSeconds(entry.ms)}s ${entry.spec}${TITLE_SEPARATOR}${entry.title}`);
    }
    if (durations.gapsAvailable) {
        for (const gap of durations.gaps) {
            lines.push(`${PLAYWRIGHT_GAP_PREFIX} ${toSeconds(gap.ms)}s nach "${gap.previousTitle}" vor "${gap.nextTitle}"`);
        }
    } else {
        lines.push(`${PLAYWRIGHT_GAPS_NOTE_PREFIX} not reported: the report has attempts without workerIndex, `
            + 'so idle time cannot be told apart from work on another worker');
    }
    const { overhead } = durations;
    lines.push(`${PLAYWRIGHT_OVERHEAD_PREFIX} tests=${overhead.tests} testTimeMs=${overhead.testTimeMs} `
        + `wallMs=${overhead.wallMs} gapMs=${overhead.gapMs} medianGapMs=${overhead.medianGapMs}`);
    return `${lines.join('\n')}\n`;
}

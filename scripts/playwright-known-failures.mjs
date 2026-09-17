// ============================================
// playwright-known-failures.mjs - the old red tests, in the repo instead of in someone's notes
// ============================================
//
// Until now the list of tests that are red without anyone's current change lived in memory
// notes. Every agent that met one of them started a fresh baseline investigation, and a serial
// spec chain aborted at the first of them, leaving the rest of the cluster unrun.
//
// `scripts/architecture/playwright-known-failures.json` holds the list, `count` is its ratchet:
// the number may sink, never rise. `--skip-known` turns the entries of the selected specs into
// a `--grep-invert` so a chain reaches its end.

import fs from 'node:fs';
import path from 'node:path';

export const PLAYWRIGHT_KNOWN_FAILURES_PATH = path.join('scripts', 'architecture', 'playwright-known-failures.json');
export const KNOWN_FAILURE_KINDS = Object.freeze(['stale-test', 'regression', 'env', 'flaky']);
export const SKIP_KNOWN_FLAG = '--skip-known';

// A title that starts with a test id such as `T66b:` is addressed by that id: the wording of
// these tests drifts, the id does not.
const TEST_ID_PATTERN = /^([A-Za-z][A-Za-z0-9]*[0-9][A-Za-z0-9]*):/;

export function toKnownFailureSpecKey(specPath) {
    return path.basename(String(specPath || '').replace(/\\/g, '/'));
}

export function loadPlaywrightKnownFailures(filePath = PLAYWRIGHT_KNOWN_FAILURES_PATH) {
    let parsed = null;
    try {
        parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return { entries: [], count: 0 };
    }
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return { entries, count: Number(parsed?.count) || entries.length };
}

/** Entries of the given spec files; an empty selection means "every entry". */
export function selectKnownFailuresForSpecs(entries, specPaths = []) {
    const list = Array.isArray(entries) ? entries : [];
    const selection = (Array.isArray(specPaths) ? specPaths : []).map(toKnownFailureSpecKey).filter(Boolean);
    if (selection.length === 0) return list;
    const wanted = new Set(selection);
    return list.filter((entry) => wanted.has(toKnownFailureSpecKey(entry.spec)));
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds the `--grep-invert` source for a set of entries. Playwright matches the whole title
 * path ("project > file > describe > title"), so every alternative includes its spec basename.
 * Test IDs are only unique within a spec; a global `T64:` pattern would hide an unrelated T64.
 */
export function buildKnownFailureGrepInvert(entries) {
    const alternatives = [];
    for (const entry of Array.isArray(entries) ? entries : []) {
        const id = TEST_ID_PATTERN.exec(String(entry?.title || ''))?.[1];
        const titlePattern = id ? `\\b${escapeRegExp(id)}:` : escapeRegExp(entry?.title);
        const specPattern = escapeRegExp(toKnownFailureSpecKey(entry?.spec));
        const alternative = specPattern && titlePattern ? `${specPattern}.*${titlePattern}` : '';
        if (alternative && !alternatives.includes(alternative)) alternatives.push(alternative);
    }
    return alternatives.join('|');
}

/** Collects the spec paths a Playwright argument list selects. */
export function collectSpecArgs(argv) {
    return (Array.isArray(argv) ? argv : [])
        .map((value) => String(value || ''))
        .filter((value) => !value.startsWith('-') && /\.spec\.[cm]?[jt]sx?$/.test(value));
}

/**
 * Removes `--skip-known` from the argument list and puts the resulting `--grep-invert` in its
 * place. An explicit `--grep-invert` of the caller is kept and combined with an alternation.
 */
export function applySkipKnownFailures(argv, { knownFailuresPath, log = console.log } = {}) {
    const args = (Array.isArray(argv) ? argv : []).map((value) => String(value || ''));
    if (!args.includes(SKIP_KNOWN_FLAG)) return args;

    const remaining = args.filter((value) => value !== SKIP_KNOWN_FLAG);
    const catalog = loadPlaywrightKnownFailures(knownFailuresPath || PLAYWRIGHT_KNOWN_FAILURES_PATH);
    const selected = selectKnownFailuresForSpecs(catalog.entries, collectSpecArgs(remaining));
    const pattern = buildKnownFailureGrepInvert(selected);
    if (!pattern) {
        log('[playwright:known] --skip-known found no entries for this selection');
        return remaining;
    }

    const existing = readGrepInvert(remaining);
    const combined = existing ? `${existing}|${pattern}` : pattern;
    const withoutGrepInvert = stripGrepInvert(remaining);
    log(`[playwright:known] --skip-known hides ${selected.length} known red test(s)`);
    return [...withoutGrepInvert, `--grep-invert=${combined}`];
}

function readGrepInvert(args) {
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === '--grep-invert') return String(args[index + 1] || '');
        if (args[index].startsWith('--grep-invert=')) return args[index].slice('--grep-invert='.length);
    }
    return '';
}

function stripGrepInvert(args) {
    const result = [];
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === '--grep-invert') {
            index += 1;
            continue;
        }
        if (args[index].startsWith('--grep-invert=')) continue;
        result.push(args[index]);
    }
    return result;
}

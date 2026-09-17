import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
    KNOWN_FAILURE_KINDS,
    PLAYWRIGHT_KNOWN_FAILURES_PATH,
    buildKnownFailureGrepInvert,
    loadPlaywrightKnownFailures,
    selectKnownFailuresForSpecs,
} from '../scripts/playwright-known-failures.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = loadPlaywrightKnownFailures(path.join(REPO_ROOT, PLAYWRIGHT_KNOWN_FAILURES_PATH));

function readSpec(relativeSpecPath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativeSpecPath), 'utf8');
}

test('known failures: the list is not empty and stays inside its ratchet', () => {
    assert.ok(catalog.entries.length > 0, 'an empty list would silently skip nothing');
    assert.ok(Number.isInteger(catalog.count) && catalog.count > 0, 'the file carries a count');
    assert.ok(
        catalog.entries.length <= catalog.count,
        `the list grew to ${catalog.entries.length} against the ratchet ${catalog.count}; `
        + 'fix the test instead, and raise the count only on an explicit instruction'
    );
});

test('known failures: every entry points at a spec file that exists', () => {
    for (const entry of catalog.entries) {
        const specPath = path.join(REPO_ROOT, entry.spec);
        assert.ok(fs.existsSync(specPath), `${entry.spec} does not exist (entry "${entry.title}")`);
    }
});

test('known failures: every entry points at a test title that still exists', () => {
    const sources = new Map();
    for (const entry of catalog.entries) {
        if (!sources.has(entry.spec)) sources.set(entry.spec, readSpec(entry.spec));
        assert.ok(
            sources.get(entry.spec).includes(entry.title),
            `"${entry.title}" no longer exists in ${entry.spec}; a renamed or fixed test must drop its entry`
        );
    }
});

test('known failures: every entry carries a date, a reason and a known kind', () => {
    for (const entry of catalog.entries) {
        assert.match(String(entry.since), /^\d{4}-\d{2}-\d{2}$/, `${entry.title} needs a since date`);
        assert.ok(String(entry.reason || '').trim().length > 10, `${entry.title} needs a reason`);
        assert.ok(
            KNOWN_FAILURE_KINDS.includes(String(entry.kind)),
            `${entry.title} has kind "${entry.kind}", expected one of ${KNOWN_FAILURE_KINDS.join(', ')}`
        );
    }
});

test('known failures: no entry is listed twice', () => {
    const seen = new Set();
    for (const entry of catalog.entries) {
        const key = `${entry.spec}::${entry.title}`;
        assert.equal(seen.has(key), false, `${key} is listed twice`);
        seen.add(key);
    }
});

test('known failures: only entries of the selected specs are skipped', () => {
    const selected = selectKnownFailuresForSpecs(catalog.entries, ['tests/recording.spec.js']);
    assert.ok(selected.length > 0);
    assert.ok(selected.every((entry) => entry.spec === 'tests/recording.spec.js'));

    const windowsStyle = selectKnownFailuresForSpecs(catalog.entries, ['tests\\recording.spec.js']);
    assert.equal(windowsStyle.length, selected.length, 'backslash paths select the same specs');

    assert.equal(
        selectKnownFailuresForSpecs(catalog.entries, []).length,
        catalog.entries.length,
        'without a spec selection every entry counts'
    );
});

test('known failures: the grep-invert scopes test ids and titles to their spec', () => {
    const pattern = buildKnownFailureGrepInvert([
        { spec: 'tests/core-targeted-surface.spec.js', title: 'T66b: Vehicle-Selection bleibt konsistent' },
        { spec: 'tests/recording.spec.js', title: 'Format detection returns supported MIME type (v2)' },
    ]);

    const regex = new RegExp(pattern);
    assert.equal(regex.test('desktop-e2e > core-targeted-surface.spec.js > T66b: anything at all'), true);
    assert.equal(regex.test('desktop-e2e > core-targeted-surface.spec.js > T66: something else'), false);
    assert.equal(regex.test('gameplay-smoke > recording.spec.js > Format detection returns supported MIME type (v2)'), true);
    assert.equal(regex.test('gameplay-smoke > recording.spec.js > Format detection returns supported MIME type'), false);
});

test('known failures: selecting physics-hunt and stress keeps an unrelated stress T64 runnable', () => {
    const selected = selectKnownFailuresForSpecs([
        { spec: 'tests/physics-hunt.spec.js', title: 'T64: Hunt failure' },
    ], ['tests/physics-hunt.spec.js', 'tests/stress.spec.js']);
    const pattern = buildKnownFailureGrepInvert(selected);
    const regex = new RegExp(pattern);

    assert.equal(regex.test('desktop-e2e > physics-hunt.spec.js > T64: Hunt failure'), true);
    assert.equal(regex.test('desktop-e2e > stress.spec.js > T64: another stress assertion'), false);
    assert.equal(regex.test('desktop-e2e > physics-hunt.spec.js > T64: another hunt assertion'), true);
});

test('known failures: an empty selection produces no pattern at all', () => {
    assert.equal(buildKnownFailureGrepInvert([]), '');
});

test('known failures: both wrappers understand --skip-known', () => {
    const profile = fs.readFileSync(path.join(REPO_ROOT, 'scripts/playwright-run-profile.mjs'), 'utf8');
    assert.match(profile, /--skip-known/);
    assert.match(profile, /grep-invert/);

    const clusters = fs.readFileSync(path.join(REPO_ROOT, 'scripts/run-playwright-targeted-clusters.mjs'), 'utf8');
    assert.match(clusters, /--skip-known/, 'the cluster runner documents the flag it forwards');
});

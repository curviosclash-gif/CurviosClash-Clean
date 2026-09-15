import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    CLUSTER_RUNNER_DEFAULT_TIMEOUT_ARG,
    resolveClusterRunnerArgs,
} from '../scripts/run-playwright-targeted-clusters.mjs';

// `--print-clusters` used to fall through into a real run because the runner appended the
// default `--timeout` before it checked whether anything had been selected. A listing must
// never take the machine-wide Playwright lock, so the decision is a pure function now.

test('cluster args: --print-clusters only lists and starts no run', () => {
    const resolved = resolveClusterRunnerArgs(['--print-clusters']);
    assert.equal(resolved.shouldPrintClusters, true);
    assert.equal(resolved.listOnly, true);
    assert.deepEqual(resolved.selectors, []);
    assert.deepEqual(resolved.playwrightArgs, [], 'a listing needs no Playwright arguments');
});

test('cluster args: --print-clusters with a selector still only lists', () => {
    const resolved = resolveClusterRunnerArgs(['editor', '--print-clusters']);
    assert.equal(resolved.listOnly, true);
    assert.deepEqual(resolved.selectors, ['editor']);
    assert.deepEqual(resolved.playwrightArgs, []);
});

test('cluster args: a plain cluster run gets the default timeout', () => {
    const resolved = resolveClusterRunnerArgs(['editor']);
    assert.equal(resolved.listOnly, false);
    assert.equal(resolved.shouldDryRun, false);
    assert.deepEqual(resolved.selectors, ['editor']);
    assert.deepEqual(resolved.playwrightArgs, [CLUSTER_RUNNER_DEFAULT_TIMEOUT_ARG]);
});

test('cluster args: an explicit timeout is kept', () => {
    const resolved = resolveClusterRunnerArgs(['core-surface', '--timeout=60000']);
    assert.deepEqual(resolved.playwrightArgs, ['--timeout=60000']);
});

test('cluster args: selectors stop at the first option', () => {
    const resolved = resolveClusterRunnerArgs(['core-surface', 'editor', '--grep', 'T20:']);
    assert.deepEqual(resolved.selectors, ['core-surface', 'editor']);
    assert.deepEqual(resolved.playwrightArgs, ['--grep', 'T20:', CLUSTER_RUNNER_DEFAULT_TIMEOUT_ARG]);
});

test('cluster args: --dry-run prints the plan without running', () => {
    const resolved = resolveClusterRunnerArgs(['--dry-run', 'network']);
    assert.equal(resolved.shouldDryRun, true);
    assert.equal(resolved.listOnly, false);
    assert.deepEqual(resolved.selectors, ['network']);
});

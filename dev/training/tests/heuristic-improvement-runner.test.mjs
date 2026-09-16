import assert from 'node:assert/strict';
import test from 'node:test';

import {
    MAX_RUNNER_TIMEOUT_MS,
    RUNNER_EXIT_CODES,
    classifySearchState,
    runSearch,
} from '../scripts/heuristic-improvement-runner.mjs';

test('runner has a hard three-hour execution ceiling', () => {
    assert.equal(MAX_RUNNER_TIMEOUT_MS, 3 * 60 * 60 * 1000);
});

function targetState(overrides = {}) {
    return {
        version: 12,
        plateauRounds: 0,
        completeProfiles: ['defensive', 'balanced', 'aggressive'],
        lastRatios: {
            defensive: { survival: 2, kills: 2 },
            balanced: { survival: 2.1, kills: 2.2 },
            aggressive: { survival: 3, kills: 2 },
        },
        ...overrides,
    };
}

test('runner requires both metrics and all profiles before reporting the target', () => {
    assert.equal(classifySearchState(targetState()), 'target');
    assert.equal(classifySearchState(targetState({
        completeProfiles: ['defensive', 'balanced'],
    })), 'continue');
    assert.equal(classifySearchState(targetState({
        lastRatios: {
            ...targetState().lastRatios,
            aggressive: { survival: 2, kills: 1.99 },
        },
    })), 'continue');
});

test('runner stops immediately on an existing plateau without starting an iteration', () => {
    let calls = 0;
    const state = { version: 12, plateauRounds: 3 };
    const result = runSearch({
        executeIteration: () => {
            calls += 1;
            return { status: 0 };
        },
        readState: () => state,
    });

    assert.equal(result.outcome, 'plateau');
    assert.equal(result.iterations, 0);
    assert.equal(calls, 0);
});

test('runner invokes bounded iterations serially until the target is recorded', () => {
    const states = [
        { version: 12, plateauRounds: 0 },
        { version: 12, plateauRounds: 1 },
        targetState(),
    ];
    let cursor = 0;
    let active = false;
    let calls = 0;
    const result = runSearch({
        maxIterations: 5,
        executeIteration: () => {
            assert.equal(active, false);
            active = true;
            calls += 1;
            cursor += 1;
            active = false;
            return { status: 0 };
        },
        readState: () => states[cursor],
    });

    assert.equal(result.outcome, 'target');
    assert.equal(result.iterations, 2);
    assert.equal(calls, 2);
});

test('runner preserves timeout, child failure, and iteration-limit outcomes', () => {
    assert.equal(runSearch({
        maxIterations: 1,
        executeIteration: () => ({ status: 0 }),
        readState: () => ({ version: 12, plateauRounds: 0 }),
    }).outcome, 'iterationLimit');

    assert.equal(runSearch({
        executeIteration: () => ({ status: null, timedOut: true }),
        readState: () => ({ version: 12, plateauRounds: 0 }),
    }).outcome, 'timeout');

    assert.equal(runSearch({
        executeIteration: () => ({ status: 7 }),
        readState: () => ({ version: 12, plateauRounds: 0 }),
    }).outcome, 'error');

    assert.deepEqual(RUNNER_EXIT_CODES, {
        target: 0,
        error: 1,
        timeout: 2,
        plateau: 3,
        iterationLimit: 4,
    });
});

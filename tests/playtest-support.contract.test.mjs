import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
    PLAYTEST_TOKEN_HEADER,
    countDeaths,
    distanceTravelled,
    filterPlaytestErrors,
    isAuthorizedPlaytestRequest,
    resolvePlaytestOutDir,
    sanitizeShotName,
} from '../scripts/playtest/playtest-support.mjs';

const TOKEN = 'a'.repeat(48);

test('the control server only runs requests with the session token and no browser origin', () => {
    const request = (overrides = {}) => ({ method: 'POST', headers: { [PLAYTEST_TOKEN_HEADER]: TOKEN }, ...overrides });
    assert.equal(isAuthorizedPlaytestRequest(request(), TOKEN), true);
    assert.equal(isAuthorizedPlaytestRequest(request({ method: 'GET' }), TOKEN), false, 'only POST');
    assert.equal(isAuthorizedPlaytestRequest(request({ headers: {} }), TOKEN), false, 'token required');
    assert.equal(isAuthorizedPlaytestRequest(request({ headers: { [PLAYTEST_TOKEN_HEADER]: 'b'.repeat(48) } }), TOKEN), false);
    assert.equal(isAuthorizedPlaytestRequest(request({ headers: { [PLAYTEST_TOKEN_HEADER]: 'short' } }), TOKEN), false);
    assert.equal(isAuthorizedPlaytestRequest(request({
        headers: { [PLAYTEST_TOKEN_HEADER]: TOKEN, origin: 'https://example.com' },
    }), TOKEN), false, 'a web page always sends Origin and must never drive the game');
    assert.equal(isAuthorizedPlaytestRequest(request({ headers: { [PLAYTEST_TOKEN_HEADER]: '' } }), ''), false, 'no empty token');
});

test('travelled distance and deaths come from consecutive samples', () => {
    const samples = [
        { pos: [0, 0, 0], alive: true },
        { pos: [3, 4, 0], alive: true },
        { pos: null, alive: false },
        { pos: [3, 4, 12], alive: true },
        { pos: [3, 4, 12], alive: false },
    ];
    assert.equal(distanceTravelled(samples), 5, 'a missing position breaks the path instead of jumping');
    assert.equal(countDeaths(samples), 2);
    assert.equal(distanceTravelled([]), 0);
    assert.equal(countDeaths(undefined), 0);
});

test('console noise is dropped and errors before the step are ignored', () => {
    const errors = [
        { text: 'TypeError: x is undefined', at: 200 },
        { text: "The Content Security Policy directive 'frame-ancestors' is ignored", at: 300 },
        { text: 'Autofill.enable failed', at: 300 },
        { text: 'old failure', at: 50 },
    ];
    assert.deepEqual(filterPlaytestErrors(errors, 100).map((entry) => entry.text), ['TypeError: x is undefined']);
});

test('output folder is per day unless set explicitly, shot names stay file-safe', () => {
    const day = new Date(2026, 9, 2);
    assert.equal(resolvePlaytestOutDir({}, day, 'T'), path.join('T', 'curvios-playtest-20261002'));
    assert.equal(resolvePlaytestOutDir({ CURVIOS_PLAYTEST_OUT: 'out/run' }, day, 'T'), path.resolve('out/run'));
    assert.equal(sanitizeShotName('A5 notre_dame: CP12/death'), 'A5_notre_dame_CP12_death');
    assert.equal(sanitizeShotName('***'), 'shot');
});

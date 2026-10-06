import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    PLAYTEST_RUNTIME_HOOKS,
    classifyPlaytestWindow,
    PLAYTEST_TOKEN_HEADER,
    countDeaths,
    describeMatchStartProblems,
    evaluateAcceptance,
    distanceTravelled,
    filterPlaytestErrors,
    framesForMs,
    isAuthorizedPlaytestRequest,
    nameObservation,
    resolveDaemonStateFile,
    resolvePlaytestOutDir,
    sanitizePilotManeuver,
    sanitizeShotName,
    withTimeout,
} from '../scripts/playtest/playtest-support.mjs';
import { OBSERVATION_SEMANTICS_V1 } from '../src/entities/ai/observation/ObservationSemantics.js';
import { EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';

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

test('the daemon state file does not move at midnight', () => {
    assert.equal(resolveDaemonStateFile({}, 'T'), path.join('T', 'curvios-playtest-daemon.json'));
    assert.equal(
        resolveDaemonStateFile({ CURVIOS_PLAYTEST_OUT: 'out/run' }, 'T'),
        path.join(path.resolve('out/run'), 'daemon.json'),
    );
});

test('a direct maneuver speaks turn/climb/roll and rejects typos', () => {
    const maneuver = sanitizePilotManeuver({ turn: 3, climb: -0.5, fireMG: true, boost: 'yes' });
    assert.equal(maneuver.turn, 1, 'axes are clamped');
    assert.equal(maneuver.climb, -0.5);
    assert.equal(maneuver.roll, 0, 'an axis not given is neutral');
    assert.equal(maneuver.fireMG, true);
    assert.equal(maneuver.boost, false, 'only true counts as pressed');
    assert.equal(maneuver.fireRocket, false);
    assert.throws(() => sanitizePilotManeuver({ fireMg: true }), /unknown maneuver field\(s\): fireMg/);
    assert.throws(() => sanitizePilotManeuver({ yawAxis: 1 }), /allowed: turn, climb, roll/, 'raw device fields are not part of a maneuver');
    assert.equal(framesForMs(1000), 60);
    assert.equal(framesForMs(1), 1, 'at least one simulation step');
    assert.equal(framesForMs(undefined), 1);
});

test('observation values get the names of the bot observation semantics', () => {
    assert.ok(OBSERVATION_SEMANTICS_V1.length > 0);
    const vector = Array.from({ length: 64 }, (_, index) => index / 100);
    const named = nameObservation(vector, OBSERVATION_SEMANTICS_V1);
    for (const entry of OBSERVATION_SEMANTICS_V1) {
        assert.equal(named[entry.key], Math.round(vector[entry.index] * 1000) / 1000, entry.key);
    }
    assert.ok('WALL_DISTANCE_FRONT' in named);
    assert.equal(nameObservation(null, OBSERVATION_SEMANTICS_V1), null);
});

test('a match start reports every difference from the request', () => {
    assert.deepEqual(
        describeMatchStartProblems({ map: 'standard', mode: 'HUNT' }, { ok: true, mapKey: 'standard', gameMode: 'HUNT' }),
        [],
    );
    const problems = describeMatchStartProblems(
        { map: 'clockwork_canyon', mode: 'HUNT' },
        { ok: true, mapKey: 'standard', gameMode: 'CLASSIC', glbError: 'boom' },
    );
    assert.deepEqual(problems, [
        'map fell back from clockwork_canyon to standard',
        'mode is CLASSIC, not HUNT',
        'map model failed to load: boom',
    ]);
    assert.match(describeMatchStartProblems({}, { ok: false, menuReached: false, state: 'PLAYING' })[0], /menu not reached/);
});

test('a step that never ends is cut off by the timeout', async () => {
    assert.equal(await withTimeout(Promise.resolve(7), 50), 7);
    await assert.rejects(withTimeout(new Promise(() => {}), 20, 'step'), (error) => error.code === 'PLAYTEST_TIMEOUT');
});

test('every game internal the playtest driver reaches into still exists in src', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const missing = PLAYTEST_RUNTIME_HOOKS.filter(({ file, needle }) => (
        !fs.readFileSync(path.join(root, file), 'utf8').includes(needle)
    ));
    assert.deepEqual(missing, [], 'update scripts/playtest/playtest-control.mjs or playtest-driver.mjs together with the game');
});

test('the flight acceptance counts every attempt and never lowers the bar', () => {
    const attempt = (ok, extra = {}) => ({ seed: 101, completed: ok, ...extra });
    const nineOfTen = [...Array(9)].map(() => attempt(true)).concat(attempt(false, { errors: [{ kind: 'console', text: 'boom' }] }));
    const passed = evaluateAcceptance({ kind: 'parcours', map: 'micro_maw', attempts: nineOfTen, required: 9, successKey: 'completed' });
    assert.equal(passed.status, 'passed');
    assert.equal(passed.result, '9/10');
    assert.deepEqual(passed.gameBugs, [{ attempt: 10, seed: 101, map: 'micro_maw', kind: 'console', text: 'boom' }], 'errors are reported as game bugs with seed');
    const eight = [...Array(8)].map(() => attempt(true)).concat([attempt(false), attempt(false)]);
    assert.equal(evaluateAcceptance({ attempts: eight, required: 9, successKey: 'completed' }).status, 'failed');
    const blockedRun = [...Array(8)].map(() => attempt(true)).concat([attempt(false, { blocked: true }), attempt(false)]);
    assert.equal(evaluateAcceptance({ attempts: blockedRun, required: 9, successKey: 'completed' }).status, 'blocked', 'a blocked attempt is a miss that explains the gap');
    assert.equal(evaluateAcceptance({ attempts: nineOfTen.slice(0, 9), required: 9, successKey: 'completed' }).status, 'unclear', 'fewer than ten attempts prove nothing');
    assert.equal(evaluateAcceptance({ attempts: [...Array(10)].map(() => ({ won: true })), required: 8, successKey: 'won' }).status, 'passed');
});

test('window kinds come from the URL, the editor playtest included', () => {
    assert.equal(classifyPlaytestWindow('http://127.0.0.1:39001/'), 'main');
    assert.equal(classifyPlaytestWindow('http://127.0.0.1:39001/index.html'), 'main');
    assert.equal(classifyPlaytestWindow('http://127.0.0.1:39001/index.html?playtest=1&planar=0'), 'editor-playtest');
    assert.equal(classifyPlaytestWindow('http://127.0.0.1:39001/hangar.html?mode=arcade'), 'hangar');
    assert.equal(classifyPlaytestWindow(`http://127.0.0.1:39001${EDITOR_VIEW_PATHS.MAP_EDITOR}`), 'editor');
    assert.equal(classifyPlaytestWindow(`http://127.0.0.1:39001${EDITOR_VIEW_PATHS.VEHICLE_LAB}`), 'vehicle-lab');
    assert.equal(classifyPlaytestWindow('file:///F:/repo/electron/tuning-console/tuning.html'), 'tuning');
    assert.equal(classifyPlaytestWindow('file:///F:/repo/electron/settings-studio/ui/settings-studio.html'), 'settings-studio');
    assert.equal(classifyPlaytestWindow('not a url'), 'unknown');
});

test('silently clamped bots, wins and seeds show up as problems', () => {
    const problems = describeMatchStartProblems(
        { map: 'standard', mode: 'ARCADE', bots: 12, winsNeeded: 99, seed: 101 },
        { ok: true, mapKey: 'standard', gameMode: 'ARCADE', bots: 8, winsNeeded: 15, seedActual: 7 },
    );
    assert.deepEqual(problems, ['bots are 8, not 12', 'winsNeeded is 15, not 99', 'arcade seed is 7, not 101']);
});

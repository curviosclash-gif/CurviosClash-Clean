import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createMcpDispatcher, serveMcpOverStdio, toolResult } from '../scripts/playtest/playtest-mcp-protocol.mjs';
import {
    PLAYTEST_RUNTIME_HOOKS,
    PLAYTEST_TOKEN_HEADER,
    countDeaths,
    describeMatchStartProblems,
    distanceTravelled,
    filterPlaytestErrors,
    framesForMs,
    isAuthorizedPlaytestRequest,
    nameObservation,
    resolveDaemonStateFile,
    resolvePlaytestOutDir,
    sanitizePlaytestAction,
    sanitizeShotName,
    withTimeout,
} from '../scripts/playtest/playtest-support.mjs';
import { OBSERVATION_SEMANTICS_V1 } from '../src/entities/ai/observation/ObservationSemantics.js';

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

test('held control input uses the bot action fields and rejects typos', () => {
    const action = sanitizePlaytestAction({ yawAxis: 3, pitchAxis: -0.5, shootMG: true, boost: 'yes', useItem: 2 });
    assert.equal(action.yawAxis, 1, 'axes are clamped');
    assert.equal(action.pitchAxis, -0.5);
    assert.equal('rollAxis' in action, false, 'an axis not given stays untouched');
    assert.equal(action.shootMG, true);
    assert.equal(action.boost, false, 'only true counts as pressed');
    assert.equal(action.useItem, 2);
    assert.equal(action.shootItemIndex, -1);
    assert.throws(() => sanitizePlaytestAction({ shootMg: true }), /unknown action field\(s\): shootMg/);
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

test('the MCP dispatcher answers the handshake, lists tools and turns failures into tool errors', async () => {
    const dispatch = createMcpDispatcher({
        name: 'test',
        version: '0',
        tools: [
            { name: 'echo', description: 'echo', inputSchema: { type: 'object' }, run: async (args) => ({ got: args.value }) },
            { name: 'boom', description: 'fails', run: async () => { throw new Error('kaputt'); } },
            { name: 'picture', description: 'image', run: async () => toolResult('ok', { images: [{ data: 'AAAA' }] }) },
        ],
    });
    const call = (id, method, params) => dispatch({ jsonrpc: '2.0', id, method, params });
    const init = await call(1, 'initialize', { protocolVersion: '2025-03-26' });
    assert.equal(init.result.protocolVersion, '2025-03-26', 'the client version is echoed');
    assert.deepEqual(init.result.capabilities, { tools: {} });
    assert.equal(await dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }), null, 'notifications get no answer');
    const listing = await call(2, 'tools/list');
    assert.deepEqual(listing.result.tools.map((tool) => tool.name), ['echo', 'boom', 'picture']);
    assert.deepEqual(listing.result.tools[1].inputSchema, { type: 'object', properties: {} });
    const echo = await call(3, 'tools/call', { name: 'echo', arguments: { value: 5 } });
    assert.deepEqual(JSON.parse(echo.result.content[0].text), { got: 5 });
    const boom = await call(4, 'tools/call', { name: 'boom' });
    assert.equal(boom.result.isError, true, 'a failing tool is a tool error the agent can read, not a protocol error');
    assert.match(boom.result.content[0].text, /kaputt/);
    const picture = await call(5, 'tools/call', { name: 'picture' });
    assert.deepEqual(picture.result.content[1], { type: 'image', data: 'AAAA', mimeType: 'image/png' });
    assert.equal((await call(6, 'tools/call', { name: 'nope' })).error.code, -32602);
    assert.equal((await call(7, 'resources/list')).error.code, -32601);
    assert.deepEqual((await call(8, 'ping')).result, {});
});

test('the stdio transport answers line by line and runs tool calls one after another', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const order = [];
    const dispatch = createMcpDispatcher({
        name: 'test',
        version: '0',
        tools: [{
            name: 'slow',
            description: 'slow',
            run: async ({ id }) => {
                order.push(`start ${id}`);
                await new Promise((resolve) => setTimeout(resolve, 20));
                order.push(`end ${id}`);
                return id;
            },
        }],
    });
    let closed = false;
    serveMcpOverStdio(dispatch, { input, output, onClose: () => { closed = true; } });
    const lines = [];
    output.setEncoding('utf8');
    output.on('data', (chunk) => lines.push(...chunk.split('\n').filter(Boolean)));
    const callLine = (id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'slow', arguments: { id } } });
    input.write(`${callLine(1)}\n${callLine(2)}\nnot json\n`);
    input.end();
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(order, ['start 1', 'end 1', 'start 2', 'end 2'], 'calls drive one game window, so they never overlap');
    const responses = lines.map((line) => JSON.parse(line));
    assert.equal(responses.find((entry) => entry.id === null).error.code, -32700);
    assert.deepEqual(responses.filter((entry) => entry.id).map((entry) => entry.id), [1, 2]);
    assert.equal(closed, true, 'the server shuts down when the client closes stdin');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { coerceBalancingValue, createBalancingStoreForRepo, runBalancingOperation } from '../scripts/playtest/playtest-balancing.mjs';
import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { createMapBalancingLiveApi, registerMapBalancingLiveSource } from '../src/core/balancing/MapBalancingLive.js';
import { resetMapBalancingRuntimeState } from '../src/core/balancing/MapBalancingRuntime.js';

const require = createRequire(import.meta.url);
const { createMapBalancingStore } = require('../electron/map-balancing-store.cjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'curvios-mcp-balancing-'));
mkdirSync(path.join(scratch, 'data', 'balancing'), { recursive: true });
copyFileSync(path.join(ROOT, 'data', 'balancing', 'modes.json'), path.join(scratch, 'data', 'balancing', 'modes.json'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
test.afterEach(() => {
    resetMapBalancingRuntimeState();
    registerMapBalancingLiveSource(null);
});

const store = createMapBalancingStore({ root: ROOT, dataRoot: scratch, writable: true });
const mazeFile = path.join(scratch, 'data', 'balancing', 'maps', 'maze.json');
const noSession = () => { throw Object.assign(new Error('no open test session'), { status: 'blocked' }); };

// A fake playtest session whose page.evaluate runs against the real live API in this process.
function createFakeSession() {
    const settings = { mapKey: 'maze', localSettings: { modePath: 'fight', sessionType: 'single' } };
    const runtimeState = {
        runtimeConfig: createRuntimeConfigSnapshot(settings),
        entityManager: { applyLiveRuntimeConfig() {}, setBotDifficulty() {} },
    };
    registerMapBalancingLiveSource(() => ({ game: { settings }, getRuntimeState: () => runtimeState, getRuntimeBundle: () => ({ state: runtimeState }) }));
    const debug = { getMapBalancingLive: () => createMapBalancingLiveApi() };
    return {
        role: 'main',
        runtimeState,
        page: {
            evaluate: async (fn, arg) => {
                globalThis.GAME_DEBUG = debug;
                try { return fn(arg); } finally { delete globalThis.GAME_DEBUG; }
            },
        },
    };
}

test('MCP balancing: file scope reads, sets and resets without a running game', async () => {
    const set = await runBalancingOperation({ args: { balancingAction: 'set', map: 'maze', field: 'itemAmount', value: '14', modePath: 'fight' }, store, getSession: noSession });
    assert.equal(set.scope, 'file');
    const row = set.description.fields.find((entry) => entry.key === 'itemAmount');
    assert.deepEqual([row.value, row.origin, row.inherited], [14, 'map', 10]);
    assert.deepEqual(JSON.parse(readFileSync(mazeFile, 'utf8')).values, { itemAmount: 14 });

    await runBalancingOperation({ args: { balancingAction: 'reset', map: 'maze', field: 'itemAmount' }, store, getSession: noSession });
    assert.equal(existsSync(mazeFile), false);

    const list = await runBalancingOperation({ args: { balancingAction: 'list_maps' }, store, getSession: noSession });
    assert.ok(list.maps.length > 40);
    await assert.rejects(runBalancingOperation({ args: { balancingAction: 'set', map: 'maze', field: 'speed', value: 99 }, store, getSession: noSession }), /speed/);
    await assert.rejects(runBalancingOperation({ args: { balancingAction: 'get' }, store, getSession: noSession }), /needs map/);
    await assert.rejects(runBalancingOperation({ args: { balancingAction: 'set', map: 'maze' }, store, getSession: noSession }), /needs field/);
    await assert.rejects(runBalancingOperation({ args: { balancingAction: 'save', scope: 'file' }, store, getSession: noSession }), /running game only/);
    await assert.rejects(runBalancingOperation({ args: { balancingAction: 'explode' }, store, getSession: noSession }), /unknown balancingAction/);
});

test('MCP balancing: live scope changes the match, save writes the layer and records interventions', async () => {
    const session = createFakeSession();
    const interventions = [];
    const options = { store, getSession: () => session, recordIntervention: (_session, entry) => interventions.push(entry.helper) };
    const live = await runBalancingOperation({ ...options, args: { balancingAction: 'set', scope: 'live', field: 'speed', value: 25 } });
    assert.equal(live.liveApplied, true);
    assert.equal(session.runtimeState.runtimeConfig.player.speed, 25);
    assert.equal(live.description.dirty, true);

    const saved = await runBalancingOperation({ ...options, args: { balancingAction: 'save' } });
    assert.equal(saved.saved.path, mazeFile);
    assert.deepEqual(JSON.parse(readFileSync(mazeFile, 'utf8')).values, { speed: 25 });
    assert.equal(saved.description.dirty, false);

    const authoritative = await runBalancingOperation({ ...options, args: { balancingAction: 'authoritative', value: 'false' } });
    assert.equal(authoritative.description.authoritative, false);
    await runBalancingOperation({ ...options, args: { balancingAction: 'discard' } });
    await runBalancingOperation({ ...options, args: { balancingAction: 'reset', scope: 'live', field: 'speed' } });
    await runBalancingOperation({ ...options, args: { balancingAction: 'get', scope: 'live' } });
    assert.deepEqual(interventions, ['balancing_set', 'balancing_save', 'balancing_authoritative', 'balancing_discard', 'balancing_reset']);
    await runBalancingOperation({ store, getSession: noSession, args: { balancingAction: 'reset', map: 'maze', field: 'speed' } });
});

test('MCP balancing: live results without the live API point at the build', async () => {
    const session = { role: 'main', page: { evaluate: async (fn, arg) => fn(arg) } };
    await assert.rejects(runBalancingOperation({ args: { balancingAction: 'get', scope: 'live' }, store, getSession: () => session }), /build:app:test/);
});

test('MCP balancing: values and the store root', () => {
    assert.deepEqual(['true', 'off', '2.5', 'abc', 7, false, ''].map(coerceBalancingValue), [true, false, 2.5, 'abc', 7, false, '']);
    assert.equal(createBalancingStoreForRepo({ repoRoot: ROOT, env: {} }).writable, true);
    assert.equal(createBalancingStoreForRepo({ repoRoot: scratch, env: {} }).reason, 'no_repository');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { createMapBalancingLiveApi, registerMapBalancingLiveSource } from '../src/core/balancing/MapBalancingLive.js';
import { isMapBalancingAuthoritative, resetMapBalancingRuntimeState } from '../src/core/balancing/MapBalancingRuntime.js';
import { installDesktopTuningRuntimeBridge } from '../src/dev/tuning/TuningRuntimeIpcBridge.js';
import { GameDebugApi } from '../src/core/GameDebugApi.js';
import { MatchSessionRuntimeBridge } from '../src/core/MatchSessionRuntimeBridge.js';

const require = createRequire(import.meta.url);
const { registerTuningIpc } = require('../electron/tuning-ipc.cjs');
const { createMapBalancingStore } = require('../electron/map-balancing-store.cjs');
const ROOT = fileURLToPath(new URL('..', import.meta.url));

function createFakeGame({ inMatch = true, mapKey = 'maze', modePath = 'fight' } = {}) {
    const liveCalls = [];
    const settings = { mapKey, numBots: 3, localSettings: { modePath, sessionType: 'single' }, gameplay: { speed: 33 } };
    const runtimeState = {
        runtimeConfig: createRuntimeConfigSnapshot(settings),
        entityManager: inMatch
            ? { applyLiveRuntimeConfig: (_erc, config) => liveCalls.push(config.player.speed), setBotDifficulty() {} }
            : null,
    };
    const facade = {
        game: { settings },
        getRuntimeState: () => runtimeState,
        getRuntimeBundle: () => ({ state: runtimeState }),
    };
    return { facade, runtimeState, liveCalls };
}

test.afterEach(() => {
    resetMapBalancingRuntimeState();
    registerMapBalancingLiveSource(null);
});

test('B4: describe shows the running map with origins; the player value stays until a live change', () => {
    const { facade, runtimeState } = createFakeGame();
    registerMapBalancingLiveSource(() => facade);
    const { value } = createMapBalancingLiveApi().describe();
    assert.equal(value.mapKey, 'maze');
    assert.equal(value.modePath, 'fight');
    assert.equal(value.inMatch, true);
    assert.equal(value.authoritative, false);
    assert.equal(value.fields.find((row) => row.key === 'speed').value, 20);
    assert.equal(runtimeState.runtimeConfig.player.speed, 33, 'switch off: the match runs with the player value');
});

test('B4: a live change applies to the running match and switches the session to map values', () => {
    const { facade, runtimeState, liveCalls } = createFakeGame();
    registerMapBalancingLiveSource(() => facade);
    const api = createMapBalancingLiveApi();
    const result = api.setValue('speed', 27);
    assert.equal(result.ok, true);
    assert.equal(result.liveApplied, true);
    assert.deepEqual(liveCalls, [27]);
    assert.equal(runtimeState.runtimeConfig.player.speed, 27);
    assert.equal(isMapBalancingAuthoritative(), true);
    const speed = result.value.fields.find((row) => row.key === 'speed');
    assert.deepEqual([speed.value, speed.origin, speed.inherited], [27, 'map', 20]);
    assert.equal(result.value.dirty, true);

    assert.equal(api.setValue('speed', 99).reason, 'invalid_value');
    assert.equal(api.setValue('speed', 99).detail.includes('speed'), true);

    const reset = api.resetValue('speed');
    assert.equal(reset.value.fields.find((row) => row.key === 'speed').origin, 'mode');
    assert.equal(runtimeState.runtimeConfig.player.speed, 20);
});

test('B4: the map values of a live change end with the match teardown', () => {
    const { facade } = createFakeGame();
    registerMapBalancingLiveSource(() => facade);
    createMapBalancingLiveApi().setValue('speed', 27);
    assert.equal(isMapBalancingAuthoritative(), true);
    new MatchSessionRuntimeBridge({ game: {}, runtimeBundle: { state: {} } }).clearMatchSessionRefs();
    assert.equal(isMapBalancingAuthoritative(), false, 'later matches run without the unsaved draft');
    const next = createRuntimeConfigSnapshot({ mapKey: 'maze', localSettings: { modePath: 'fight', sessionType: 'single' }, gameplay: { speed: 33 } });
    assert.equal(next.player.speed, 33);
});

test('B4: a live change never reaches a network match', () => {
    const { facade, runtimeState, liveCalls } = createFakeGame();
    runtimeState.runtimeConfig = { ...runtimeState.runtimeConfig, session: { ...runtimeState.runtimeConfig.session, networkEnabled: true } };
    registerMapBalancingLiveSource(() => facade);
    const api = createMapBalancingLiveApi();
    const result = api.setValue('speed', 27);
    assert.equal(result.ok, true, 'the draft is still kept for the next local match');
    assert.equal(result.liveApplied, false);
    assert.deepEqual(liveCalls, []);
    assert.equal(runtimeState.runtimeConfig.player.speed, 33, 'host and clients keep the same values');
    assert.equal(api.setAuthoritative(true).liveApplied, false);
    assert.deepEqual(liveCalls, []);
});

test('B4: saved layers survive a discard, unsaved ones do not', () => {
    const { facade, runtimeState } = createFakeGame();
    registerMapBalancingLiveSource(() => facade);
    const api = createMapBalancingLiveApi();
    api.setValue('speed', 24);
    assert.equal(api.markSaved('maze', { values: { speed: 24 } }).value.dirty, false);
    api.setValue('speed', 30);
    const discarded = api.discard();
    assert.equal(discarded.value.dirty, false);
    assert.equal(discarded.value.fields.find((row) => row.key === 'speed').value, 24);
    assert.equal(runtimeState.runtimeConfig.player.speed, 24);
    assert.equal(api.markSaved('', {}).reason, 'no_map');
});

test('B4: in the menu changes only prepare the next match', () => {
    const { facade, liveCalls } = createFakeGame({ inMatch: false, mapKey: 'standard', modePath: 'normal' });
    registerMapBalancingLiveSource(() => facade);
    const api = createMapBalancingLiveApi();
    const result = api.setValue('itemAmount', 12);
    assert.equal(result.liveApplied, false);
    assert.equal(result.value.inMatch, false);
    assert.equal(isMapBalancingAuthoritative(), false);
    assert.deepEqual(liveCalls, []);
    assert.equal(api.setAuthoritative(true).value.authoritative, true);
    assert.equal(api.setAuthoritative('reset').value.authoritative, false);
    registerMapBalancingLiveSource(null);
    assert.equal(createMapBalancingLiveApi().setValue('speed', 20).reason, 'no_map');
});

test('B4: the debug API reaches the live balancing of the running game', () => {
    const { facade } = createFakeGame();
    const debugApi = new GameDebugApi({ getRuntimeFacade: () => facade });
    assert.equal(debugApi.getMapBalancingLive().describe().value.mapKey, 'maze');
});

test('B4: the game renderer answers balancing requests of the F7 console', () => {
    const { facade } = createFakeGame();
    registerMapBalancingLiveSource(() => facade);
    let requestHandler = null;
    const responses = [];
    const dispose = installDesktopTuningRuntimeBridge({
        __CURVIOS_APP__: true,
        curviosApp: {
            isApp: true,
            contracts: {
                tuningRuntime: {
                    subscribeRequests(handler) { requestHandler = handler; return () => { requestHandler = null; }; },
                    sendResponse(response) { responses.push(response); },
                },
            },
        },
    });
    requestHandler({ requestId: 'b1', action: 'tuning:balancing', payload: { op: 'set-value', key: 'speed', value: 25 } });
    requestHandler({ requestId: 'b2', action: 'tuning:balancing', payload: { op: 'set-value', key: 'speed', value: 'x' } });
    requestHandler({ requestId: 'b3', action: 'tuning:balancing', payload: { op: 'nope' } });
    assert.equal(responses[0].ok, true);
    assert.equal(responses[0].value.liveApplied, true);
    assert.equal(responses[1].ok, false);
    assert.match(responses[1].detail, /speed/);
    assert.equal(responses[2].reason, 'unknown_balancing_op');
    for (const op of ['describe', 'reset-value', 'discard', 'mark-saved', 'set-authoritative']) {
        requestHandler({ requestId: op, action: 'tuning:balancing', payload: { op, key: 'speed', mapKey: 'maze', layer: { values: {} }, enabled: true } });
        assert.equal(responses.at(-1).ok, true, op);
    }
    dispose();
});

function createIpcHarness(answer) {
    const handlers = new Map();
    const listeners = new Map();
    const requests = [];
    const tuningWindow = { isDestroyed: () => false, webContents: { mainFrame: {} } };
    const eventFor = (windowRef) => ({ sender: windowRef.webContents, senderFrame: windowRef.webContents.mainFrame });
    const ipcMain = {
        handle: (channel, handler) => handlers.set(channel, handler),
        removeHandler: (channel) => handlers.delete(channel),
        on: (channel, listener) => listeners.set(channel, listener),
        removeListener: (channel) => listeners.delete(channel),
    };
    const gameWindow = {
        isDestroyed: () => false,
        webContents: {
            mainFrame: {},
            send(_channel, request) {
                requests.push(request.payload);
                queueMicrotask(() => listeners.get('tuning-runtime:response')(eventFor(gameWindow), {
                    requestId: request.requestId, ok: true, value: answer(request.payload),
                }));
            },
        },
    };
    return {
        ipcMain,
        requests,
        gameWindow,
        tuningWindow,
        invoke: (payload) => handlers.get('tuning:balancing')(eventFor(tuningWindow), payload),
    };
}

test('B4: "Für diese Karte übernehmen" writes the game layer through the store and marks it saved', async () => {
    const harness = createIpcHarness((payload) => (payload.op === 'describe'
        ? { mapKey: 'maze', layer: { values: { speed: 24 } }, fileLayer: { values: {} } }
        : { mapKey: 'maze', dirty: false }));
    const saved = [];
    const dispose = registerTuningIpc({
        ipcMain: harness.ipcMain,
        resolveGameWindow: () => harness.gameWindow,
        resolveTuningWindow: () => harness.tuningWindow,
        mapBalancingStore: {
            writable: true,
            saveMapLayerOnBase: async (mapKey, layer, fileLayer) => {
                saved.push([mapKey, layer, fileLayer]);
                return { path: 'data/balancing/maps/maze.json', backupPath: '', removed: false, layer };
            },
        },
    });
    const result = await harness.invoke({ op: 'save' });
    assert.equal(result.ok, true);
    assert.deepEqual(saved, [['maze', { values: { speed: 24 } }, { values: {} }]]);
    assert.deepEqual(harness.requests.map((request) => request.op), ['describe', 'mark-saved']);
    assert.deepEqual(harness.requests[1].layer, { values: { speed: 24 } });
    assert.equal(result.value.savedPath, 'data/balancing/maps/maze.json');
    assert.equal(result.value.store.writable, true);

    const forwarded = await harness.invoke({ op: 'set-value', key: 'speed', value: 22, extra: 'dropped' });
    assert.equal(forwarded.ok, true);
    assert.equal('extra' in harness.requests.at(-1), false);
    dispose();
});

test('B4: "Für diese Karte übernehmen" refuses to overwrite a map file changed outside the game', async () => {
    const scratch = mkdtempSync(path.join(tmpdir(), 'curvios-f7-save-'));
    try {
        mkdirSync(path.join(scratch, 'data/balancing/maps'), { recursive: true });
        copyFileSync(path.join(ROOT, 'data/balancing/modes.json'), path.join(scratch, 'data/balancing/modes.json'));
        const mazeFile = path.join(scratch, 'data/balancing/maps/maze.json');
        const studioText = JSON.stringify({ version: 1, mapKey: 'maze', values: { speed: 30, trailWidth: 1.2 } });
        writeFileSync(mazeFile, studioText);
        // the game was built before the Studio wrote the file, so it knows no map file
        const harness = createIpcHarness((payload) => (payload.op === 'describe'
            ? { mapKey: 'maze', layer: { values: { speed: 24 } }, fileLayer: { values: {} } }
            : { mapKey: 'maze', dirty: false }));
        const store = createMapBalancingStore({ root: ROOT, dataRoot: scratch, writable: true });
        const dispose = registerTuningIpc({
            ipcMain: harness.ipcMain,
            resolveGameWindow: () => harness.gameWindow,
            resolveTuningWindow: () => harness.tuningWindow,
            mapBalancingStore: store,
        });
        const refused = await harness.invoke({ op: 'save' });
        assert.equal(refused.ok, false);
        assert.equal(refused.reason, 'external_change');
        assert.equal(readFileSync(mazeFile, 'utf8'), studioText, 'the newer file stays untouched');
        assert.deepEqual(harness.requests.map((request) => request.op), ['describe']);
        // a game that knows the Studio state may save on top of it
        const current = createIpcHarness((payload) => (payload.op === 'describe'
            ? { mapKey: 'maze', layer: { values: { speed: 26, trailWidth: 1.2 } }, fileLayer: { values: { speed: 30, trailWidth: 1.2 } } }
            : { mapKey: 'maze', dirty: false }));
        const disposeCurrent = registerTuningIpc({
            ipcMain: current.ipcMain,
            resolveGameWindow: () => current.gameWindow,
            resolveTuningWindow: () => current.tuningWindow,
            mapBalancingStore: store,
        });
        assert.equal((await current.invoke({ op: 'save' })).ok, true);
        assert.deepEqual(JSON.parse(readFileSync(mazeFile, 'utf8')).values, { speed: 26, trailWidth: 1.2 });
        disposeCurrent();
        dispose();
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
});

test('B4: the packaged app never writes balancing files', async () => {
    const harness = createIpcHarness(() => ({ mapKey: 'maze', layer: { values: {} } }));
    const dispose = registerTuningIpc({
        ipcMain: harness.ipcMain,
        resolveGameWindow: () => harness.gameWindow,
        resolveTuningWindow: () => harness.tuningWindow,
    });
    const result = await harness.invoke({ op: 'save' });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'packaged');
    assert.deepEqual(harness.requests, []);
    dispose();
});

test('B4: tuning IPC asks Electron whether it is packaged and the preload exposes the balancing call', () => {
    const ipc = readFileSync(new URL('../electron/tuning-ipc.cjs', import.meta.url), 'utf8');
    const preload = readFileSync(new URL('../electron/tuning-preload.cjs', import.meta.url), 'utf8');
    assert.match(ipc, /isPackaged = resolveElectronIsPackaged\(\)/);
    assert.match(preload, /balancing: \(op, payload = \{\}\) => invoke\('tuning:balancing'/);
});

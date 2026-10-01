import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { test } from 'node:test';

import { mergePlayableLocalMaps } from '../src/core/config/maps/MapPresetsGenerated.js';
import { refreshLocalMapCatalog } from '../src/core/runtime/LocalMapCatalogRefresh.js';
import { refreshElectronLocalMaps } from '../src/platform/electron/ElectronPlatformBridge.js';

const require = createRequire(import.meta.url);

function desktopMap(name, extra = {}) {
    return { name, size: [80, 30, 80], obstacles: [], ...extra };
}

/**
 * Laedt das echte Preload-Skript mit einer nachgebauten Electron-Bruecke und
 * liefert, was es dem Fenster anbietet, samt Zaehler fuer den Lesekanal.
 */
function loadPreload(readMaps, { asyncSnapshot = undefined } = {}) {
    const exposed = {};
    const syncCalls = [];
    const asyncCalls = [];
    let asyncReadCount = 0;
    const electronStub = {
        contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } },
        ipcRenderer: {
            invoke: (channel) => {
                asyncCalls.push(channel);
                if (channel !== 'local-maps:read') return Promise.resolve(null);
                const response = asyncReadCount++ === 0 && asyncSnapshot !== undefined
                    ? asyncSnapshot
                    : readMaps();
                return Promise.resolve(response).then((snapshot) => (
                    snapshot && typeof snapshot === 'object' && Object.hasOwn(snapshot, 'ok')
                        ? snapshot
                        : { ok: true, maps: snapshot }
                ));
            },
            send: () => {},
            on: () => {},
            removeListener: () => {},
            sendSync: (channel) => {
                syncCalls.push(channel);
                const snapshot = readMaps();
                return channel === 'local-maps:read-sync'
                    ? (snapshot?.ok === true ? snapshot : { ok: true, maps: snapshot })
                    : null;
            },
        },
    };
    const originalLoad = Module._load;
    const preloadPath = require.resolve('../electron/preload.cjs');
    delete require.cache[preloadPath];
    Module._load = function load(request, ...rest) {
        return request === 'electron' ? electronStub : originalLoad.call(this, request, ...rest);
    };
    try {
        require(preloadPath);
    } finally {
        Module._load = originalLoad;
        delete require.cache[preloadPath];
    }
    return { localMaps: exposed.curviosApp.contracts.localMaps, syncCalls, asyncCalls };
}

test('the preload uses an asynchronous local-map snapshot before the sync fallback', async () => {
    const asyncMaps = { editor_async: desktopMap('Async') };
    const { localMaps, syncCalls } = loadPreload(
        () => ({ editor_sync: desktopMap('Sync') }),
        { asyncSnapshot: { ok: true, maps: asyncMaps } },
    );

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(localMaps.getSnapshot(), asyncMaps);
    assert.deepEqual(syncCalls, []);
});

test('a late startup snapshot cannot replace the synchronous fallback', async () => {
    const syncMaps = { editor_current: desktopMap('Current') };
    const { localMaps, syncCalls } = loadPreload(
        () => syncMaps,
        { asyncSnapshot: { ok: true, maps: { editor_stale: desktopMap('Stale') } } },
    );

    assert.deepEqual(localMaps.getSnapshot(), syncMaps);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(localMaps.getSnapshot(), syncMaps);
    assert.deepEqual(syncCalls, ['local-maps:read-sync']);
});

test('the Electron main process warms async maps before opening the window and sync reads only cache', () => {
    const source = readFileSync('electron/main.cjs', 'utf8');
    assert.match(source, /ipcMain\.handle\('local-maps:read',\s*withTrustedMainWindowSender/);
    assert.match(source, /ipcMain\.on\('local-maps:read-sync'/);
    const startup = source.slice(source.indexOf('async function startDesktopShell()'), source.indexOf('const discoveryRateMap'));
    assert.ok(startup.indexOf('await refreshAndCacheLocalMaps()') < startup.indexOf('await desktopWindowShellCapability.start()'));
    const syncHandler = source.slice(source.indexOf("ipcMain.on('local-maps:read-sync'"), source.indexOf('// Ein Kanal fuer alle Dateizugriffe'));
    assert.match(syncHandler, /event\.returnValue = cachedLocalMapsSnapshot/);
    assert.doesNotMatch(syncHandler, /readRuntimeMaps/);
    assert.match(source, /'save-map': async \(payload\) => \{\s*const result = await editorMapStore\.saveMap\(payload\);\s*if \(result\?\.ok === true\) \{\s*try \{\s*await refreshAndCacheLocalMaps\(\)/);
    assert.match(source, /if \(snapshot\?\.ok === true[\s\S]*?cachedLocalMapsSnapshot = snapshot/);
});

test('the preload re-reads maps asynchronously and retains the last good snapshot on failure', async () => {
    let stored = { editor_a: desktopMap('A') };
    const { localMaps, syncCalls, asyncCalls } = loadPreload(() => stored);

    assert.deepEqual(Object.keys(localMaps.getSnapshot()), ['editor_a']);
    stored = { editor_a: desktopMap('A'), editor_b: desktopMap('B') };
    // Ohne Auffrischen bleibt es beim Stand vom Start.
    assert.deepEqual(Object.keys(localMaps.getSnapshot()), ['editor_a']);

    assert.deepEqual(Object.keys(await localMaps.refresh()).sort(), ['editor_a', 'editor_b']);
    assert.deepEqual(Object.keys(localMaps.getSnapshot()).sort(), ['editor_a', 'editor_b']);
    stored = { ok: false, error: 'total_payload_too_large', maps: {} };
    assert.equal(await localMaps.refresh(), null);
    assert.deepEqual(Object.keys(localMaps.getSnapshot()).sort(), ['editor_a', 'editor_b']);
    assert.deepEqual(syncCalls, ['local-maps:read-sync']);
    assert.deepEqual(asyncCalls.filter((channel) => channel === 'local-maps:read'), [
        'local-maps:read', 'local-maps:read', 'local-maps:read',
    ]);
});

test('an older concurrent map refresh cannot replace the newer snapshot', async () => {
    let resolveOlder;
    let resolveNewer;
    const olderRead = new Promise((resolve) => { resolveOlder = resolve; });
    const newerRead = new Promise((resolve) => { resolveNewer = resolve; });
    const reads = [olderRead, newerRead];
    const initialMaps = { editor_initial: desktopMap('Initial') };
    const newerMaps = { editor_newer: desktopMap('Newer') };
    const { localMaps } = loadPreload(() => reads.shift(), {
        asyncSnapshot: { ok: true, maps: initialMaps },
    });
    await new Promise((resolve) => setImmediate(resolve));

    const olderRefresh = localMaps.refresh();
    const newerRefresh = localMaps.refresh();
    resolveNewer({ ok: true, maps: newerMaps });
    assert.deepEqual(await newerRefresh, newerMaps);
    resolveOlder({ ok: true, maps: { editor_stale: desktopMap('Stale') } });
    assert.equal(await olderRefresh, null);
    assert.deepEqual(localMaps.getSnapshot(), newerMaps);
});

test('the platform bridge refreshes only inside the desktop shell', async () => {
    assert.equal(await refreshElectronLocalMaps({}), null);

    const fresh = { editor_new: desktopMap('Neu') };
    const runtimeGlobal = {
        curviosApp: { contracts: { localMaps: { getSnapshot: () => ({}), refresh: () => fresh } } },
    };
    assert.deepEqual(await refreshElectronLocalMaps(runtimeGlobal), fresh);
});

test('merging saved maps grows the catalog in place and never replaces a built-in map', () => {
    const standard = desktopMap('Standard');
    const catalog = { standard, editor_old: desktopMap('Alt') };

    const changed = mergePlayableLocalMaps(catalog, {
        standard: desktopMap('Kapert die Standardkarte'),
        editor_old: desktopMap('Alt'),
        editor_new: desktopMap('Neu'),
        editor_broken: { name: 'Ohne Groesse' },
    });

    assert.deepEqual(changed, ['editor_new']);
    assert.equal(catalog.standard, standard);
    assert.deepEqual(Object.keys(catalog), ['standard', 'editor_old', 'editor_new']);
});

test('a map saved again under the same key replaces the older state', () => {
    const catalog = { editor_arena: desktopMap('Arena', { size: [80, 30, 80] }) };
    const changed = mergePlayableLocalMaps(catalog, { editor_arena: desktopMap('Arena', { size: [120, 30, 120] }) });
    assert.deepEqual(changed, ['editor_arena']);
    assert.deepEqual(catalog.editor_arena.size, [120, 30, 120]);
});

test('a user map deleted from the folder leaves the catalog, other maps stay', () => {
    const standard = desktopMap('Standard');
    const fromSourceTree = desktopMap('Quellbaum');
    const catalog = {
        standard,
        editor_source: fromSourceTree,
        editor_kept: desktopMap('Bleibt'),
        editor_gone: desktopMap('Geloescht'),
    };
    const knownKeys = new Set(['editor_kept', 'editor_gone']);

    const changed = mergePlayableLocalMaps(catalog, { editor_kept: desktopMap('Bleibt') }, {
        knownKeys,
        fallbackMaps: { editor_source: fromSourceTree },
    });

    assert.deepEqual(changed, ['editor_gone']);
    assert.deepEqual(Object.keys(catalog), ['standard', 'editor_source', 'editor_kept']);
    assert.deepEqual([...knownKeys], ['editor_kept']);
});

test('deleting a user map that shadowed a source-tree map restores the source-tree version', () => {
    const fromSourceTree = desktopMap('Quellbaum');
    const catalog = { editor_arena: desktopMap('Nutzerstand') };
    const knownKeys = new Set(['editor_arena']);

    const changed = mergePlayableLocalMaps(catalog, {}, {
        knownKeys,
        fallbackMaps: { editor_arena: fromSourceTree },
    });

    assert.deepEqual(changed, ['editor_arena']);
    assert.equal(catalog.editor_arena, fromSourceTree);
    assert.equal(knownKeys.size, 0);
});

test('newly merged user maps are remembered so a later deletion is noticed', () => {
    const catalog = {};
    const knownKeys = new Set();
    mergePlayableLocalMaps(catalog, { editor_new: desktopMap('Neu') }, { knownKeys });
    assert.deepEqual([...knownKeys], ['editor_new']);
    assert.deepEqual(mergePlayableLocalMaps(catalog, {}, { knownKeys }), ['editor_new']);
    assert.deepEqual(Object.keys(catalog), []);
});

function createRefreshHarness({ gameState = 'MENU', localMaps = {} } = {}) {
    const calls = [];
    const catalog = { standard: desktopMap('Standard') };
    const knownKeys = new Set();
    let currentState = gameState;
    const run = () => refreshLocalMapCatalog({
        gameState,
        getGameState: () => currentState,
        catalog,
        knownKeys,
        fallbackMaps: {},
        readLocalMaps: async () => { calls.push('read'); return localMaps; },
        refreshRuntimeConfig: () => { calls.push('refresh-config'); },
        applySettings: () => { calls.push('apply-settings'); },
    });
    return { run, calls, catalog, knownKeys, setGameState: (state) => { currentState = state; } };
}

test('a deleted user map refreshes the runtime config just like a new one', async () => {
    const harness = createRefreshHarness({ localMaps: {} });
    harness.catalog.editor_gone = desktopMap('Geloescht');
    harness.knownKeys.add('editor_gone');
    assert.equal(await harness.run(), true);
    assert.deepEqual(harness.calls, ['read', 'refresh-config', 'apply-settings']);
    assert.equal(harness.catalog.editor_gone, undefined);
});

test('a new saved map refreshes the runtime config and re-applies the settings', async () => {
    const harness = createRefreshHarness({ localMaps: { editor_live: desktopMap('Live') } });
    assert.equal(await harness.run(), true);
    assert.deepEqual(harness.calls, ['read', 'refresh-config', 'apply-settings']);
    assert.ok(harness.catalog.editor_live);
});

test('an unchanged user folder leaves the runtime untouched', async () => {
    const harness = createRefreshHarness({ localMaps: {} });
    assert.equal(await harness.run(), false);
    assert.deepEqual(harness.calls, ['read']);
});

test('no refresh runs while a match is on', async () => {
    const harness = createRefreshHarness({ gameState: 'PLAYING', localMaps: { editor_live: desktopMap('Live') } });
    assert.equal(await harness.run(), false);
    assert.deepEqual(harness.calls, []);
    assert.equal(harness.catalog.editor_live, undefined);
});

test('outside the desktop shell nothing is read or applied', async () => {
    const calls = [];
    const result = await refreshLocalMapCatalog({
        gameState: 'MENU',
        catalog: {},
        knownKeys: new Set(['editor_x']),
        readLocalMaps: () => null,
        refreshRuntimeConfig: () => calls.push('refresh-config'),
        applySettings: () => calls.push('apply-settings'),
    });
    assert.equal(result, false);
    assert.deepEqual(calls, []);
});

test('a menu refresh finishing after gameplay begins does not mutate the live catalog', async () => {
    let resolveMaps;
    let currentState = 'MENU';
    const catalog = {};
    const applied = [];
    const refresh = refreshLocalMapCatalog({
        gameState: 'MENU',
        getGameState: () => currentState,
        catalog,
        knownKeys: new Set(),
        fallbackMaps: {},
        readLocalMaps: () => new Promise((resolve) => { resolveMaps = resolve; }),
        refreshRuntimeConfig: () => applied.push('config'),
        applySettings: () => applied.push('settings'),
    });
    currentState = 'PLAYING';
    resolveMaps({ editor_late: desktopMap('Late') });
    assert.equal(await refresh, false);
    assert.deepEqual(catalog, {});
    assert.deepEqual(applied, []);
});

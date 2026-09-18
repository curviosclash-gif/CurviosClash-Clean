import assert from 'node:assert/strict';
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
function loadPreload(readMaps) {
    const exposed = {};
    const syncCalls = [];
    const electronStub = {
        contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } },
        ipcRenderer: {
            invoke: () => Promise.resolve(null),
            send: () => {},
            on: () => {},
            removeListener: () => {},
            sendSync: (channel) => {
                syncCalls.push(channel);
                return channel === 'local-maps:read-sync' ? { ok: true, maps: readMaps() } : null;
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
    return { localMaps: exposed.curviosApp.contracts.localMaps, syncCalls };
}

test('the preload re-reads the saved maps on refresh over the existing sync channel', () => {
    let stored = { editor_a: desktopMap('A') };
    const { localMaps, syncCalls } = loadPreload(() => stored);

    assert.deepEqual(Object.keys(localMaps.getSnapshot()), ['editor_a']);
    stored = { editor_a: desktopMap('A'), editor_b: desktopMap('B') };
    // Ohne Auffrischen bleibt es beim Stand vom Start.
    assert.deepEqual(Object.keys(localMaps.getSnapshot()), ['editor_a']);

    assert.deepEqual(Object.keys(localMaps.refresh()).sort(), ['editor_a', 'editor_b']);
    assert.deepEqual(Object.keys(localMaps.getSnapshot()).sort(), ['editor_a', 'editor_b']);
    assert.deepEqual(syncCalls, ['local-maps:read-sync', 'local-maps:read-sync']);
});

test('the platform bridge refreshes only inside the desktop shell', () => {
    assert.equal(refreshElectronLocalMaps({}), null);

    const fresh = { editor_new: desktopMap('Neu') };
    const runtimeGlobal = {
        curviosApp: { contracts: { localMaps: { getSnapshot: () => ({}), refresh: () => fresh } } },
    };
    assert.deepEqual(refreshElectronLocalMaps(runtimeGlobal), fresh);
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

function createRefreshHarness({ gameState = 'MENU', localMaps = {} } = {}) {
    const calls = [];
    const catalog = { standard: desktopMap('Standard') };
    const run = () => refreshLocalMapCatalog({
        gameState,
        catalog,
        readLocalMaps: () => { calls.push('read'); return localMaps; },
        refreshRuntimeConfig: () => { calls.push('refresh-config'); },
        applySettings: () => { calls.push('apply-settings'); },
    });
    return { run, calls, catalog };
}

test('a new saved map refreshes the runtime config and re-applies the settings', () => {
    const harness = createRefreshHarness({ localMaps: { editor_live: desktopMap('Live') } });
    assert.equal(harness.run(), true);
    assert.deepEqual(harness.calls, ['read', 'refresh-config', 'apply-settings']);
    assert.ok(harness.catalog.editor_live);
});

test('an unchanged user folder leaves the runtime untouched', () => {
    const harness = createRefreshHarness({ localMaps: {} });
    assert.equal(harness.run(), false);
    assert.deepEqual(harness.calls, ['read']);
});

test('no refresh runs while a match is on', () => {
    const harness = createRefreshHarness({ gameState: 'PLAYING', localMaps: { editor_live: desktopMap('Live') } });
    assert.equal(harness.run(), false);
    assert.deepEqual(harness.calls, []);
    assert.equal(harness.catalog.editor_live, undefined);
});

test('outside the desktop shell nothing is read or applied', () => {
    const calls = [];
    const result = refreshLocalMapCatalog({
        gameState: 'MENU',
        catalog: {},
        readLocalMaps: () => null,
        refreshRuntimeConfig: () => calls.push('refresh-config'),
        applySettings: () => calls.push('apply-settings'),
    });
    assert.equal(result, false);
    assert.deepEqual(calls, []);
});

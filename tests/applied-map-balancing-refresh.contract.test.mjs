import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';

import { APPLIED_MAP_BALANCING_FIELDS } from '../src/shared/contracts/AppliedMapBalancingContract.js';
import { getAppliedMapBalancing, setLocalAppliedMapBalancing } from '../src/shared/maps/MapBalancingBundledData.js';
import { refreshAppliedMapBalancing, refreshDesktopMenuSources } from '../src/core/balancing/AppliedMapBalancingRefresh.js';
import { refreshElectronAppliedMapBalancing } from '../src/platform/electron/ElectronPlatformBridge.js';
import { GAME_STATE_IDS } from '../src/shared/contracts/GameStateIds.js';

// B5: approving or withdrawing map values in the Settings Studio reaches the running game
// the next time the map choice opens, not only after a restart.
const require = createRequire(import.meta.url);
const modes = JSON.parse(readFileSync(new URL('../data/balancing/modes.json', import.meta.url), 'utf8'));
const target = { mapKey: 'maze', modePath: 'fight' };
const approval = (speed) => ({
    version: 1,
    entries: [{ ...target, enabled: true, values: Object.fromEntries(APPLIED_MAP_BALANCING_FIELDS.map(({ key }) => [key, key === 'speed' ? speed : modes.modes.fight.values[key]])) }],
});

test.afterEach(() => setLocalAppliedMapBalancing(null));

function loadPreload(readOverride) {
    const exposed = {};
    const channels = [];
    const electronStub = {
        contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } },
        ipcRenderer: {
            invoke: (channel) => { channels.push(channel); return Promise.resolve(channel === 'settings-defaults:read-override' ? readOverride() : null); },
            send() {}, on() {}, removeListener() {},
            sendSync: () => null,
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
    return { settingsDefaults: exposed.curviosApp.contracts.settingsDefaults, channels };
}

test('B5: the preload rereads the approvals over the existing defaults channel', async () => {
    let speed = 24;
    const { settingsDefaults, channels } = loadPreload(() => ({ draft: null, appliedMapBalancing: { exists: true, document: approval(speed), error: null } }));
    await new Promise((resolve) => setImmediate(resolve));
    const startup = settingsDefaults.getOverrideSnapshot();
    speed = 28;
    const fresh = await settingsDefaults.refreshAppliedMapBalancing();
    assert.equal(fresh.document.entries[0].values.speed, 28);
    assert.equal(settingsDefaults.getOverrideSnapshot().appliedMapBalancing.document.entries[0].values.speed, startup.appliedMapBalancing.document.entries[0].values.speed,
        'the startup defaults snapshot stays as it was');
    const knownChannels = new Set(['settings-defaults:read-override', 'local-maps:read']);
    assert.deepEqual(channels.filter((channel) => !knownChannels.has(channel)), [], 'no new IPC channel');
    const runtimeGlobal = { curviosApp: { contracts: { settingsDefaults } } };
    assert.equal((await refreshElectronAppliedMapBalancing(runtimeGlobal)).document.entries[0].values.speed, 28);
    assert.equal(await refreshElectronAppliedMapBalancing({}), null, 'outside the desktop there is nothing to reread');
});

test('B5: in the menu a new approval or a withdrawal takes effect without a restart', async () => {
    setLocalAppliedMapBalancing(approval(24));
    let applied = 0;
    const read = (snapshot) => async () => snapshot;
    const menu = { gameState: GAME_STATE_IDS.MENU, getGameState: () => GAME_STATE_IDS.MENU, applySettings: () => { applied += 1; } };
    assert.equal(await refreshAppliedMapBalancing({ ...menu, readApplied: read({ exists: true, document: approval(28), error: null }) }), true);
    assert.equal(getAppliedMapBalancing(target).values.speed, 28);
    assert.equal(applied, 1, 'the menu runtime config is rebuilt with the new values');
    assert.equal(await refreshAppliedMapBalancing({ ...menu, readApplied: read({ exists: true, document: approval(28), error: null }) }), false, 'unchanged: nothing to rebuild');
    assert.equal(applied, 1);
    assert.equal(await refreshAppliedMapBalancing({ ...menu, readApplied: read({ exists: false, document: null, error: null }) }), true);
    assert.equal(getAppliedMapBalancing(target), null, 'a withdrawn approval no longer applies');
});

test('B5: a running match and an unreadable file keep the current approvals', async () => {
    setLocalAppliedMapBalancing(approval(24));
    const fresh = async () => ({ exists: true, document: approval(28), error: null });
    assert.equal(await refreshAppliedMapBalancing({ gameState: GAME_STATE_IDS.PLAYING, readApplied: fresh }), false);
    let state = GAME_STATE_IDS.MENU;
    const slow = async () => { state = GAME_STATE_IDS.PLAYING; return { exists: true, document: approval(28), error: null }; };
    assert.equal(await refreshAppliedMapBalancing({ gameState: state, getGameState: () => state, readApplied: slow }), false, 'a match that started meanwhile keeps its values');
    const broken = async () => ({ exists: true, document: null, error: 'Unexpected token' });
    assert.equal(await refreshAppliedMapBalancing({ gameState: GAME_STATE_IDS.MENU, readApplied: broken }), false);
    assert.equal(await refreshAppliedMapBalancing({ gameState: GAME_STATE_IDS.MENU, readApplied: async () => null }), false);
    assert.equal(getAppliedMapBalancing(target).values.speed, 24);
});

test('B5: opening the map choice rereads maps and approvals and rebuilds the menu config once', async () => {
    let rebuilds = 0;
    const rebuild = () => { rebuilds += 1; };
    assert.equal(await refreshDesktopMenuSources([async () => false, async () => true], rebuild), true, 'an approval change alone counts as a change');
    assert.equal(await refreshDesktopMenuSources([async () => true, async () => true], rebuild), true);
    assert.equal(rebuilds, 2, 'one rebuild per reread, even when maps and approvals both changed');
    assert.equal(await refreshDesktopMenuSources([async () => false, async () => false], rebuild), false);
    assert.equal(rebuilds, 2);
    const coordinator = readFileSync(new URL('../src/core/runtime/GameRuntimeCoordinator.js', import.meta.url), 'utf8');
    assert.match(coordinator, /refreshDesktopMenuSources\(\s*\[\(\) => refreshDesktopLocalMaps\(options\), \(\) => refreshAppliedMapBalancing\(options\)\]/);
});

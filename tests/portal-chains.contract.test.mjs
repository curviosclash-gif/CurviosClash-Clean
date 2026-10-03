import test from 'node:test';
import assert from 'node:assert/strict';

import { FIVE_PORTALS_MAPS, FIVE_PORTALS_RECORD_KEY, FIVE_PORTALS_RECORD_VERSION } from '../src/shared/contracts/FivePortalsContract.js';
import {
    DEFAULT_PORTAL_CHAIN_ID,
    PORTAL_CHAINS,
    normalizePortalChainId,
    resolvePortalChain,
} from '../src/shared/contracts/PortalChainContract.js';
import { normalizeArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { FivePortalsRuntime } from '../src/core/arcade/FivePortalsRuntime.js';
import { bindArcadeSpecialStartButtons } from '../src/ui/arcade/ArcadeMenuSpecialStartOps.js';

const SKY_LADDER_MAP_KEYS = ['sky_ladder_abyss', 'sky_ladder_foundry', 'sky_ladder_storm', 'sky_ladder_star'];

test('the chain table lists Fünf Portale and Himmelsleiter with their own maps and record keys', () => {
    assert.equal(DEFAULT_PORTAL_CHAIN_ID, 'five_portals');
    assert.deepEqual(PORTAL_CHAINS.five_portals.maps, FIVE_PORTALS_MAPS);
    assert.equal(PORTAL_CHAINS.five_portals.label, 'Fünf Portale');
    assert.equal(PORTAL_CHAINS.five_portals.recordKey, FIVE_PORTALS_RECORD_KEY);
    assert.equal(PORTAL_CHAINS.five_portals.recordVersion, FIVE_PORTALS_RECORD_VERSION);

    assert.deepEqual(PORTAL_CHAINS.sky_ladder.maps, SKY_LADDER_MAP_KEYS);
    assert.equal(PORTAL_CHAINS.sky_ladder.label, 'Himmelsleiter');
    assert.notEqual(PORTAL_CHAINS.sky_ladder.recordKey, FIVE_PORTALS_RECORD_KEY);
    assert.notEqual(PORTAL_CHAINS.sky_ladder.recordVersion, FIVE_PORTALS_RECORD_VERSION);
});

test('normalizePortalChainId falls back to five_portals for missing or unknown ids, keeps known ones', () => {
    assert.equal(normalizePortalChainId(undefined), 'five_portals');
    assert.equal(normalizePortalChainId(''), 'five_portals');
    assert.equal(normalizePortalChainId('not_a_chain'), 'five_portals');
    assert.equal(normalizePortalChainId('sky_ladder'), 'sky_ladder');
    assert.equal(normalizePortalChainId('SKY_LADDER'), 'sky_ladder');
    assert.equal(resolvePortalChain('sky_ladder').id, 'sky_ladder');
    assert.equal(resolvePortalChain('bogus').id, 'five_portals');
});

test('ArcadeRunSettingsContract normalizes portalChainId with the same fallback rule', () => {
    assert.equal(normalizeArcadeRunSettings({}).portalChainId, 'five_portals');
    assert.equal(normalizeArcadeRunSettings({ portalChainId: 'nonsense' }).portalChainId, 'five_portals');
    assert.equal(normalizeArcadeRunSettings({ runType: 'five_portals', portalChainId: 'sky_ladder' }).portalChainId, 'sky_ladder');
});

test('Fünf Portale keeps its exact five-map route, record key and runType when run through FivePortalsRuntime', () => {
    const store = { loadJsonRecord() { return null; }, saveJsonRecord() {} };
    const runtime = new FivePortalsRuntime({ getRecordStore: () => store });
    const state = runtime.start(null);
    assert.equal(state.runType, 'five_portals');
    assert.equal(state.mapCount, 5);
    assert.equal(state.currentMapKey, FIVE_PORTALS_MAPS[0]);
});

test('Himmelsleiter runs the same runType through its own four-map chain and its own record key', () => {
    const saves = [];
    const store = { loadJsonRecord() { return null; }, saveJsonRecord(key, value) { saves.push({ key, value }); } };
    let clock = 1000;
    const manager = {
        _simulationClockMs: clock,
        _parcoursProgressSystem: { getPlayerProgressSnapshot: () => ({ startedAtMs: 1000, penaltyTimeMs: 0, nextCheckpointIndex: 1, totalCheckpoints: 2, checkpointRespawnsUsed: 0 }) },
        arena: { _portalGateSystem: { portalRuntime: { activateExitPortals() {}, deactivateExitPortals() {} } } },
    };
    const transitions = [];
    const runtime = new FivePortalsRuntime({
        getRecordStore: () => store,
        requestMapTransition: (transition) => transitions.push(transition),
        requestAdvance: () => {},
    });
    const started = runtime.start(manager, { vehicleId: 'ship1', chainId: 'sky_ladder' });
    assert.equal(started.runType, 'five_portals', 'the runType stays five_portals for every chain');
    assert.equal(started.mapCount, 4);
    assert.equal(started.currentMapKey, SKY_LADDER_MAP_KEYS[0]);

    for (let index = 0; index < 4; index += 1) {
        manager._simulationClockMs = clock + (index + 1) * 1000;
        runtime.handleParcoursEvent({ type: 'finish', playerIndex: 0, totalTimeMs: (index + 1) * 1000 });
        runtime.handleGameplayEvent({ type: 'exit_portal', playerIndex: 0 });
        if (index < 3) {
            assert.equal(transitions[index].mapKey, SKY_LADDER_MAP_KEYS[index + 1], `after map ${index} the next requested map is the chain's own map`);
            runtime.start(manager, { vehicleId: 'ship1', chainId: 'sky_ladder' });
        }
    }

    const finished = runtime.getHudState();
    assert.equal(finished.phase, 'finished');
    assert.equal(finished.mapCount, 4);
    assert.equal(saves.length, 1);
    assert.equal(saves[0].key, 'curviosclash.sky-ladder-records.v1', 'Himmelsleiter records go under their own key, never the Fünf-Portale key');
    assert.equal(saves[0].value.version, 'sky-ladder-records.v1');
});

test('running Himmelsleiter never touches the Fünf-Portale record key', () => {
    const seenKeys = [];
    const store = {
        loadJsonRecord(key) { seenKeys.push(key); return null; },
        saveJsonRecord(key) { seenKeys.push(key); },
    };
    const manager = {
        _simulationClockMs: 0,
        _parcoursProgressSystem: { getPlayerProgressSnapshot: () => ({ startedAtMs: 0, penaltyTimeMs: 0, nextCheckpointIndex: 0, totalCheckpoints: 1, checkpointRespawnsUsed: 0 }) },
        arena: { _portalGateSystem: { portalRuntime: { activateExitPortals() {}, deactivateExitPortals() {} } } },
    };
    const runtime = new FivePortalsRuntime({ getRecordStore: () => store, requestMapTransition: () => {}, requestAdvance: () => {} });
    seenKeys.length = 0; // constructing without a chosen chain defaults to five_portals; only what start() touches matters here
    runtime.start(manager, { chainId: 'sky_ladder' });
    assert.ok(seenKeys.every((key) => key !== FIVE_PORTALS_RECORD_KEY), 'sky_ladder must never read or write the five_portals record key');
});

test('the registered Himmelsleiter start button launches its first chain map', () => {
    const button = {};
    const listeners = new Map();
    let started = null;
    bindArcadeSpecialStartButtons(
        { startSkyLadderButton: button },
        (node, type, listener) => { if (node === button && type === 'click') listeners.set(node, listener); },
        (...args) => { started = args; },
        0,
        { hasUnsupportedPlayerCount: () => false, save: () => [], hasMissingActiveProfile: () => false },
        {},
    );

    assert.ok(listeners.has(button), 'the Himmelsleiter button receives its click handler');
    listeners.get(button)();
    assert.deepEqual(started, [
        'five_portals',
        { mapKey: SKY_LADDER_MAP_KEYS[0], numBots: 0 },
        'sky_ladder',
    ]);
});

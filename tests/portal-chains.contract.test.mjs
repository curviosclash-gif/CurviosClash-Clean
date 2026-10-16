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
import { CONFIG } from '../src/core/Config.js';
import { FivePortalsRuntime } from '../src/core/arcade/FivePortalsRuntime.js';
import { resolveArcadeRankKey } from '../src/shared/contracts/ArcadeRankedLeaderboardContract.js';
import { bindArcadeSpecialStartButtons } from '../src/ui/arcade/ArcadeMenuSpecialStartOps.js';
import { compileArenaCollision } from './helpers/parcours-race-line.mjs';

const SKY_LADDER_MAP_KEYS = ['sky_ladder_abyss', 'sky_ladder_foundry', 'sky_ladder_storm', 'sky_ladder_star'];
const K19_MAP_KEYS = ['aether_relay', 'neon_circuit', 'frozen_helix', 'sky_islands', 'chrono_spillway'];
const K19_CHAIN_ID = 'portal_chain_k19';

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

test('K19 registers its exact five maps and uses a separate local record and ranked board', () => {
    const chain = PORTAL_CHAINS[K19_CHAIN_ID];
    assert.ok(chain, 'the approved K19 chain has a descriptor');
    assert.deepEqual(chain.maps, K19_MAP_KEYS);
    assert.equal(chain.id, K19_CHAIN_ID);
    assert.notEqual(chain.recordKey, FIVE_PORTALS_RECORD_KEY);
    assert.notEqual(chain.recordVersion, FIVE_PORTALS_RECORD_VERSION);
    assert.equal(resolvePortalChain('unknown-k19-chain').id, 'five_portals', 'unknown IDs retain the legacy fallback');
    assert.equal(normalizeArcadeRunSettings({ runType: 'five_portals', portalChainId: K19_CHAIN_ID }).portalChainId, K19_CHAIN_ID);

    const rankedKey = resolveArcadeRankKey({
        ranked: true, runType: 'five_portals', portalChainId: K19_CHAIN_ID,
        tierId: 'any', vehicleLevel: 1,
    });
    assert.ok(rankedKey.includes(`${K19_CHAIN_ID}:`), 'K19 ranked times use the chain-specific board');
    assert.equal(rankedKey, `five_portals:${K19_CHAIN_ID}:any:1-5`);
    assert.equal(resolveArcadeRankKey({
        ranked: true, runType: 'five_portals', portalChainId: 'five_portals',
        tierId: 'any', vehicleLevel: 1,
    }), 'five_portals:any:1-5', 'the existing Fünf-Portale board key is unchanged');
});

test('K19 maps have an authored, in-bounds exit reachable from the last finish ring', () => {
    for (const mapKey of K19_MAP_KEYS) {
        const map = CONFIG.MAPS[mapKey];
        assert.ok(map, `${mapKey} is registered`);
        assert.equal(map.parcours?.enabled, true, `${mapKey} retains its parcours`);
        const exit = map.fivePortalsExit?.pos;
        assert.ok(Array.isArray(exit), `${mapKey} has an authored Five-Portals exit`);

        const scale = map.scaleAuthoredAnchors ? CONFIG.ARENA.MAP_SCALE : 1;
        const [width, height, depth] = map.size.map((value) => value * scale);
        const worldExit = exit.map((value) => value * scale);
        const finish = map.parcours.finish.pos.map((value) => value * scale);
        assert.ok(Math.abs(worldExit[0]) <= width / 2 - 4, `${mapKey} exit stays inside the X hull bounds`);
        assert.ok(worldExit[1] >= 4 && worldExit[1] <= height - 4, `${mapKey} exit stays inside the vertical hull bounds`);
        assert.ok(Math.abs(worldExit[2]) <= depth / 2 - 4, `${mapKey} exit stays inside the Z hull bounds`);

        const collision = compileArenaCollision(map, scale);
        const departure = [...finish];
        if (collision.checkCollisionFast({ x: departure[0], y: departure[1], z: departure[2] }, 1.2)) departure[1] += 4;
        assert.equal(collision.checkCollisionFast({ x: departure[0], y: departure[1], z: departure[2] }, 1.2), false,
            `${mapKey} allows the hull to lift clear of its finish ring`);
        const distance = Math.hypot(...worldExit.map((value, axis) => value - departure[axis]));
        assert.ok(distance >= 10 && distance <= 36, `${mapKey} exit is distinct from but reachable after its finish ring (${distance.toFixed(1)} world units)`);
        for (let step = 1, steps = Math.ceil(distance / 1.5); step < steps; step += 1) {
            const amount = step / steps;
            const sample = departure.map((value, axis) => value + (worldExit[axis] - value) * amount);
            assert.equal(collision.checkCollisionFast({ x: sample[0], y: sample[1], z: sample[2] }, 1.2), false,
                `${mapKey} finish→exit hull path remains clear at ${sample.map((value) => value.toFixed(1)).join(', ')}`);
        }
    }
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
    const journeyResults = [];
    runtime._onJourneyCompleted = result => journeyResults.push(result);
    const started = runtime.start(manager, { vehicleId: 'ship1', chainId: 'sky_ladder' });
    assert.equal(started.runType, 'five_portals', 'the runType stays five_portals for every chain');
    assert.equal(started.mapCount, 4);
    assert.equal(started.currentMapKey, SKY_LADDER_MAP_KEYS[0]);

    for (let index = 0; index < 4; index += 1) {
        manager._simulationClockMs = clock + (index + 1) * 1000;
        runtime.handleParcoursEvent({ type: 'finish', playerIndex: 0, totalTimeMs: (index + 1) * 1000 });
        runtime.handleGameplayEvent({ type: 'exit_portal', playerIndex: 0 });
        assert.equal(journeyResults.length, index === 3 ? 1 : 0, 'only the final exit settles the journey');
        if (index < 3) {
            assert.equal(transitions[index].mapKey, SKY_LADDER_MAP_KEYS[index + 1], `after map ${index} the next requested map is the chain's own map`);
            runtime.start(manager, { vehicleId: 'ship1', chainId: 'sky_ladder' });
        }
    }

    const finished = runtime.getHudState();
    assert.equal(finished.phase, 'finished');
    assert.equal(finished.mapCount, 4);
    assert.deepEqual(journeyResults, [{ succeeded: true, value: 10000 }]);
    runtime.handleGameplayEvent({ type: 'exit_portal', playerIndex: 0 });
    assert.equal(journeyResults.length, 1, 'a repeated portal event cannot award twice');
    assert.equal(saves.length, 1);
    assert.equal(saves[0].key, 'curviosclash.sky-ladder-records.v1', 'Himmelsleiter records go under their own key, never the Fünf-Portale key');
    assert.equal(saves[0].value.version, 'sky-ladder-records.v1');
});

test('K19 transitions through all five maps and writes only its own local record key', () => {
    const reads = [];
    const saves = [];
    const store = {
        loadJsonRecord(key) { reads.push(key); return null; },
        saveJsonRecord(key, value) { saves.push({ key, value }); return true; },
    };
    const transitions = [];
    const manager = {
        _simulationClockMs: 0,
        _parcoursProgressSystem: { getPlayerProgressSnapshot: () => ({ startedAtMs: 0, penaltyTimeMs: 0, nextCheckpointIndex: 1, totalCheckpoints: 2, checkpointRespawnsUsed: 0 }) },
        arena: { _portalGateSystem: { portalRuntime: { activateExitPortals() {}, deactivateExitPortals() {} } } },
    };
    const runtime = new FivePortalsRuntime({
        getRecordStore: () => store,
        requestMapTransition: (transition) => transitions.push(transition),
        requestAdvance: () => {},
    });
    reads.length = 0;
    runtime.start(manager, { chainId: K19_CHAIN_ID });
    for (let index = 0; index < K19_MAP_KEYS.length; index += 1) {
        assert.equal(runtime.getHudState().currentMapKey, K19_MAP_KEYS[index]);
        runtime.handleParcoursEvent({ type: 'finish', playerIndex: 0, totalTimeMs: (index + 1) * 1000 });
        runtime.handleGameplayEvent({ type: 'exit_portal', playerIndex: 0 });
        if (index < K19_MAP_KEYS.length - 1) {
            assert.equal(transitions[index].mapKey, K19_MAP_KEYS[index + 1]);
            runtime.start(manager, { chainId: K19_CHAIN_ID });
        }
    }
    assert.equal(runtime.phase, 'finished');
    assert.deepEqual(runtime.getHudState().postRunSummary.maps.map(({ mapKey }) => mapKey), K19_MAP_KEYS);
    assert.deepEqual(reads, [PORTAL_CHAINS[K19_CHAIN_ID].recordKey]);
    assert.deepEqual(saves.map(({ key }) => key), [PORTAL_CHAINS[K19_CHAIN_ID].recordKey]);
    assert.equal(saves[0].value.version, PORTAL_CHAINS[K19_CHAIN_ID].recordVersion);
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

test('the registered K19 start button launches the first approved chain map', () => {
    const button = {};
    const listeners = new Map();
    let started = null;
    bindArcadeSpecialStartButtons(
        { startK19PortalChainButton: button },
        (node, type, listener) => { if (node === button && type === 'click') listeners.set(node, listener); },
        (...args) => { started = args; },
        0,
        { hasUnsupportedPlayerCount: () => false, save: () => [], hasMissingActiveProfile: () => false },
        {},
    );
    assert.ok(listeners.has(button), 'the dedicated K19 button receives its click handler');
    listeners.get(button)();
    assert.deepEqual(started, [
        'five_portals',
        { mapKey: K19_MAP_KEYS[0], numBots: 0 },
        K19_CHAIN_ID,
    ]);
});

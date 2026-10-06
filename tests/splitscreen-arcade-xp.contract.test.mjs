import test from 'node:test';
import assert from 'node:assert/strict';

import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { ArcadeRunPersistenceScheduler } from '../src/core/arcade/ArcadeRunPersistenceScheduler.js';
import { ArenaWavesRuntime } from '../src/core/arcade/ArenaWavesRuntime.js';
import { FivePortalsRuntime } from '../src/core/arcade/FivePortalsRuntime.js';
import { DemolitionRuntime } from '../src/core/arcade/DemolitionRuntime.js';
import { resolveArcadePostMatchProgression } from '../src/core/arcade/ArcadePostMatchProgression.js';
import { ARENA_WAVES_BOT_CAPACITY } from '../src/shared/contracts/ArenaWavesContract.js';
import { arcadeVehicleXpForLevel as xpForLevel } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';
import {
    addXp,
    createArcadeVehicleProfile,
    loadVehicleProfiles,
    saveVehicleProfiles,
    XP_REWARD_TABLE,
} from '../src/state/arcade/ArcadeVehicleProfile.js';

function createStore() {
    const records = new Map();
    return {
        readJsonRecordResult(key) {
            if (!records.has(key)) return { ok: true, status: 'missing', value: null, reason: 'missing' };
            return { ok: true, status: 'found', value: JSON.parse(records.get(key)), reason: 'ok' };
        },
        loadJsonRecord(key, fallback = null) {
            return records.has(key) ? JSON.parse(records.get(key)) : fallback;
        },
        saveJsonRecord(key, value) {
            records.set(key, JSON.stringify(value));
            return { success: true, reason: 'ok' };
        },
    };
}

function createRunStub() {
    return {
        _enabled: true,
        _rewardBinding: { runType: 'endless_parcours', vehicleId: 'ship5' },
        _vehicleProfiles: {},
        _state: { xpEarned: 0, score: { multiplier: 1 } },
        _playerProfileBindingsActive: false,
        _playerBindings: new Map(),
        _playerProfilesByIndex: Object.create(null),
        _playerStoresByIndex: Object.create(null),
        _persistenceScheduler: new ArcadeRunPersistenceScheduler({ saveThrottleMs: 0 }),
        _scheduleVehicleProfilesSave() {},
        _enqueueHudEvent: (type, payload) => ({ type, ...payload }),
    };
}

/** Player two plays split-screen with an own profile and flies 'arrow'. */
function bindPlayerTwo(run, store = createStore()) {
    run._playerProfileBindingsActive = true;
    run._playerBindings.set(1, { playerIndex: 1, profileId: 'p2', vehicleId: 'arrow', store });
    run._playerProfilesByIndex[1] = loadVehicleProfiles(store);
    run._playerStoresByIndex[1] = store;
    return store;
}

test('without own profiles a split-screen checkpoint of player two levels his plane in the shared store', () => {
    const run = createRunStub();
    const result = ArcadeRunRuntime.prototype.applyParcoursXpEvent.call(run, 'checkpoint', 1, 'arrow');
    assert.ok(result?.earned > 0);
    assert.ok(run._vehicleProfiles.arrow, 'player two\'s plane gets the XP');
    assert.equal(run._vehicleProfiles.ship5, undefined, 'player one\'s plane gets nothing for it');
});

test('player one and callers without a plane keep the run\'s bound plane', () => {
    const run = createRunStub();
    ArcadeRunRuntime.prototype.applyParcoursXpEvent.call(run, 'checkpoint', 0, 'ship5');
    ArcadeRunRuntime.prototype.applyParcoursXpEvent.call(run, 'finish', 0);
    assert.ok(run._vehicleProfiles.ship5);
    assert.deepEqual(Object.keys(run._vehicleProfiles), ['ship5']);
});

test('with an own profile the parcours XP of player two land in player two\'s store, not in player one\'s', () => {
    const run = createRunStub();
    const store = bindPlayerTwo(run);
    const result = ArcadeRunRuntime.prototype.applyParcoursXpEvent.call(run, 'checkpoint', 1, 'arrow');
    assert.ok(result?.earned > 0);
    assert.deepEqual(Object.keys(run._vehicleProfiles), [], 'player one\'s store stays untouched');
    assert.equal(loadVehicleProfiles(store).arrow?.xp, XP_REWARD_TABLE.parcoursCheckpoint);
});

test('a best time of player two (the leaderboard passes only the index) goes to player two\'s profile', () => {
    const run = createRunStub();
    const store = bindPlayerTwo(run);
    ArcadeRunRuntime.prototype.applyParcoursXpEvent.call(run, 'new_best_time', 1);
    assert.deepEqual(Object.keys(run._vehicleProfiles), []);
    assert.equal(loadVehicleProfiles(store).arrow?.xp, XP_REWARD_TABLE.parcoursNewBestTime);
});

test('sector XP reach every local pilot with an own profile; the run vehicle counter only holds player one', () => {
    const run = createRunStub();
    const store = bindPlayerTwo(run);
    ArcadeRunRuntime.prototype._applySectorXpReward.call(run, { kills: 2, selfCollisions: 0 });
    const p1Xp = run._vehicleProfiles.ship5?.xp || 0;
    assert.ok(p1Xp > 0, 'player one still earns the sector XP');
    assert.equal(loadVehicleProfiles(store).arrow?.xp, p1Xp, 'player two earns the same sector XP in his own store');
    ArcadeRunRuntime.prototype.applyParcoursXpEvent.call(run, 'checkpoint', 1, 'arrow');
    assert.equal(run._state.vehicleXpEarned, p1Xp, 'the run vehicle counter ignores the partner\'s XP');
    assert.equal(run._state.xpEarned, 2 * p1Xp + XP_REWARD_TABLE.parcoursCheckpoint);
});

function arenaFixture() {
    const p1 = { index: 0, isBot: false, alive: true, maxHp: 100, hp: 100, baseSpeed: 10, speed: 10, vehicleId: 'ship5' };
    const p2 = { index: 1, isBot: false, alive: true, maxHp: 100, hp: 100, baseSpeed: 10, speed: 10, vehicleId: 'arrow' };
    const bots = Array.from({ length: ARENA_WAVES_BOT_CAPACITY }, (_, slot) => ({ player: { index: slot + 2, isBot: true, alive: false, maxHp: 100, hp: 100 }, ai: { setArcadeBotAggressiveness() {} }, slot }));
    const manager = {
        humanPlayers: [p1, p2], players: [p1, p2, ...bots.map((entry) => entry.player)], bots,
        _findSpawnPosition(_x, _z, { player }) { return { x: player.index, y: 1, z: 9 }; },
        activateBotSlot({ slot }) { bots[slot].player.alive = true; return true; },
        deactivateBotSlot(slot) { bots[slot].player.alive = false; return true; },
    };
    return { bots, manager };
}

test('arena waves credit a kill of player two to player two\'s own plane and store', () => {
    const p1Store = createStore();
    const p2Store = createStore();
    const f = arenaFixture();
    const runtime = new ArenaWavesRuntime({
        getRecordStore: () => p1Store,
        getPlayerRewardTarget: (playerIndex) => (playerIndex === 1 ? { store: p2Store, vehicleId: 'arrow' } : null),
    });
    runtime.start({ entityManager: f.manager, vehicleId: 'ship5' });
    runtime.update(5); runtime.update(1);
    assert.equal(runtime.phase, 'combat');
    runtime.handleGameplayEvent({ type: 'kill', playerIndex: 1, victimIndex: f.bots[0].player.index });
    assert.equal(loadVehicleProfiles(p2Store).arrow?.xp, XP_REWARD_TABLE.killBase);
    assert.equal(loadVehicleProfiles(p1Store).ship5, undefined, 'player one\'s plane gets nothing for it');
    runtime.handleGameplayEvent({ type: 'kill', playerIndex: 0, victimIndex: f.bots[1].player.index });
    assert.equal(loadVehicleProfiles(p1Store).ship5?.xp, XP_REWARD_TABLE.killBase);
    assert.equal(runtime.getHudState().vehicleXpEarned, XP_REWARD_TABLE.killBase);
    assert.equal(runtime.getHudState().xpEarned, 2 * XP_REWARD_TABLE.killBase);
});

test('five portals give player two his parcours XP in his own store', () => {
    const p1Store = createStore();
    const p2Store = createStore();
    const runtime = new FivePortalsRuntime({
        getRecordStore: () => p1Store,
        getPlayerRewardTarget: (playerIndex) => (playerIndex === 1 ? { store: p2Store, vehicleId: 'arrow' } : null),
    });
    runtime.start(null, { vehicleId: 'ship5' });
    assert.ok(runtime.handleXpEvent('checkpoint', 1));
    assert.equal(loadVehicleProfiles(p2Store).arrow?.xp, XP_REWARD_TABLE.parcoursCheckpoint);
    assert.equal(loadVehicleProfiles(p1Store).ship5, undefined);
    runtime.handleXpEvent('finish', 0);
    assert.equal(runtime.getHudState().vehicleXpEarned, XP_REWARD_TABLE.parcoursFinish);
});

test('demolition counts only player one\'s share as run vehicle XP', () => {
    const stores = [createStore(), createStore()];
    const runtime = new DemolitionRuntime({ getRecordStoreForPlayerIndex: (index) => stores[index] });
    const manager = { humanPlayers: [{ index: 0, isBot: false, vehicleId: 'ship5' }, { index: 1, isBot: false, vehicleId: 'arrow' }] };
    runtime.start({ entityManager: manager, profileIds: ['p1', 'p2'] });
    runtime._awardXp(40);
    const state = runtime.getHudState();
    assert.equal(state.xpEarned, 80);
    assert.equal(state.vehicleXpEarned, 40);
});

test('the post-match prior level uses only the XP of the run vehicle', () => {
    const store = createStore();
    const before = addXp(createArcadeVehicleProfile('ship5', 1), xpForLevel(9), 2).profile;
    const gain = xpForLevel(10) - before.xp;
    saveVehicleProfiles(store, { ship5: addXp(before, gain, 3).profile });
    const partnerXp = xpForLevel(9);
    const summary = resolveArcadePostMatchProgression(store, {
        vehicleId: 'ship5',
        xpEarned: gain + partnerXp,
        vehicleXpEarned: gain,
    });
    assert.equal(summary.priorLevel, 9);
    assert.equal(summary.newLevel, 10);
    assert.equal(summary.xpEarned, gain);
    assert.deepEqual(summary.unlockedStonePackages, ['utility'], 'no phantom unlocks from the partner\'s XP');
});

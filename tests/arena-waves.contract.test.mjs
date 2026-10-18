import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ARENA_WAVES_BOT_CAPACITY, ARENA_WAVES_MAPS, ARENA_WAVES_WAVES_PER_MAP,
    applyArenaWavesChoice, applyArenaWavesMachineGunTuning, createArenaWavesUpgrades,
    resolveArenaWavesChoices, resolveArenaWavesProfile,
} from '../src/shared/contracts/ArenaWavesContract.js';
import { ArenaWavesRuntime } from '../src/core/arcade/ArenaWavesRuntime.js';
import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { loadVehicleProfiles } from '../src/state/arcade/ArcadeVehicleProfile.js';

function fixture(humanCount = 1) {
    const humans = Array.from({ length: humanCount }, (_, index) => ({
        index, isBot: false, alive: true, maxHp: 100, hp: 40, baseSpeed: 10, speed: 10,
        position: { x: index, y: 1, z: 0 }, vehicleId: `ship${index + 1}`,
    }));
    const bots = Array.from({ length: ARENA_WAVES_BOT_CAPACITY }, (_, slot) => ({
        player: { index: humanCount + slot, isBot: true, alive: false, maxHp: 100, hp: 100 },
        ai: { setArcadeBotAggressiveness() {} },
    }));
    const manager = {
        humanPlayers: humans, players: [...humans, ...bots.map(entry => entry.player)], bots,
        _findSpawnPosition(_x, _z, { player }) { return { x: player.index, y: 1, z: 9 }; },
        activateBotSlot({ slot }) { bots[slot].player.alive = true; return true; },
        deactivateBotSlot(slot) { bots[slot].player.alive = false; return true; },
        powerupManager: { spawnAtAnchor() {}, removeByOwnerId() {} },
    };
    return { humans, bots, manager };
}

function enterCombat(runtime) {
    runtime.update(5);
    assert.equal(runtime.phase, 'telegraph');
    runtime.update(1);
    assert.equal(runtime.phase, 'combat');
}

function clearActive(runtime, f, humanIndex = 0) {
    for (const slot of [...runtime._activeSlots]) {
        runtime.handleGameplayEvent({ type: 'kill', playerIndex: humanIndex,
            victimIndex: f.bots[slot].player.index });
    }
    assert.equal(runtime._activeSlots.size, 0);
}

function clearArena(runtime, f) {
    for (let wave = 1; wave <= ARENA_WAVES_WAVES_PER_MAP; wave++) {
        assert.equal(runtime.wave, wave);
        clearActive(runtime, f);
        runtime.update(5);
    }
}

test('finite profile rises across five arenas and choices remain deterministic', () => {
    assert.equal(ARENA_WAVES_WAVES_PER_MAP, 2);
    assert.equal(ARENA_WAVES_MAPS.length, 5);
    assert.equal(resolveArenaWavesProfile(1).count, 2);
    assert.equal(resolveArenaWavesProfile(5).count, 6);
    assert.equal(resolveArenaWavesProfile(10).count, 12);
    const choices = resolveArenaWavesChoices(createArenaWavesUpgrades(), 'raptor_r9', 82, 3);
    assert.deepEqual(choices, resolveArenaWavesChoices(createArenaWavesUpgrades(), 'raptor_r9', 82, 3));
    assert.equal(new Set(choices).size, 4);
    const tuned = applyArenaWavesMachineGunTuning({ DAMAGE: 10, COOLING_PER_SECOND: 20 }, 2);
    assert.ok(Math.abs(tuned.DAMAGE - 11.2) < 1e-9);
});

test('two clears request one map transition only after the upgrade choice', () => {
    const f = fixture(); const transitions = [];
    const runtime = new ArenaWavesRuntime({ requestMapTransition: item => transitions.push(item) });
    runtime.start({ entityManager: f.manager }); enterCombat(runtime);
    clearArena(runtime, f);
    assert.equal(runtime.phase, 'upgrade');
    assert.equal(runtime.mapIndex, 1);
    assert.equal(transitions.length, 0);
    const choice = runtime.getHudState().choices[0];
    runtime.selectChoice(choice);
    assert.equal(runtime.phase, 'transition');
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].mapKey, ARENA_WAVES_MAPS[1]);
    assert.equal(runtime.selectChoice(choice), null);
    assert.equal(transitions.length, 1);
});

test('fifth arena ends once with ten completed waves and v2 record', () => {
    const f = fixture(); const transitions = [], results = [], writes = [];
    const store = { loadJsonRecord() { return null; }, saveJsonRecord(key, value) { writes.push({ key, value }); return true; } };
    const runtime = new ArenaWavesRuntime({ getRecordStore: () => store,
        requestMapTransition: item => transitions.push(item) });
    runtime.start({ entityManager: f.manager });
    runtime._onJourneyCompleted = result => results.push(result);
    for (let index = 0; index < ARENA_WAVES_MAPS.length; index++) {
        if (index) runtime.start({ entityManager: f.manager });
        enterCombat(runtime);
        assert.equal(runtime.getHudState().plannedSpawnCount, 0);
        assert.equal(f.bots[0].player.maxHp > 0, true);
        clearArena(runtime, f);
        if (index < ARENA_WAVES_MAPS.length - 1) runtime.selectChoice(runtime.getHudState().choices[0]);
    }
    assert.equal(runtime.phase, 'finished');
    assert.equal(runtime.mapStats.length, 5);
    assert.equal(runtime.mapStats.reduce((sum, row) => sum + row.completedWaves.length, 0), 10);
    assert.equal(transitions.length, 4);
    assert.deepEqual(results, [{ succeeded: true, value: runtime.totalScore }]);
    const recordWrite = writes.find(write => write.key === 'curviosclash.arena-waves-records.v2');
    assert.equal(recordWrite.value.version, 'arena-waves-records.v2');
    runtime.update(100);
    assert.equal(results.length, 1);
});

test('one dead human leaves the team active; whole-group death ends without transition', () => {
    const f = fixture(2); const transitions = [], results = [];
    const runtime = new ArenaWavesRuntime({ requestMapTransition: item => transitions.push(item) });
    runtime.start({ entityManager: f.manager }); enterCombat(runtime);
    runtime._onJourneyCompleted = result => results.push(result);
    f.humans[0].alive = false;
    runtime.update(1);
    assert.equal(runtime.phase, 'combat');
    clearActive(runtime, f, 1);
    f.humans[1].alive = false;
    runtime.update(0);
    assert.equal(runtime.phase, 'finished');
    assert.equal(runtime.getHudState().postRunSummary.succeeded, false);
    assert.equal(transitions.length, 0);
    assert.deepEqual(results, [{ succeeded: false, value: runtime.totalScore }]);
    runtime.update(60);
    assert.equal(results.length, 1);
});

test('upgrades and heals apply to every local human', () => {
    const f = fixture(3); const runtime = new ArenaWavesRuntime();
    runtime.start({ entityManager: f.manager });
    runtime.upgrades = applyArenaWavesChoice(runtime.upgrades, 'speed');
    runtime.upgrades = applyArenaWavesChoice(runtime.upgrades, 'max_hp');
    runtime._applyHumanUpgrades(true);
    for (const human of f.humans) {
        assert.equal(human.baseSpeed, 10.4);
        assert.equal(human.maxHp, 112);
        assert.equal(human.hp, 112);
        assert.ok(human.arenaWavesLoadout);
    }
    runtime.dispose();
    for (const human of f.humans) assert.equal(human.arenaWavesLoadout, undefined);
});

test('forced reset disposes an active arena run after config removal, preserving a rebuild', () => {
    const state = { runtimeConfig: null };
    const support = new GameRuntimeArcadeSupport({ getRuntimeState: () => state, getGame: () => null });
    support.arenaWavesRuntime.phase = 'countdown'; support._sectorRebuildInFlight = true;
    support.resetRunState(); assert.equal(support.arenaWavesRuntime.phase, 'countdown');
    support.resetRunState({ force: true }); assert.equal(support.arenaWavesRuntime.phase, 'idle');
});

test('supply and pickup upgrades keep their effect while the finite run heals its team', () => {
    const f = fixture(2), effects = [], supplies = [];
    f.manager.powerupManager.spawnAtAnchor = item => supplies.push(item);
    const runtime = new ArenaWavesRuntime();
    runtime.start({ entityManager: f.manager, strategy: { applyRunRewardEffects: effect => effects.push(effect) } });
    runtime.upgrades = applyArenaWavesChoice(runtime.upgrades, 'pickup');
    runtime._pendingSupplyPickup = 'SHIELD';
    runtime._applyHumanUpgrades(true);
    assert.equal(effects.at(-1).spawnRateMultiplier, 1.15);
    enterCombat(runtime);
    assert.equal(supplies[0].type, 'SHIELD');
    assert.equal(supplies[0].x, f.humans[0].position.x);
});

test('a surviving partner earns XP in their own vehicle and store after the primary player dies', () => {
    const f = fixture(2);
    const stores = Array.from({ length: 2 }, () => {
        const data = new Map();
        return { loadJsonRecord: (key, fallback) => data.has(key) ? structuredClone(data.get(key)) : fallback,
            readJsonRecordResult: key => data.has(key) ? { status: 'found', value: structuredClone(data.get(key)) } : { status: 'missing' },
            saveJsonRecord: (key, value) => { data.set(key, structuredClone(value)); return true; } };
    });
    const before = stores.map(store => loadVehicleProfiles(store));
    const runtime = new ArenaWavesRuntime({ getRecordStore: () => stores[0],
        getPlayerRewardTarget: index => index === 1 ? { store: stores[1], vehicleId: 'ship2' } : null });
    runtime.start({ entityManager: f.manager, vehicleId: 'ship1' }); enterCombat(runtime);
    f.humans[0].alive = false;
    runtime.handleGameplayEvent({ type: 'kill', playerIndex: 1, victimIndex: f.bots[0].player.index });
    assert.equal(loadVehicleProfiles(stores[0]).ship1?.xp || 0, before[0].ship1?.xp || 0);
    assert.ok(loadVehicleProfiles(stores[1]).ship2.xp > (before[1].ship2?.xp || 0));
    assert.equal(runtime.vehicleXpEarned, 0);
});

test('dispose clears every participant projectile, pending supply and transient loadout', () => {
    const f = fixture(2), cleared = [], effects = [];
    let removed = '';
    f.manager._projectileSystem = { clearForOwner: player => cleared.push(player.index) };
    f.manager.powerupManager.removeByOwnerId = owner => { removed = owner; };
    const runtime = new ArenaWavesRuntime();
    runtime.start({ entityManager: f.manager, strategy: { applyRunRewardEffects: effect => effects.push(effect) } });
    enterCombat(runtime); runtime.dispose();
    assert.equal(runtime.phase, 'idle');
    assert.equal(runtime._activeSlots.size, 0);
    assert.deepEqual(cleared, f.manager.players.map(player => player.index));
    assert.equal(removed, 'arena-waves-supply');
    assert.equal(effects.at(-1), null);
    for (const human of f.humans) assert.equal(human.arenaWavesLoadout, undefined);
});

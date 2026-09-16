import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENA_WAVES_MAPS, applyArenaWavesChoice, applyArenaWavesMachineGunTuning, createArenaWavesUpgrades, resolveArenaWavesChoices, resolveArenaWavesMapMultipliers, resolveArenaWavesProfile, resolveArenaWavesSupplyPickup } from '../src/shared/contracts/ArenaWavesContract.js';
import { normalizeArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { ArenaWavesRuntime } from '../src/core/arcade/ArenaWavesRuntime.js';
import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';

function fixture() {
    const human = { index: 0, isBot: false, alive: true, maxHp: 100, hp: 40, baseSpeed: 10, speed: 10, fightLoadout: {}, position: { x: 2, y: 3, z: 4 } };
    const bots = Array.from({ length: 12 }, (_, slot) => ({ player: { index: slot + 1, isBot: true, alive: false, maxHp: 100, hp: 100, endlessDamageMultiplier: 1 }, ai: { setProfile() {}, reset() {} }, slot }));
    const active = new Set(); const supplies = []; const strategyEffects = [];
    const manager = {
        humanPlayers: [human], players: [human, ...bots.map((entry) => entry.player)], bots,
        _findSpawnPosition(_x, _z, { player }) { return { x: player.index, y: 1, z: 9 }; },
        activateBotSlot({ slot }) { active.add(slot); bots[slot].player.alive = true; return true; },
        deactivateBotSlot(slot) { active.delete(slot); bots[slot].player.alive = false; return true; },
        powerupManager: { spawnAtAnchor(anchor) { supplies.push(anchor); } },
    };
    return { human, bots, active, supplies, manager, strategy: { applyRunRewardEffects(effects) { strategyEffects.push(effects); } }, strategyEffects };
}

function enterCombat(runtime) { runtime.update(5); assert.equal(runtime.phase, 'telegraph'); runtime.update(1); assert.equal(runtime.phase, 'combat'); }

test('settings, profiles, deterministic distinct choices and machine-gun tuning use the intended contracts', () => {
    assert.deepEqual(ARENA_WAVES_MAPS, ['notre_dame_arena', 'notre_dame_fire_arena', 'eiffel_tower_siege', 'burg_falkenwacht_arena', 'reactor_site']);
    assert.equal(normalizeArcadeRunSettings({ runType: 'ARENA_WAVES', combatProfile: 'HUNT' }).runType, 'arena_waves');
    assert.deepEqual(resolveArenaWavesProfile(5), { wave: 5, count: 6, difficulty: 'HARD', hp: 1.4, damage: 1.2, elite: true, eliteSlot: 5 });
    assert.deepEqual(resolveArenaWavesMapMultipliers(4), { hp: 1.4, damage: 1.2 });
    const choices = resolveArenaWavesChoices(createArenaWavesUpgrades(), 'raptor_r9', 82, 3);
    assert.deepEqual(choices, resolveArenaWavesChoices(createArenaWavesUpgrades(), 'raptor_r9', 82, 3));
    assert.equal(choices.length, 4); assert.equal(new Set(choices).size, 4); assert.ok(!choices.includes('machine_gun:raptor_r9'));
    const tuned = applyArenaWavesMachineGunTuning({ DAMAGE: 10, COOLING_PER_SECOND: 20, COOLDOWN: 1 }, 2);
    assert.ok(Math.abs(tuned.DAMAGE - 11.2) < 1e-9); assert.equal(tuned.COOLING_PER_SECOND, 23.2); assert.equal(tuned.COOLDOWN, 1);
    assert.equal(resolveArenaWavesSupplyPickup('supply:rocket'), 'ROCKET_MEDIUM');
});

test('telegraph delays activation, applies non-compounding bot HP and the consumed bot damage multiplier', () => {
    const f = fixture(); const runtime = new ArenaWavesRuntime(); runtime.start({ entityManager: f.manager, strategy: f.strategy });
    runtime.update(5); assert.equal(runtime.phase, 'telegraph'); assert.equal(runtime.getHudState().plannedSpawnCount, 2); assert.equal(f.active.size, 0);
    runtime.update(1); assert.equal(runtime.phase, 'combat'); assert.equal(f.bots[0].player.maxHp, 100); assert.equal(f.bots[0].player.endlessDamageMultiplier, 1);
    runtime.wave = 2; runtime.phase = 'countdown'; runtime.countdown = 0; runtime.update(0); runtime.update(1);
    assert.ok(Math.abs(f.bots[0].player.maxHp - 110) < 1e-9); assert.equal(f.bots[0].player.endlessDamageMultiplier, 1.05);
    runtime._deactivateBots('test'); assert.equal(f.bots[0].player.endlessDamageMultiplier, 1);
});

test('one choice branches once: milestone resumes countdown and death waits for choice before one map transition', () => {
    const f = fixture(); const transitions = []; const runtime = new ArenaWavesRuntime({ requestMapTransition: (item) => transitions.push(item) });
    runtime.start({ entityManager: f.manager, strategy: f.strategy, seed: 9 }); runtime.wave = 4; enterCombat(runtime);
    for (const slot of [...f.active]) runtime.handleGameplayEvent({ type: 'kill', victimIndex: f.bots[slot].player.index });
    assert.equal(runtime.phase, 'upgrade'); const choice = runtime.getHudState().choices[0]; runtime.selectChoice(choice);
    assert.equal(runtime.phase, 'countdown'); assert.equal(runtime.getHudState().choices.length, 0); assert.equal(runtime.selectChoice(choice), null);
    runtime.phase = 'combat'; f.human.alive = false; runtime.update(0);
    assert.equal(runtime.phase, 'upgrade'); assert.equal(transitions.length, 0);
    const deathChoice = runtime.getHudState().choices[0]; runtime.selectChoice(deathChoice);
    assert.equal(runtime.phase, 'transition'); assert.equal(transitions.length, 1); runtime.selectChoice(deathChoice); assert.equal(transitions.length, 1);
    f.human.alive = true; runtime.start({ entityManager: f.manager }); assert.equal(runtime.phase, 'countdown'); runtime.phase = 'combat'; f.human.alive = false; runtime.update(0);
    runtime.selectChoice(runtime.getHudState().choices[0]); assert.equal(transitions.length, 2); assert.equal(transitions[1].mapKey, 'eiffel_tower_siege');
});

test('upgrades heal humans, keep speed percentage-based, synchronize pickup effect, and queue an allowed supply', () => {
    const f = fixture(); const runtime = new ArenaWavesRuntime(); runtime.start({ entityManager: f.manager, strategy: f.strategy });
    runtime.upgrades = applyArenaWavesChoice(runtime.upgrades, 'speed'); runtime.upgrades = applyArenaWavesChoice(runtime.upgrades, 'max_hp');
    runtime.upgrades = applyArenaWavesChoice(runtime.upgrades, 'pickup'); runtime._pendingSupplyPickup = 'SHIELD'; runtime._applyHumanUpgrades(true);
    assert.equal(f.human.baseSpeed, 10.4); assert.equal(f.human.maxHp, 112); assert.equal(f.human.hp, 112);
    assert.equal(f.strategyEffects.at(-1).spawnRateMultiplier, 1.15);
    enterCombat(runtime); assert.equal(f.supplies[0].type, 'SHIELD'); assert.equal(f.supplies[0].x, 2);
});

test('survival only advances in combat and final map persists total and summary', () => {
    const f = fixture(); const saved = []; const store = { loadJsonRecord() { return null; }, saveJsonRecord(_key, value) { saved.push(value); } };
    const runtime = new ArenaWavesRuntime({ getRecordStore: () => store }); runtime.start({ entityManager: f.manager });
    runtime.update(3); assert.equal(runtime.survivalSeconds, 0); enterCombat(runtime); runtime.update(2); assert.equal(runtime.survivalSeconds, 2);
    runtime.mapIndex = 4; runtime.phase = 'combat'; f.human.alive = false; runtime.update(0);
    const state = runtime.getHudState(); assert.equal(state.phase, 'finished'); assert.equal(state.postRunSummary.total, state.score.total); assert.equal(saved[0].version, 'arena-waves-records.v1');
});

test('map time is independent after a death and late map damage keeps its designed factor', () => {
    const f = fixture(); const runtime = new ArenaWavesRuntime(); runtime.start({ entityManager: f.manager }); enterCombat(runtime); runtime.update(4);
    runtime.phase = 'combat'; f.human.alive = false; runtime.update(0); assert.equal(runtime.mapStats[0].survivalSeconds, 4); assert.equal(runtime.survivalSeconds, 0);
    f.human.alive = true; runtime.selectChoice(runtime.getHudState().choices[0]); runtime.start({ entityManager: f.manager }); runtime.mapIndex = 4; runtime.wave = 17; runtime.countdown = 0; runtime.update(0); runtime.update(1);
    assert.ok(Math.abs(f.bots[0].player.arenaWavesDamageMultiplier - 2.16) < 1e-9);
});

test('dispose deactivates bots, clears transient supply/projectiles and cannot resume an aborted run', () => {
    const f = fixture(); const cleared = []; let removed = '';
    f.manager._projectileSystem = { clearForOwner(player) { cleared.push(player.index); } };
    f.manager.powerupManager.removeByOwnerId = (ownerId) => { removed = ownerId; };
    const runtime = new ArenaWavesRuntime(); runtime.start({ entityManager: f.manager, strategy: f.strategy }); enterCombat(runtime);
    runtime.dispose(); assert.equal(runtime.phase, 'idle'); assert.equal(f.active.size, 0); assert.deepEqual(cleared, Array.from({ length: 13 }, (_, index) => index));
    assert.equal(removed, 'arena-waves-supply'); assert.equal(f.human.fightLoadout.arenaWavesMgTuning, 0); assert.equal(f.strategyEffects.at(-1), null);
});

test('forced reset disposes an active arena run after config removal, but preserves an in-flight rebuild', () => {
    const state = { runtimeConfig: null }; const support = new GameRuntimeArcadeSupport({ getRuntimeState: () => state, getGame: () => null });
    support.arenaWavesRuntime.phase = 'countdown'; support._sectorRebuildInFlight = true;
    support.resetRunState(); assert.equal(support.arenaWavesRuntime.phase, 'countdown');
    support.resetRunState({ force: true }); assert.equal(support.arenaWavesRuntime.phase, 'idle');
});

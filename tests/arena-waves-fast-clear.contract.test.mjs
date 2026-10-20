// D4: Arena Waves rewards clearing a wave fast. When the last bot of the arena dies, the rest of
// the wave timer shrinks to a short warning window, and the skipped seconds score a bonus that
// outweighs the survival points they would have earned.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ARENA_WAVES_BOT_CAPACITY,
    ARENA_WAVES_CLEAR_REMAINDER_SECONDS,
    ARENA_WAVES_FAST_CLEAR_POINTS_PER_SECOND,
    ARENA_WAVES_INTERVAL_SECONDS,
    calculateArenaWavesScore,
} from '../src/shared/contracts/ArenaWavesContract.js';
import { ArenaWavesRuntime } from '../src/core/arcade/ArenaWavesRuntime.js';
import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { killPlayer } from '../src/entities/EntityPlayerDeathOps.js';

function fixture() {
    const human = { index: 0, isBot: false, alive: true, maxHp: 100, hp: 100, baseSpeed: 10, speed: 10, fightLoadout: {}, position: { x: 0, y: 1, z: 0 } };
    const bots = Array.from({ length: ARENA_WAVES_BOT_CAPACITY }, (_, slot) => ({ player: { index: slot + 1, isBot: true, alive: false, maxHp: 100, hp: 100 }, ai: { setArcadeBotAggressiveness() {} }, slot }));
    const manager = {
        humanPlayers: [human], players: [human, ...bots.map((entry) => entry.player)], bots,
        _findSpawnPosition(_x, _z, { player }) { return { x: player.index, y: 1, z: 9 }; },
        activateBotSlot({ slot }) { bots[slot].player.alive = true; return true; },
        deactivateBotSlot(slot) { bots[slot].player.alive = false; return true; },
        powerupManager: { spawnAtAnchor() {} },
    };
    return { human, bots, manager };
}

// A clear ten seconds into the 30 s wave skips the rest down to the short warning window.
const FAST_CLEAR_AFTER_TEN_SECONDS = ARENA_WAVES_INTERVAL_SECONDS - 10 - ARENA_WAVES_CLEAR_REMAINDER_SECONDS;
const kill = (runtime, f, slot) => runtime.handleGameplayEvent({ type: 'kill', playerIndex: f.human.index, victimIndex: f.bots[slot].player.index });
function integratedArena(combatElapsed = 10) {
    const f = fixture();
    const runtimeConfig = { arcade: { enabled: true, runType: 'arena_waves', seed: 17 } };
    f.manager.runtimeConfig = runtimeConfig;
    for (const player of f.manager.players) player.kill = function kill() { this.alive = false; this.hp = 0; };
    f.manager._respawnSystem = { onPlayerDied() {} };
    f.manager._eventBus = { emitPlayerDied() {} };
    f.manager.gameModeStrategy = { hasScoring: () => false };
    const state = { runtimeConfig, entityManager: f.manager };
    const support = new GameRuntimeArcadeSupport({ getRuntimeState: () => state, nowMs: () => 1000 });
    support.startRunIfEnabled();
    const runtime = support.arenaWavesRuntime;
    runtime.update(5); runtime.update(1); runtime.update(combatElapsed);
    return { ...f, support, runtime };
}

function killThroughProducer(manager, victim, killer = null) {
    killPlayer(manager, victim, 'PROJECTILE', { killer });
}

test('the contract keeps the clear window short and the bonus above the survival rate', () => {
    assert.equal(ARENA_WAVES_CLEAR_REMAINDER_SECONDS, 5);
    assert.ok(ARENA_WAVES_FAST_CLEAR_POINTS_PER_SECOND > 5, 'a skipped second is worth more than a survived one');
    assert.equal(calculateArenaWavesScore({ fastClearSeconds: 10.6 }), 10 * ARENA_WAVES_FAST_CLEAR_POINTS_PER_SECOND);
});

test('clearing the arena cuts the wave timer and scores the skipped seconds', () => {
    const f = fixture();
    const runtime = new ArenaWavesRuntime();
    runtime.start({ entityManager: f.manager });
    runtime.update(5); runtime.update(1);
    assert.equal(runtime.phase, 'combat');
    runtime.update(10);
    kill(runtime, f, 0);
    assert.equal(runtime.getHudState().nextWaveInSeconds, ARENA_WAVES_INTERVAL_SECONDS - 10, 'one bot left: the timer runs on');
    kill(runtime, f, 1);
    assert.equal(runtime.getHudState().nextWaveInSeconds, ARENA_WAVES_CLEAR_REMAINDER_SECONDS);
    assert.equal(runtime.fastClearSeconds, FAST_CLEAR_AFTER_TEN_SECONDS);
    const base = calculateArenaWavesScore({ survivalSeconds: 10, regularKills: 2, completedWaves: [1] });
    assert.equal(runtime.score, base + FAST_CLEAR_AFTER_TEN_SECONDS * ARENA_WAVES_FAST_CLEAR_POINTS_PER_SECOND);
    runtime.update(4); assert.equal(runtime.phase, 'telegraph', 'the next wave is announced a second early as before');
    runtime.update(1); assert.equal(runtime.wave, 2);
});

test('a last bot that dies without a human kill still shortens the wait but scores no bonus', () => {
    const f = fixture();
    const runtime = new ArenaWavesRuntime();
    runtime.start({ entityManager: f.manager });
    runtime.update(5); runtime.update(1); runtime.update(10);
    kill(runtime, f, 0);
    // Bot slot 0's pilot is credited with the last kill (a bot-on-bot hit or a hazard attributed to it).
    runtime.handleGameplayEvent({ type: 'kill', playerIndex: f.bots[0].player.index, victimIndex: f.bots[1].player.index });
    assert.equal(runtime.getHudState().nextWaveInSeconds, ARENA_WAVES_CLEAR_REMAINDER_SECONDS, 'the empty arena still moves on');
    assert.equal(runtime.fastClearSeconds, 0, 'no human cleared it, so no bonus');
});

test('clearing with three seconds left does not shorten the wait or award a fast-clear bonus', () => {
    const f = integratedArena(ARENA_WAVES_INTERVAL_SECONDS - 3);
    assert.equal(f.runtime.getHudState().nextWaveInSeconds, 3);
    killThroughProducer(f.manager, f.bots[0].player, f.human);
    killThroughProducer(f.manager, f.bots[1].player, f.human);
    assert.equal(f.runtime.getHudState().nextWaveInSeconds, 3, 'late kills leave the remaining wave timer unchanged');
    assert.equal(f.runtime.fastClearSeconds, 0, 'no positive seconds were skipped');
});
test('a real last kill keeps its earned fast-clear bonus when the human dies afterward', () => {
    const f = integratedArena();
    killThroughProducer(f.manager, f.bots[0].player, f.human);
    killThroughProducer(f.manager, f.bots[1].player, f.human);
    assert.equal(f.runtime.fastClearSeconds, FAST_CLEAR_AFTER_TEN_SECONDS);
    assert.equal(f.runtime.regularKills, 2);
    killThroughProducer(f.manager, f.human);
    f.runtime.update(0);
    assert.equal(f.runtime.mapStats[0].fastClearSeconds, FAST_CLEAR_AFTER_TEN_SECONDS, 'later death preserves a bonus earned while alive');
    assert.equal(f.runtime.mapStats[0].regularKills, 2);
});

test('a human already dead may retain kill credit but cannot earn the final-clear bonus', () => {
    const f = integratedArena();
    killThroughProducer(f.manager, f.bots[0].player, f.human);
    killThroughProducer(f.manager, f.human);
    killThroughProducer(f.manager, f.bots[1].player, f.human);
    assert.equal(f.runtime.regularKills, 2, 'the attributed posthumous kill remains in kill counters');
    assert.equal(f.runtime.fastClearSeconds, 0, 'the dead credited human cannot earn the last-clear bonus');
    f.runtime.update(0);
    assert.equal(f.runtime.mapStats[0].regularKills, 2);
    assert.equal(f.runtime.mapStats[0].fastClearSeconds, 0);
});

test('death cleanup first makes a delayed kill event stale', () => {
    const f = integratedArena();
    killThroughProducer(f.manager, f.human);
    f.runtime.update(0);
    const before = f.runtime.regularKills;
    f.manager.onArcadeGameplayEvent({ type: 'kill', playerIndex: f.human.index, victimIndex: f.bots[0].player.index });
    assert.equal(f.runtime.regularKills, before);
    assert.equal(f.runtime.fastClearSeconds, 0);
    assert.equal(f.runtime.getHudState().alive, 0);
});

test('finite wave progression clears a map without capacity eviction', () => {
    const f = fixture();
    const deactivations = [];
    const originalDeactivate = f.manager.deactivateBotSlot;
    f.manager.deactivateBotSlot = (slot, reason) => { deactivations.push({ slot, reason }); return originalDeactivate(slot, reason); };
    const runtime = new ArenaWavesRuntime();
    runtime.start({ entityManager: f.manager });
    runtime.update(5); runtime.update(1);
    for (const slot of [...runtime._activeSlots]) kill(runtime, f, slot);
    runtime.update(5);
    assert.equal(runtime.wave, 2);
    for (const slot of [...runtime._activeSlots]) kill(runtime, f, slot);
    runtime.update(5);
    assert.equal(runtime.phase, 'upgrade');
    assert.equal(deactivations.filter((entry) => entry.reason === 'wave_capacity').length, 0);
    assert.deepEqual(runtime.mapStats[0].completedWaves, [1, 2]);
});

test('an actual map-death cleanup deactivates the wave without granting a clear bonus', () => {
    const f = integratedArena();
    f.human.alive = false;
    f.runtime.update(0);
    assert.equal(f.runtime.getHudState().alive, 0);
    assert.equal(f.runtime.mapStats[0].fastClearSeconds, 0);
});

test('the human and the last bot dying in one frame still complete the wave, in either order', () => {
    // Kill events arrive synchronously from the death producer; the human death is only handled by
    // the next runtime update. A wave the human finished in that frame therefore counts once.
    for (const humanFirst of [false, true]) {
        const f = integratedArena();
        killThroughProducer(f.manager, f.bots[0].player, f.human);
        if (humanFirst) killThroughProducer(f.manager, f.human);
        killThroughProducer(f.manager, f.bots[1].player, f.human);
        if (!humanFirst) killThroughProducer(f.manager, f.human);
        f.runtime.update(0);
        const stats = f.runtime.mapStats[0];
        assert.deepEqual(stats.completedWaves, [1], `${humanFirst ? 'human first' : 'bot first'}: wave 1 counts once`);
        assert.equal(stats.regularKills, 2);
        assert.equal(stats.fastClearSeconds, humanFirst ? 0 : FAST_CLEAR_AFTER_TEN_SECONDS, 'only a living pilot earns the clear bonus');
        assert.equal(f.runtime.mapIndex, 0, 'group death ends the current attempt');
        assert.equal(f.runtime.phase, 'finished');
    }
});

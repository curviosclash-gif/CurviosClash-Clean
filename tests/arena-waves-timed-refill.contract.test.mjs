// A1/A2 (user decision 2026-10-19): a new arena wave arrives every 30 s while fewer than
// 12 bots are active (8 on very small maps) and only fills up to that limit. A bot that is
// left alive or stuck can no longer freeze the arena, and the HUD shows the aggression
// the wave bots actually drive with.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ARENA_WAVES_ACTIVE_BOT_LIMIT,
    ARENA_WAVES_BOT_CAPACITY,
    ARENA_WAVES_INTERVAL_SECONDS,
    ARENA_WAVES_SMALL_MAP_ACTIVE_BOT_LIMIT,
    ARENA_WAVES_WAVES_PER_MAP,
    calculateArenaWavesScore,
    resolveArenaWavesActiveBotLimit,
    resolveArenaWavesAggression,
} from '../src/shared/contracts/ArenaWavesContract.js';
import { ArenaWavesRuntime } from '../src/core/arcade/ArenaWavesRuntime.js';
import { resolveArcadeTierAggressiveness } from '../src/shared/contracts/ArcadeBotAggressionContract.js';

const LARGE_MAP_SIZE = [460, 150, 320];
const SMALL_MAP_SIZE = [100, 60, 100];

function fixture({ mapSize = LARGE_MAP_SIZE } = {}) {
    const human = { index: 0, isBot: false, alive: true, maxHp: 100, hp: 100, baseSpeed: 10, speed: 10, position: { x: 0, y: 1, z: 0 } };
    const bots = Array.from({ length: ARENA_WAVES_BOT_CAPACITY }, (_, slot) => ({
        player: { index: slot + 1, isBot: true, alive: false, maxHp: 100, hp: 100 },
        ai: { setArcadeBotAggressiveness() {} },
    }));
    const deactivations = [];
    const manager = {
        humanPlayers: [human], players: [human, ...bots.map((entry) => entry.player)], bots,
        arena: { currentMapDefinition: mapSize ? { size: mapSize } : null },
        _findSpawnPosition(_x, _z, { player }) { return { x: player.index, y: 1, z: 9 }; },
        activateBotSlot({ slot }) { bots[slot].player.alive = true; return true; },
        deactivateBotSlot(slot, reason) { deactivations.push(reason); bots[slot].player.alive = false; return true; },
        powerupManager: { spawnAtAnchor() {} },
    };
    return { human, bots, manager, deactivations };
}

const kill = (runtime, f, slot) => runtime.handleGameplayEvent({ type: 'kill', playerIndex: f.human.index, victimIndex: f.bots[slot].player.index });
function startCombat(f) {
    const runtime = new ArenaWavesRuntime();
    runtime.start({ entityManager: f.manager });
    runtime.update(5); runtime.update(1);
    assert.equal(runtime.phase, 'combat');
    return runtime;
}
function run(runtime, seconds, step = 0.5) {
    for (let elapsed = 0; elapsed < seconds; elapsed += step) runtime.update(step);
}

test('the contract spaces waves 30 s apart and caps active bots by map size', () => {
    assert.equal(ARENA_WAVES_INTERVAL_SECONDS, 30);
    assert.equal(ARENA_WAVES_ACTIVE_BOT_LIMIT, 12);
    assert.equal(ARENA_WAVES_SMALL_MAP_ACTIVE_BOT_LIMIT, 8);
    assert.equal(resolveArenaWavesActiveBotLimit(LARGE_MAP_SIZE), 12);
    assert.equal(resolveArenaWavesActiveBotLimit(SMALL_MAP_SIZE), 8);
    assert.equal(resolveArenaWavesActiveBotLimit(undefined), 12, 'an unknown size is not treated as very small');
    assert.ok(ARENA_WAVES_BOT_CAPACITY >= ARENA_WAVES_ACTIVE_BOT_LIMIT, 'the slot pool can hold a full arena');
});

test('the next wave arrives after 30 s although the first wave is still alive', () => {
    const f = fixture();
    const runtime = startCombat(f);
    assert.equal(runtime._activeSlots.size, 2);
    run(runtime, ARENA_WAVES_INTERVAL_SECONDS);
    assert.equal(runtime.wave, 2);
    assert.equal(runtime._activeSlots.size, 2 + 3, 'wave 2 joins the living wave 1');
});

test('waves keep coming every 30 s but never fill past the limit and never evict a bot', () => {
    for (const [mapSize, limit] of [[LARGE_MAP_SIZE, 12], [SMALL_MAP_SIZE, 8]]) {
        const f = fixture({ mapSize });
        const runtime = startCombat(f);
        let peak = 0;
        for (let step = 0; step < 1200; step += 1) {
            runtime.update(0.5);
            peak = Math.max(peak, runtime._activeSlots.size);
        }
        assert.equal(peak, limit, `arena of size ${mapSize} fills up to ${limit}`);
        assert.equal(f.deactivations.filter((reason) => reason === 'wave_capacity').length, 0, 'nobody is pushed out');
        const waveBeforeFullTick = runtime.wave;
        run(runtime, ARENA_WAVES_INTERVAL_SECONDS);
        assert.equal(runtime.wave, waveBeforeFullTick, 'a full arena skips the wave');
        kill(runtime, f, [...runtime._activeSlots][0]);
        run(runtime, ARENA_WAVES_INTERVAL_SECONDS);
        assert.equal(runtime._activeSlots.size, limit, 'the next tick refills exactly the free place');
        assert.equal(runtime.wave, waveBeforeFullTick + 1);
    }
});

test('a bot left alive no longer stops the arena: later waves still finish it', () => {
    const f = fixture();
    const runtime = startCombat(f);
    const keptAlive = [...runtime._activeSlots][0];
    kill(runtime, f, [...runtime._activeSlots][1]);
    let finishedAfter = null;
    for (let second = 0; second < 600 && finishedAfter === null; second += 1) {
        runtime.update(1);
        for (const slot of [...runtime._activeSlots]) if (slot !== keptAlive) kill(runtime, f, slot);
        if (runtime.phase === 'upgrade') finishedAfter = second;
    }
    assert.notEqual(finishedAfter, null, 'two other cleared waves win the arena');
    assert.ok(finishedAfter <= 2 * ARENA_WAVES_INTERVAL_SECONDS, `arena finished after ${finishedAfter} s`);
    assert.equal(runtime.mapIndex, 1);
    assert.equal(runtime.mapStats[0].completedWaves.length, ARENA_WAVES_WAVES_PER_MAP);
    assert.ok(!runtime.mapStats[0].completedWaves.includes(1), 'the wave with the surviving bot never counted');
    assert.equal(runtime._activeSlots.size, 0, 'the leftover bot leaves with the cleared arena');
    assert.ok(f.deactivations.includes('arena_clear'));
});

test('waiting next to a last bot earns survival points only under growing pressure', () => {
    const f = fixture();
    const runtime = startCombat(f);
    kill(runtime, f, [...runtime._activeSlots][0]);
    run(runtime, 600);
    assert.equal(runtime.phase, 'combat');
    assert.equal(runtime._activeSlots.size, ARENA_WAVES_ACTIVE_BOT_LIMIT, 'the arena is full instead of quiet');
    assert.ok(runtime.score <= calculateArenaWavesScore({ survivalSeconds: 600, regularKills: 1 }));
});

test('cleared waves score by clear order, so a late one-bot wave is no jackpot', () => {
    assert.equal(calculateArenaWavesScore({ completedWaves: [7, 12] }), calculateArenaWavesScore({ completedWaves: [1, 2] }));
    const f = fixture();
    const runtime = startCombat(f);
    const keptAlive = [...runtime._activeSlots][0];
    run(runtime, 600);
    for (const slot of [...runtime._activeSlots]) if (slot !== keptAlive) kill(runtime, f, slot);
    assert.ok(runtime.completedWaves.some((wave) => wave > 2), `later waves were cleared: ${runtime.completedWaves}`);
    assert.equal(runtime.score, calculateArenaWavesScore({ survivalSeconds: runtime.survivalSeconds, regularKills: runtime.regularKills, eliteKills: runtime.eliteKills, completedWaves: runtime.completedWaves.map((_, index) => index + 1) }),
        'stalling to collect high-numbered waves earns no more wave points than clearing waves 1 and 2');
});

test('a full arena waits the whole interval before the next tick', () => {
    const f = fixture();
    const runtime = startCombat(f);
    kill(runtime, f, [...runtime._activeSlots][0]);
    run(runtime, 600);
    assert.equal(runtime._activeSlots.size, ARENA_WAVES_ACTIVE_BOT_LIMIT);
    const before = runtime.getHudState().nextWaveInSeconds;
    run(runtime, before);
    assert.equal(runtime.getHudState().nextWaveInSeconds, ARENA_WAVES_INTERVAL_SECONDS, 'a skipped tick restarts a full 30 s');
    assert.equal(runtime.phase, 'combat', 'no empty wave warning');
});

test('the HUD aggression includes the run tier bonus like the spawned bots', () => {
    const f = fixture();
    const runtime = startCombat(f);
    runtime.rankContext = { tierId: 'nightmare' };
    assert.equal(runtime.getHudState().aggression, resolveArcadeTierAggressiveness(resolveArenaWavesAggression(0, 1), 'nightmare'));
    assert.ok(runtime.getHudState().aggression > resolveArenaWavesAggression(0, 1));
});

test('the HUD aggression is the one the wave bots get from the global wave', () => {
    const f = fixture();
    const runtime = startCombat(f);
    for (let wave = 1; wave <= ARENA_WAVES_WAVES_PER_MAP; wave += 1) {
        for (const slot of [...runtime._activeSlots]) kill(runtime, f, slot);
        runtime.update(5);
    }
    runtime.selectChoice(runtime.getHudState().choices[0]);
    runtime.start({ entityManager: f.manager });
    runtime.update(5); runtime.update(1);
    assert.equal(runtime.mapIndex, 1);
    assert.equal(runtime.wave, 1);
    assert.equal(runtime.getHudState().aggression, resolveArenaWavesAggression(1, ARENA_WAVES_WAVES_PER_MAP + 1));
});

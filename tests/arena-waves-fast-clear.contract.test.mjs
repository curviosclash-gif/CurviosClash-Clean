// D4: Arena Waves rewards clearing a wave fast. When the last bot of the arena dies, the rest of
// the wave timer shrinks to a short warning window, and the skipped seconds score a bonus that
// outweighs the survival points they would have earned.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ARENA_WAVES_BOT_CAPACITY,
    ARENA_WAVES_CLEAR_REMAINDER_SECONDS,
    ARENA_WAVES_FAST_CLEAR_POINTS_PER_SECOND,
    calculateArenaWavesScore,
} from '../src/shared/contracts/ArenaWavesContract.js';
import { ArenaWavesRuntime } from '../src/core/arcade/ArenaWavesRuntime.js';

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

const kill = (runtime, f, slot) => runtime.handleGameplayEvent({ type: 'kill', playerIndex: f.human.index, victimIndex: f.bots[slot].player.index });

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
    assert.equal(runtime.getHudState().nextWaveInSeconds, 50, 'one bot left: the timer runs on');
    kill(runtime, f, 1);
    assert.equal(runtime.getHudState().nextWaveInSeconds, ARENA_WAVES_CLEAR_REMAINDER_SECONDS);
    assert.equal(runtime.fastClearSeconds, 45);
    const base = calculateArenaWavesScore({ survivalSeconds: 10, regularKills: 2, completedWaves: [1] });
    assert.equal(runtime.score, base + 45 * ARENA_WAVES_FAST_CLEAR_POINTS_PER_SECOND);
    runtime.update(4); assert.equal(runtime.phase, 'telegraph', 'the next wave is announced a second early as before');
    runtime.update(1); assert.equal(runtime.wave, 2);
});

test('a late clear inside the window and a capacity eviction give no bonus', () => {
    const f = fixture();
    const runtime = new ArenaWavesRuntime();
    runtime.start({ entityManager: f.manager });
    runtime.update(5); runtime.update(1); runtime.update(57);
    kill(runtime, f, 0); kill(runtime, f, 1);
    assert.equal(runtime.fastClearSeconds, 0);
    assert.equal(runtime.getHudState().nextWaveInSeconds, 3);
    runtime._deactivateBots('map_death');
    assert.equal(runtime.fastClearSeconds, 0);
});

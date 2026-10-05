import test from 'node:test';
import assert from 'node:assert/strict';

import { ARENA_WAVES_BOT_CAPACITY, resolveArenaWavesAggression } from '../src/shared/contracts/ArenaWavesContract.js';
import { ArenaWavesRuntime } from '../src/core/arcade/ArenaWavesRuntime.js';
import { ClassicBridgePolicy } from '../src/entities/ai/ClassicBridgePolicy.js';
import { HuntBridgePolicy } from '../src/entities/ai/HuntBridgePolicy.js';
import { HuntBotPolicy } from '../src/hunt/HuntBotPolicy.js';

/**
 * Bridge and hunt policies wrap a RuleBasedBotPolicy; that innermost policy owns the
 * movement profile the bot actually drives with, so the snapshot is read there.
 */
function ruleBasedCore(policy) {
    let current = policy;
    while (current && typeof current.getArcadeAggressivenessSnapshot !== 'function') current = current._fallbackPolicy;
    assert.ok(current, 'the policy chain ends in a rule-based core');
    return current;
}

/**
 * Stands for EntityManager with the arena-waves slot pool, but with the real policies
 * setupBotPlayers creates instead of stubs, so a missing policy method stays visible.
 */
function fixture(createPolicy) {
    const human = { index: 0, isBot: false, alive: true, maxHp: 100, hp: 100, baseSpeed: 10, speed: 10, fightLoadout: {}, position: { x: 0, y: 1, z: 0 } };
    const bots = Array.from({ length: ARENA_WAVES_BOT_CAPACITY }, (_, slot) => ({
        player: { index: slot + 1, isBot: true, alive: false, maxHp: 100, hp: 100, endlessDamageMultiplier: 1 },
        ai: createPolicy(),
        slot,
    }));
    const manager = {
        humanPlayers: [human], players: [human, ...bots.map((entry) => entry.player)], bots,
        _findSpawnPosition(_x, _z, { player }) { return { x: player.index, y: 1, z: 9 }; },
        activateBotSlot({ slot, difficulty }) { bots[slot].ai.setDifficulty(difficulty); bots[slot].player.alive = true; return true; },
        deactivateBotSlot(slot) { bots[slot].player.alive = false; return true; },
        powerupManager: { spawnAtAnchor() {} },
    };
    return { bots, manager };
}

function runToWave(runtime, wave) {
    runtime.update(5); runtime.update(1);
    for (let next = 2; next <= wave; next += 1) { runtime.update(59); runtime.update(1); }
    assert.equal(runtime.wave, wave);
}

const POLICIES = [
    ['hunt bridge', () => new HuntBridgePolicy({ autoLoadCheckpoint: false, difficulty: 'NORMAL' })],
    ['classic bridge', () => new ClassicBridgePolicy({ autoLoadCheckpoint: false, difficulty: 'NORMAL' })],
];

for (const [label, createPolicy] of POLICIES) {
    test(`later arena waves spawn ${label} bots that drive more aggressively`, () => {
        const f = fixture(createPolicy);
        const runtime = new ArenaWavesRuntime();
        runtime.start({ entityManager: f.manager });
        runToWave(runtime, 3);

        const firstWave = ruleBasedCore(f.bots[0].ai).getArcadeAggressivenessSnapshot();
        const thirdWave = ruleBasedCore(f.bots[5].ai).getArcadeAggressivenessSnapshot();
        assert.equal(runtime._slotWave.get(5), 3, 'slot 5 belongs to the third wave');
        assert.ok(Math.abs(firstWave.authored - resolveArenaWavesAggression(0, 1)) < 1e-9, 'first-wave bots carry the first-wave aggressiveness');
        assert.ok(Math.abs(thirdWave.authored - resolveArenaWavesAggression(0, 3)) < 1e-9, 'third-wave bots carry the third-wave aggressiveness');
        assert.ok(thirdWave.profile > firstWave.profile, 'third-wave bots drive with a more aggressive profile');
    });
}

test('a hunt bot accepts a live arcade aggressiveness update like the classic bots do', () => {
    const policy = new HuntBotPolicy({ difficulty: 'NORMAL', runtimeConfig: { bot: { arcadeAggressiveness: 0.45 } } });
    policy.setArcadeBotAggressiveness?.(0.85);
    assert.equal(ruleBasedCore(policy).getArcadeAggressivenessSnapshot().authored, 0.85, 'the live update reaches the hunt bot');
});

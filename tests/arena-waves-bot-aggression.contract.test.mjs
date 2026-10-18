import test from 'node:test';
import assert from 'node:assert/strict';

import { ARENA_WAVES_BOT_CAPACITY, resolveArenaWavesAggression } from '../src/shared/contracts/ArenaWavesContract.js';
import { ArenaWavesRuntime } from '../src/core/arcade/ArenaWavesRuntime.js';
import { ClassicBridgePolicy } from '../src/entities/ai/ClassicBridgePolicy.js';
import { HuntBridgePolicy } from '../src/entities/ai/HuntBridgePolicy.js';
import { HuntBotPolicy } from '../src/hunt/HuntBotPolicy.js';
import { resolveArcadeRoleAggressiveness } from '../src/shared/contracts/ArcadeBotAggressionContract.js';

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
        activateBotSlot({ slot, difficulty, role = '' }) { bots[slot].ai.setDifficulty(difficulty); bots[slot].player.scenarioRole = role; bots[slot].player.alive = true; return true; },
        deactivateBotSlot(slot) { bots[slot].player.alive = false; return true; },
        powerupManager: { spawnAtAnchor() {} },
    };
    return { bots, manager };
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
        runtime.update(5); runtime.update(1);
        const firstWave = ruleBasedCore(f.bots[0].ai).getArcadeAggressivenessSnapshot();
        const firstExpected = resolveArcadeRoleAggressiveness(resolveArenaWavesAggression(0, 1), f.bots[0].player.scenarioRole);
        assert.ok(Math.abs(firstWave.authored - firstExpected) < 1e-9);
        for (let wave = 1; wave <= 2; wave++) {
            for (const slot of [...runtime._activeSlots]) runtime.handleGameplayEvent({ type: 'kill', playerIndex: 0,
                victimIndex: f.bots[slot].player.index });
            runtime.update(5);
        }
        runtime.selectChoice(runtime.getHudState().choices[0]);
        runtime.start({ entityManager: f.manager });
        runtime.update(5); runtime.update(1);
        assert.equal(runtime.mapIndex, 1);
        const thirdSlot = [...runtime._activeSlots][0];
        const thirdWave = ruleBasedCore(f.bots[thirdSlot].ai).getArcadeAggressivenessSnapshot();
        assert.equal(runtime._slotWave.get(thirdSlot), 1, 'global wave 3 is local wave 1 on map 2');
        const thirdExpected = resolveArcadeRoleAggressiveness(resolveArenaWavesAggression(1, 3), f.bots[thirdSlot].player.scenarioRole);
        assert.ok(Math.abs(thirdWave.authored - thirdExpected) < 1e-9);
        assert.ok(thirdWave.profile > firstWave.profile, 'third-wave bots drive with a more aggressive profile');
    });
}

test('a hunt bot accepts a live arcade aggressiveness update like the classic bots do', () => {
    const policy = new HuntBotPolicy({ difficulty: 'NORMAL', runtimeConfig: { bot: { arcadeAggressiveness: 0.45 } } });
    policy.setArcadeBotAggressiveness?.(0.85);
    assert.equal(ruleBasedCore(policy).getArcadeAggressivenessSnapshot().authored, 0.85, 'the live update reaches the hunt bot');
});

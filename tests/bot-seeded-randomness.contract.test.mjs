import assert from 'node:assert/strict';
import test from 'node:test';

import { BotAI } from '../src/entities/Bot.js';
import { RuleBasedBotPolicy } from '../src/entities/ai/RuleBasedBotPolicy.js';
import { decideSteering } from '../src/entities/ai/BotDecisionOps.js';
import { createRuntimeRng } from '../src/shared/contracts/RuntimeRngContract.js';

test('BotAI binds the seeded runtime rng handed in through its options', () => {
    const runtimeRng = createRuntimeRng({ seed: 4711 });
    const bot = new BotAI({ runtimeRng });

    assert.equal(bot._random, runtimeRng.next);
});

test('BotAI falls back to the global rng when no seeded one is supplied', () => {
    assert.equal(new BotAI({})._random, Math.random);
    assert.equal(new BotAI({ runtimeRng: { next: 'not-a-function' } })._random, Math.random);
});

test('RuleBasedBotPolicy passes the seeded rng down to its BotAI', () => {
    const runtimeRng = createRuntimeRng({ seed: 4711 });
    const policy = new RuleBasedBotPolicy({ runtimeRng });

    assert.equal(policy._botAI._random, runtimeRng.next);
});

test('the sensor runtime carries the bound rng, because the probe ops receive it as bot', () => {
    const runtimeRng = createRuntimeRng({ seed: 4711 });
    const bot = new BotAI({ runtimeRng });

    bot._ensureSensorsRuntimeBound();
    assert.equal(bot.sensors._random, runtimeRng.next);
});

// Die Ops nehmen den Bot als ersten Parameter, deshalb reicht hier eine Attrappe
// mit genau den Feldern, die decideSteering ohne Sensorziel anfasst.
function createSteeringStub(random) {
    return {
        _random: random,
        _decision: { yaw: 0, pitch: 0, boost: false },
        sense: { bestProbe: null },
        entityRuntimeConfig: { GAMEPLAY: { PLANAR_MODE: true } },
    };
}

test('steering without a probe target draws its yaw from the seeded rng', () => {
    const originalRandom = Math.random;
    Math.random = () => {
        throw new Error('bot steering must not fall back to Math.random');
    };
    try {
        const first = [];
        const second = [];
        for (const sink of [first, second]) {
            const rng = createRuntimeRng({ seed: 90210 });
            const bot = createSteeringStub(rng.next);
            for (let i = 0; i < 24; i++) {
                decideSteering(bot, null);
                sink.push(bot._decision.yaw);
            }
        }
        assert.deepEqual(second, first);
        assert.ok(first.includes(1) && first.includes(-1), 'expected both yaw directions to occur');
    } finally {
        Math.random = originalRandom;
    }
});

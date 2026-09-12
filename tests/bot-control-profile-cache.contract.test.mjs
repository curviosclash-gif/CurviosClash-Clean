import test from 'node:test';
import assert from 'node:assert/strict';

import { createBotRuntimeContext } from '../src/entities/ai/BotRuntimeContextFactory.js';

// The control profile ids are template strings over speed, turn rate and the ramp rates, and they
// decide whether a bot policy is allowed to use input ramps. They are built once per bot and
// simulation step, so they are cached - which is only safe as long as a changed control value still
// produces a new id.
function createEntityManager() {
    return {
        players: [],
        projectiles: [],
        powerupManager: { items: [] },
        arena: null,
        runtimeConfig: { bot: {} },
        huntEnabled: false,
        botDifficulty: 'NORMAL',
    };
}

function createBot(overrides = {}) {
    return {
        index: 0,
        isBot: true,
        baseSpeed: 18,
        turnSpeed: 2.2,
        rollSpeed: 2,
        ...overrides,
    };
}

test('a repeated call keeps the same control profile id', () => {
    const entityManager = createEntityManager();
    const player = createBot();
    const first = createBotRuntimeContext(entityManager, player, 1 / 60).rampControlProfileId;
    const second = createBotRuntimeContext(entityManager, player, 1 / 60).rampControlProfileId;

    assert.ok(first.length > 0, 'a bot always has a control profile id');
    assert.equal(second, first);
});

test('a changed control value produces a new control profile id', () => {
    const entityManager = createEntityManager();
    const player = createBot();
    const before = createBotRuntimeContext(entityManager, player, 1 / 60);
    const beforeRamp = before.rampControlProfileId;
    const beforeLegacy = before.legacyControlProfileId;

    player.baseSpeed = 24;
    const after = createBotRuntimeContext(entityManager, player, 1 / 60);

    assert.notEqual(after.rampControlProfileId, beforeRamp, 'the cached id must not survive a speed change');
    assert.notEqual(after.legacyControlProfileId, beforeLegacy);
    assert.ok(after.rampControlProfileId.includes('s24'), 'the id carries the new speed');
    assert.equal(after.controlDynamics.speed, 24);

    // The factory hands out the same context object per player on purpose, so ids have to be read
    // as strings before the next call overwrites them.
    const afterSpeedRamp = after.rampControlProfileId;
    player.turnSpeed = 3.4;
    const afterTurn = createBotRuntimeContext(entityManager, player, 1 / 60);
    assert.notEqual(afterTurn.rampControlProfileId, afterSpeedRamp, 'a turn rate change also invalidates it');
    assert.equal(afterTurn.controlDynamics.turnSpeed, 3.4);
});

test('two bots keep their own control profile ids', () => {
    const entityManager = createEntityManager();
    const slow = createBot({ index: 0, baseSpeed: 12 });
    const fast = createBot({ index: 1, baseSpeed: 30 });

    const slowId = createBotRuntimeContext(entityManager, slow, 1 / 60).rampControlProfileId;
    const fastId = createBotRuntimeContext(entityManager, fast, 1 / 60).rampControlProfileId;
    const slowAgain = createBotRuntimeContext(entityManager, slow, 1 / 60).rampControlProfileId;

    assert.notEqual(fastId, slowId, 'a shared cache would hand the second bot the first bot profile');
    assert.equal(slowAgain, slowId);
});

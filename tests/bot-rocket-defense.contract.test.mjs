import assert from 'node:assert/strict';
import test from 'node:test';

import {
    ROCKET_DEFENSE_MAX_DISTANCE,
    ROCKET_DEFENSE_MAX_TIME_TO_IMPACT,
    ROCKET_DEFENSE_MEMORY_SIZE,
    ROCKET_DEFENSE_MIN_DISTANCE,
    applyRocketDefenseDecision,
    createRocketDefenseMemory,
    resetRocketDefenseMemory,
    shouldBotDefendWithRocket,
} from '../src/entities/ai/BotRocketDefenseOps.js';
import { BotAI } from '../src/entities/Bot.js';
import { decideItemUsage } from '../src/entities/ai/BotDecisionOps.js';
import { applyDecisionToInput } from '../src/entities/ai/BotActionOps.js';
import { sanitizeBotAction } from '../src/entities/ai/actions/BotActionContract.js';
import { BOT_ITEM_RULES } from '../src/entities/ai/BotTuningConfig.js';

// Der Tracker liefert pro Spieler genau einen Eintrag; hier reicht ein fester.
function createThreat(overrides = {}) {
    return {
        active: true,
        count: 1,
        nearestDistance: 40,
        timeToImpactSeconds: 1.2,
        direction: { x: 0, y: 0, z: 0 },
        nearestProjectileId: 'projectile:7',
        nearestSource: 'player',
        nearestInterceptableId: 'projectile:7',
        nearestInterceptableDistance: 40,
        ...overrides,
    };
}

function createPlayer(options = {}) {
    const threat = options.threat === null ? null : createThreat(options.threat || {});
    const player = {
        index: Number.isInteger(options.index) ? options.index : 1,
        alive: options.alive !== false,
        shootCooldown: Number.isFinite(options.shootCooldown) ? options.shootCooldown : 0,
        inventory: Array.isArray(options.inventory) ? options.inventory : [],
        rocketInventory: Array.isArray(options.rocketInventory) ? options.rocketInventory : ['ROCKET_WEAK'],
        entityManager: null,
    };
    player.threatCalls = 0;
    if (options.withoutSystem !== true) {
        player.entityManager = {
            _projectileSystem: options.withoutTracker === true
                ? {}
                : {
                    getRocketThreat(playerIndex) {
                        player.threatCalls += 1;
                        return playerIndex === player.index ? threat : null;
                    },
                },
        };
    }
    return player;
}

function createBot(options = {}) {
    return {
        _random: typeof options.random === 'function' ? options.random : () => 0,
        _recentBouncePressure: 0,
        profile: {
            projectileAwareness: Number.isFinite(options.awareness) ? options.awareness : 1,
            aggression: 0.4,
            survivalBias: 0.6,
            itemContextWeight: 0.5,
            itemUseCooldown: 1,
            itemShootCooldown: 0.6,
        },
        sense: {
            pressure: 0,
            mapAggressionBias: 0,
            targetInFront: false,
            targetDistanceSq: 900,
            immediateDanger: false,
            forwardRisk: 0,
        },
        state: {
            itemUseCooldown: 0,
            itemShootCooldown: 0,
        },
        _decision: {
            yaw: 0,
            pitch: 0,
            boost: false,
            useItem: -1,
            shootItem: false,
            shootRocket: false,
            shootItemIndex: -1,
        },
    };
}

test('a threatened bot with a rocket and full awareness presses the rocket key', () => {
    const bot = createBot({ awareness: 1 });
    const player = createPlayer();

    assert.equal(shouldBotDefendWithRocket(bot, player), true);
    assert.equal(player.threatCalls, 1, 'the tracker is asked once per tick');
});

test('a bot without a rocket never defends and keeps its usual item behaviour', () => {
    const bot = createBot({ awareness: 1 });
    const player = createPlayer({ rocketInventory: [], inventory: ['SHIELD'] });
    bot.sense.pressure = 1;

    assert.equal(shouldBotDefendWithRocket(bot, player), false);

    decideItemUsage(bot, player, BOT_ITEM_RULES);
    assert.equal(bot._decision.shootRocket, false);
    assert.equal(bot._decision.useItem, 0, 'the shield is still used under pressure');
});

test('a rocket that cannot be shot down (exclusion zone) never triggers a defence shot', () => {
    const bot = createBot({ awareness: 1 });
    const player = createPlayer({
        threat: { nearestInterceptableId: '', nearestInterceptableDistance: 0, nearestSource: 'zone' },
    });

    assert.equal(shouldBotDefendWithRocket(bot, player), false);
});

test('a running shot cooldown blocks the defence shot', () => {
    const bot = createBot({ awareness: 1 });
    const player = createPlayer({ shootCooldown: 0.4 });

    assert.equal(shouldBotDefendWithRocket(bot, player), false);
});

test('a dead bot never defends', () => {
    const bot = createBot({ awareness: 1 });
    const player = createPlayer({ alive: false });

    assert.equal(shouldBotDefendWithRocket(bot, player), false);
});

test('a rocket that is too far away or already too close is left alone', () => {
    const tooFar = createPlayer({
        threat: {
            nearestDistance: ROCKET_DEFENSE_MAX_DISTANCE + 40,
            nearestInterceptableDistance: ROCKET_DEFENSE_MAX_DISTANCE + 40,
            timeToImpactSeconds: ROCKET_DEFENSE_MAX_TIME_TO_IMPACT + 2,
        },
    });
    assert.equal(shouldBotDefendWithRocket(createBot({ awareness: 1 }), tooFar), false);

    const tooClose = createPlayer({
        threat: {
            nearestDistance: ROCKET_DEFENSE_MIN_DISTANCE - 2,
            nearestInterceptableDistance: ROCKET_DEFENSE_MIN_DISTANCE - 2,
            timeToImpactSeconds: 0.1,
        },
    });
    assert.equal(shouldBotDefendWithRocket(createBot({ awareness: 1 }), tooClose), false);

    // Weit weg, aber schnell unterwegs: das Zeitfenster zaehlt genauso.
    const fastAndFar = createPlayer({
        threat: {
            nearestDistance: ROCKET_DEFENSE_MAX_DISTANCE + 40,
            nearestInterceptableDistance: ROCKET_DEFENSE_MAX_DISTANCE + 40,
            timeToImpactSeconds: 1.5,
        },
    });
    assert.equal(shouldBotDefendWithRocket(createBot({ awareness: 1 }), fastAndFar), true);
});

test('awareness zero never defends, no matter how many ticks pass', () => {
    let draws = 0;
    const bot = createBot({
        awareness: 0,
        random: () => {
            draws += 1;
            return 0;
        },
    });
    const player = createPlayer();

    for (let tick = 0; tick < 25; tick += 1) {
        assert.equal(shouldBotDefendWithRocket(bot, player), false);
    }
    assert.equal(draws, 0, 'an unaware bot does not even roll the dice');
});

test('half awareness decides once per rocket and keeps that answer', () => {
    let draws = 0;
    const bot = createBot({
        awareness: 0.5,
        random: () => {
            draws += 1;
            return draws === 1 ? 0.25 : 0.75;
        },
    });
    const yesPlayer = createPlayer();

    for (let tick = 0; tick < 20; tick += 1) {
        assert.equal(shouldBotDefendWithRocket(bot, yesPlayer), true);
    }
    assert.equal(draws, 1, 'the same rocket is judged exactly once');

    const noPlayer = createPlayer({
        threat: { nearestProjectileId: 'projectile:9', nearestInterceptableId: 'projectile:9' },
    });
    for (let tick = 0; tick < 20; tick += 1) {
        assert.equal(shouldBotDefendWithRocket(bot, noPlayer), false);
    }
    assert.equal(draws, 2, 'a new rocket gets its own single decision');
});

test('the defence memory stays small and can be emptied again', () => {
    const bot = createBot({ awareness: 0.5, random: () => 0 });
    for (let i = 0; i < 40; i += 1) {
        const player = createPlayer({
            threat: {
                nearestProjectileId: `projectile:${i}`,
                nearestInterceptableId: `projectile:${i}`,
            },
        });
        shouldBotDefendWithRocket(bot, player);
    }

    const memory = bot._rocketDefenseMemory;
    assert.equal(memory.ids.length, ROCKET_DEFENSE_MEMORY_SIZE);
    assert.equal(memory.answers.length, ROCKET_DEFENSE_MEMORY_SIZE);

    resetRocketDefenseMemory(memory);
    assert.deepEqual(memory.ids, new Array(ROCKET_DEFENSE_MEMORY_SIZE).fill(''));
    assert.deepEqual(memory.answers, new Array(ROCKET_DEFENSE_MEMORY_SIZE).fill(false));
    assert.equal(memory.next, 0);

    const fresh = createRocketDefenseMemory();
    assert.equal(fresh.ids.length, ROCKET_DEFENSE_MEMORY_SIZE);
    assert.equal(fresh.next, 0);
});

test('a real bot brings the memory along and empties it on a difficulty reset', () => {
    const bot = new BotAI({});
    const memory = bot._rocketDefenseMemory;

    assert.equal(memory.ids.length, ROCKET_DEFENSE_MEMORY_SIZE);
    memory.ids[0] = 'projectile:1';
    memory.answers[0] = true;
    memory.next = 1;

    bot.setDifficulty('HARD');
    assert.equal(bot._rocketDefenseMemory, memory, 'the ring is reused, not replaced');
    assert.equal(memory.ids[0], '');
    assert.equal(memory.answers[0], false);
    assert.equal(memory.next, 0);
});

test('a match without a projectile system neither throws nor shoots', () => {
    const bot = createBot({ awareness: 1 });
    assert.equal(shouldBotDefendWithRocket(bot, createPlayer({ withoutSystem: true })), false);
    assert.equal(shouldBotDefendWithRocket(bot, createPlayer({ withoutTracker: true })), false);
    assert.equal(shouldBotDefendWithRocket(bot, createPlayer({ threat: null })), false);
    assert.equal(shouldBotDefendWithRocket(bot, createPlayer({ threat: { active: false } })), false);
    assert.equal(shouldBotDefendWithRocket(bot, null), false);
    assert.equal(shouldBotDefendWithRocket(null, createPlayer()), false);
});

test('the decision reaches the bot input and survives the action contract', () => {
    const bot = createBot({ awareness: 1 });
    const player = createPlayer();

    assert.equal(applyRocketDefenseDecision(bot, player), true);
    assert.equal(bot._decision.shootRocket, true);

    bot.currentInput = {};
    bot._resetInput = (input) => {
        input.shootRocket = false;
        input.shootItem = false;
        input.shootItemIndex = -1;
        input.useItem = -1;
        input.boost = false;
        input.yawLeft = false;
        input.yawRight = false;
        input.pitchUp = false;
        input.pitchDown = false;
    };
    const input = applyDecisionToInput(bot);
    assert.equal(input.shootRocket, true);

    const sanitized = sanitizeBotAction(input, { inventoryLength: 0 });
    assert.equal(sanitized.shootRocket, true, 'the contract lets the defence shot through');
});

test('the item decision fires the rocket key when a rocket is chasing the bot', () => {
    const bot = createBot({ awareness: 1 });
    const player = createPlayer({ inventory: ['SHIELD'] });
    bot.sense.pressure = 1;

    decideItemUsage(bot, player, BOT_ITEM_RULES);

    assert.equal(bot._decision.shootRocket, true, 'defending beats using an item this tick');
    assert.equal(bot._decision.useItem, -1);
    assert.equal(bot._decision.shootItem, false);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';

/**
 * Steht für Player: nur die Felder, die die Arcade-Strategie beim Spawn und beim
 * Zurücksetzen der Lebenspunkte anfasst. isBot ist der einzige Unterschied zwischen
 * dem Menschen und seinen Gegnern -- und damit die Grenze, an der ein im Hangar
 * gekaufter Bonus haltmachen muss.
 */
function createPlayer({ isBot }) {
    return {
        isBot,
        alive: true,
        hp: 0,
        maxHp: 0,
        baseSpeed: 18,
        speed: 18,
        hasShield: false,
        shieldHP: 0,
        maxShieldHp: 0,
        shieldHitFeedback: 0,
        lastDamageTimestamp: 0,
    };
}

/** Ein Build mit zwei Bollwerksteinen und einem Flügelpaar, wie ihn der Hangar liefert. */
const HANGAR_BONUSES = Object.freeze({ maxHpBonus: 12, speedBonusPct: 10, turningBonusPct: 6 });

function createStrategy() {
    const strategy = new ArcadeModeStrategy({ nowMs: () => 1_000_000, random: () => 0.5 });
    strategy.applyVehicleUpgrades({ ...HANGAR_BONUSES });
    return strategy;
}

test('the hangar health bonus reaches the player and not the bots', () => {
    const strategy = createStrategy();
    const human = createPlayer({ isBot: false });
    const bot = createPlayer({ isBot: true });

    strategy.resetPlayerHealth(human);
    strategy.resetPlayerHealth(bot);

    assert.equal(human.maxHp, 112, 'the player carries the +12 from two gold stones');
    assert.equal(bot.maxHp, 100, 'the bot stays on the base health pool');
});

test('the hangar speed bonus reaches the player and not the bots', () => {
    const strategy = createStrategy();
    const human = createPlayer({ isBot: false });
    const bot = createPlayer({ isBot: true });

    strategy.applySpawnStatBonuses(human);
    strategy.applySpawnStatBonuses(bot);

    assert.equal(Math.round(human.baseSpeed * 100) / 100, 19.8, 'the player flies 10 percent faster');
    assert.equal(bot.baseSpeed, 18, 'the bot keeps its stock speed');
});

test('the hangar turn bonus reaches the player and not the bots', () => {
    const strategy = createStrategy();

    const humanTurn = strategy.getTurnRateMultiplier(createPlayer({ isBot: false }));
    const botTurn = strategy.getTurnRateMultiplier(createPlayer({ isBot: true }));

    assert.equal(Math.round(humanTurn * 100) / 100, 1.06, 'the player turns 6 percent faster');
    assert.equal(botTurn, 1, 'the bot turns at the stock rate');
});

test('without a known player the bonus still applies, so existing callers keep working', () => {
    const strategy = createStrategy();
    assert.equal(
        Math.round(strategy.getTurnRateMultiplier() * 100) / 100,
        1.06,
        'a call without a player keeps the previous behaviour'
    );
});

test('a run without hangar upgrades leaves everyone on the base values', () => {
    const strategy = new ArcadeModeStrategy({ nowMs: () => 1_000_000, random: () => 0.5 });
    const human = createPlayer({ isBot: false });
    const bot = createPlayer({ isBot: true });

    strategy.resetPlayerHealth(human);
    strategy.resetPlayerHealth(bot);
    strategy.applySpawnStatBonuses(human);
    strategy.applySpawnStatBonuses(bot);

    assert.equal(human.maxHp, 100, 'no upgrades means no extra health for the player');
    assert.equal(bot.maxHp, 100, 'and none for the bot either');
    assert.equal(human.baseSpeed, 18, 'and no extra speed');
    assert.equal(bot.baseSpeed, 18, 'for either side');
});

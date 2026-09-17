import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decideItemUsage } from '../src/entities/ai/BotDecisionOps.js';

// Moved from tests/physics-policy.spec.js (P3): the test builds its bot, player
// and item rules by hand, so the decision ops run without a match.

function createBot(senseOverrides = {}) {
    return {
        profile: {
            aggression: 0.4,
            itemContextWeight: 0.6,
            itemUseCooldown: 1.0,
            itemShootCooldown: 0.5,
        },
        sense: {
            pressure: 0.2,
            mapAggressionBias: 0,
            targetInFront: true,
            targetDistanceSq: 400,
            immediateDanger: false,
            forwardRisk: 0.1,
            ...senseOverrides,
        },
        state: {
            itemUseCooldown: 0,
            itemShootCooldown: 0,
        },
        _decision: {
            useItem: -1,
            shootItem: false,
            shootItemIndex: -1,
        },
    };
}

test('T78f: BotDecisionOps trennt Shield-Selbstnutzung von Rocket-Offensivfenster ueber Shield-Ratio', () => {
    const itemRules = {
        SHIELD: { self: 0.72, offense: 0.02, defensiveScale: 0.28, emergencyScale: 0.52, combatSelf: 0.2 },
        ROCKET_HEAVY: { self: 0.06, offense: 0.48, defensiveScale: 0.02, emergencyScale: 0.06, combatSelf: 0 },
    };

    const saturatedBot = createBot({
        pressure: 0.24,
        targetDistanceSq: 420,
        immediateDanger: false,
        forwardRisk: 0.12,
    });
    const saturatedPlayer = {
        maxHp: 100,
        hp: 92,
        maxShieldHp: 40,
        shieldHP: 40,
        inventory: ['SHIELD', 'ROCKET_HEAVY'],
    };
    decideItemUsage(saturatedBot, saturatedPlayer, itemRules);

    const depletedBot = createBot({
        pressure: 0.9,
        targetDistanceSq: 64,
        immediateDanger: true,
        forwardRisk: 0.92,
    });
    const depletedPlayer = {
        maxHp: 100,
        hp: 24,
        maxShieldHp: 40,
        shieldHP: 0,
        inventory: ['SHIELD', 'ROCKET_HEAVY'],
    };
    decideItemUsage(depletedBot, depletedPlayer, itemRules);

    const result = {
        saturated: {
            useItem: Number(saturatedBot._decision.useItem),
            shootItem: !!saturatedBot._decision.shootItem,
            shootItemIndex: Number(saturatedBot._decision.shootItemIndex),
        },
        depleted: {
            useItem: Number(depletedBot._decision.useItem),
            shootItem: !!depletedBot._decision.shootItem,
            shootItemIndex: Number(depletedBot._decision.shootItemIndex),
        },
    };

    assert.strictEqual(result.saturated.useItem, -1);
    assert.ok(result.saturated.shootItem);
    assert.strictEqual(result.saturated.shootItemIndex, 1);

    assert.strictEqual(result.depleted.useItem, 0);
    assert.ok(!result.depleted.shootItem);
    assert.strictEqual(result.depleted.shootItemIndex, -1);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';

// Player.update hands the EntityManager to updateHealthRegen; the configured regen values
// must arrive through it instead of the hard-coded fallbacks.
function createEntityManagerLike(hunt) {
    return {
        runtimeConfig: null,
        entityRuntimeConfig: { HUNT: { PLAYER_MAX_HP: 100, ...hunt } },
        _simulationClockMs: 20_000,
    };
}

test('hunt regeneration reads the configured rate through the entity manager', () => {
    const strategy = new HuntModeStrategy();
    const entityManager = createEntityManagerLike({ PLAYER_REGEN_DELAY: 1, PLAYER_REGEN_PER_SECOND: 7 });
    const player = { hp: 50, maxHp: 100, lastDamageTimestamp: 0 };

    strategy.updateHealthRegen(player, 1, entityManager);

    assert.equal(player.hp, 57, 'a configured 7 HP/s must not fall back to the built-in 2.5 HP/s');
});

test('hunt regeneration honours the configured delay through the entity manager', () => {
    const strategy = new HuntModeStrategy();
    const entityManager = createEntityManagerLike({ PLAYER_REGEN_DELAY: 30, PLAYER_REGEN_PER_SECOND: 7 });
    const player = { hp: 50, maxHp: 100, lastDamageTimestamp: 0 };

    strategy.updateHealthRegen(player, 1, entityManager);

    assert.equal(player.hp, 50, 'a configured 30 s delay must not fall back to the built-in 3 s');
});

test('the shipped hunt default keeps the regeneration players had so far', () => {
    // Until now the fallback 3 s / 2.5 HP/s was what matches actually used.
    assert.equal(HUNT_CONFIG.PLAYER_REGEN_DELAY, 3);
    assert.equal(HUNT_CONFIG.PLAYER_REGEN_PER_SECOND, 2.5);
});

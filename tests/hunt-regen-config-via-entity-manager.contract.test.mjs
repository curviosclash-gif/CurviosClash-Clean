import assert from 'node:assert/strict';
import test from 'node:test';

import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';
import { DEFAULT_ENTITY_RUNTIME_CONFIG } from '../src/shared/contracts/EntityRuntimeConfig.js';

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
    entityManager.gameModeStrategy = strategy;
    const player = { hp: 50, maxHp: 100, lastDamageTimestamp: 0 };
    let healingCalls = 0;
    const applyHealing = strategy.applyHealing.bind(strategy);
    strategy.applyHealing = (...args) => {
        healingCalls += 1;
        return applyHealing(...args);
    };

    strategy.updateHealthRegen(player, 1, entityManager);

    assert.equal(player.hp, 57, 'a configured 7 HP/s must not fall back to the built-in 2.5 HP/s');
    assert.equal(healingCalls, 1, 'one positive regen amount crosses the shared healing boundary once');
});

test('hunt regeneration honours the configured delay through the entity manager', () => {
    const strategy = new HuntModeStrategy();
    const entityManager = createEntityManagerLike({ PLAYER_REGEN_DELAY: 30, PLAYER_REGEN_PER_SECOND: 7 });
    entityManager.gameModeStrategy = strategy;
    const player = { hp: 50, maxHp: 100, lastDamageTimestamp: 0 };

    strategy.updateHealthRegen(player, 1, entityManager);

    assert.equal(player.hp, 50, 'a configured 30 s delay must not fall back to the built-in 3 s');
});

test('the shipped hunt default keeps the regeneration players had so far', () => {
    // Until now the fallback 3 s / 2.5 HP/s was what matches actually used.
    assert.equal(HUNT_CONFIG.PLAYER_REGEN_DELAY, 3);
    assert.equal(HUNT_CONFIG.PLAYER_REGEN_PER_SECOND, 2.5);
});

test('standalone Hunt regeneration retains its explicit strategy config and shared dead/invulnerable guards', () => {
    const config = {
        ...DEFAULT_ENTITY_RUNTIME_CONFIG,
        HUNT: {
            ...DEFAULT_ENTITY_RUNTIME_CONFIG.HUNT,
            ENABLED: true,
            ACTIVE_MODE: 'HUNT',
            PLAYER_MAX_HP: 180,
            PLAYER_REGEN_DELAY: 1,
            PLAYER_REGEN_PER_SECOND: 7,
        },
    };
    const strategy = new HuntModeStrategy({ entityRuntimeConfig: config });
    const player = { hp: 170, lastDamageTimestamp: 0 };
    strategy.updateHealthRegen(player, 1, { _simulationClockMs: 20_000 });
    assert.equal(player.hp, 177, 'standalone regen uses the strategy config and does not fall back to HP 100');

    const dead = { alive: false, hp: 50, maxHp: 100, lastDamageTimestamp: 0 };
    strategy.updateHealthRegen(dead, 1, { _simulationClockMs: 20_000 });
    assert.equal(dead.hp, 50, 'the shared heal boundary blocks a dead player even with stale positive HP');

    const invulnerable = { alive: true, invulnerable: true, hp: 50, maxHp: 100, lastDamageTimestamp: 0 };
    strategy.updateHealthRegen(invulnerable, 1, { _simulationClockMs: 20_000 });
    assert.equal(invulnerable.hp, 50, 'the shared heal boundary preserves invulnerability policy');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG_BASE } from '../src/core/Config.js';
import { createEntityRuntimeSupport } from '../src/entities/runtime/EntityRuntimeSupportAssembly.js';
import { applyDamage, updatePlayerHealthRegen } from '../src/hunt/HealthSystem.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { createEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';

function useWallClock(t, startMs) {
    const originalPerformanceNow = performance.now;
    const originalDateNow = Date.now;
    const wall = { ms: startMs };
    performance.now = () => wall.ms;
    Date.now = () => wall.ms;
    t.after(() => {
        performance.now = originalPerformanceNow;
        Date.now = originalDateNow;
    });
    return wall;
}

function createHuntConfig() {
    const config = createEntityRuntimeConfig(null, CONFIG_BASE);
    config.HUNT.ENABLED = true;
    config.HUNT.ACTIVE_MODE = 'HUNT';
    config.HUNT.PLAYER_REGEN_DELAY = 3;
    config.HUNT.PLAYER_REGEN_PER_SECOND = 2.5;
    return config;
}

function createPlayer(simulationClockMs) {
    return { entityManager: { _simulationClockMs: simulationClockMs }, hp: 100, maxHp: 100, shieldHP: 0, hasShield: false };
}

test('strategy regeneration without a manager config waits for match time, even across pauses', (t) => {
    const wall = useWallClock(t, 5_000_000);
    const config = createHuntConfig();
    const strategy = new HuntModeStrategy({ entityRuntimeConfig: config, seed: 1 });
    const player = createPlayer(20_000);
    strategy.applyDamage(player, 30, undefined, config);
    assert.equal(player.lastDamageTimestamp, 20);
    wall.ms += 100_000;
    player.entityManager._simulationClockMs += 1000;
    strategy.updateHealthRegen(player, 1, config);
    assert.equal(player.hp, 70, 'a pause does not consume the regeneration delay');
    player.entityManager._simulationClockMs += 3000;
    strategy.updateHealthRegen(player, 1, config);
    assert.equal(player.hp, 72.5);
});

test('health fallback stamps implicit damage and regeneration on the same match clock', (t) => {
    const wall = useWallClock(t, 1_000_000);
    const config = createHuntConfig();
    const player = createPlayer(20_000);
    applyDamage(player, 30, {}, config);
    assert.equal(player.lastDamageTimestamp, 20);
    wall.ms += 100_000;
    player.entityManager._simulationClockMs += 1000;
    updatePlayerHealthRegen(player, 1, config);
    assert.equal(player.hp, 70);
    player.entityManager._simulationClockMs += 3000;
    updatePlayerHealthRegen(player, 1, config);
    assert.equal(player.hp, 72.5);
});

test('health fallback preserves explicit timestamps and supports callers without a match clock', (t) => {
    const wall = useWallClock(t, 10_000);
    const config = createHuntConfig();
    const player = createPlayer(undefined);
    applyDamage(player, 30, {}, config);
    assert.equal(player.lastDamageTimestamp, 10);
    wall.ms = 14_000;
    updatePlayerHealthRegen(player, 1, config);
    assert.equal(player.hp, 72.5);
    player.entityManager._simulationClockMs = 0;
    applyDamage(player, 10, { nowSeconds: 30 }, config);
    assert.equal(player.lastDamageTimestamp, 30);
    updatePlayerHealthRegen(player, 1, config, 31);
    assert.equal(player.hp, 62.5);
    updatePlayerHealthRegen(player, 1, config, 34);
    assert.equal(player.hp, 65);
});

test('runtime scoring keeps assist eligibility during pauses and expires it after match time', (t) => {
    const wall = useWallClock(t, 2_000_000);
    const owner = { entityRuntimeConfig: createHuntConfig(), players: [], renderer: null, _simulationClockMs: 10_000 };
    const { huntScoring } = createEntityRuntimeSupport(owner);
    const attacker = { index: 0 };
    const killer = { index: 2 };
    const target = { index: 1, maxHp: 100, maxShieldHp: 0 };
    huntScoring.registerDamage(attacker, target, { applied: 20, hpApplied: 20 });
    wall.ms += 100_000;
    assert.deepEqual(huntScoring.getDamageHistoryAges(1), [{ attackerIndex: 0, ageSeconds: 0 }]);
    owner._simulationClockMs = 17_000;
    assert.deepEqual(huntScoring.registerElimination(target, { killer }).assistIndices, [0]);
    huntScoring.registerDamage(attacker, target, { applied: 20, hpApplied: 20 });
    owner._simulationClockMs = 26_000;
    assert.deepEqual(huntScoring.getDamageHistoryAges(1), [{ attackerIndex: 0, ageSeconds: 9 }]);
    assert.deepEqual(huntScoring.registerElimination(target, { killer }).assistIndices, []);
});

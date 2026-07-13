import assert from 'node:assert/strict';
import test from 'node:test';

import { GameModeContract } from '../src/modes/GameModeContract.js';
import { ClassicModeStrategy } from '../src/modes/ClassicModeStrategy.js';
import { createGameModeStrategy, registerGameModeStrategy } from '../src/modes/GameModeRegistry.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { isRocketTierType, normalizeRocketPickupType, pickWeightedRocketTierType } from '../src/hunt/RocketPickupSystem.js';
import { createRuntimeRng } from '../src/shared/contracts/RuntimeRngContract.js';

test('GameModeRegistry resolves classic fallback and hunt mode deterministically', () => {
    assert.equal(createGameModeStrategy('UNKNOWN_MODE').modeType, 'CLASSIC');
    assert.equal(createGameModeStrategy('classic').modeType, 'CLASSIC');
    assert.equal(createGameModeStrategy('HUNT').modeType, 'HUNT');
});

test('ClassicModeStrategy exposes the legacy instant-kill feature flags', () => {
    const strategy = new ClassicModeStrategy();
    assert.equal(strategy.requiresShootItemIndex(), false);
    assert.equal(strategy.hasMachineGun(), false);
    assert.equal(strategy.isRespawnEnabled(), false);
    assert.equal(strategy.hasScoring(), false);
    assert.equal(strategy.hasDamageEvents(), false);
    assert.equal(strategy.hasDestructibleTrails(), false);
    assert.equal(strategy.isHudVisible(), false);
});

test('HuntModeStrategy exposes the hunt feature flags', () => {
    const strategy = new HuntModeStrategy();
    assert.equal(strategy.requiresShootItemIndex(), true);
    assert.equal(strategy.hasMachineGun(), true);
    assert.equal(strategy.hasScoring(), true);
    assert.equal(strategy.hasDamageEvents(), true);
    assert.equal(strategy.hasDestructibleTrails(), true);
    assert.equal(strategy.isHudVisible(), true);
});

test('Classic and hunt strategies reset health and apply damage as expected', () => {
    const classic = new ClassicModeStrategy();
    const hunt = new HuntModeStrategy();

    const classicPlayer = { hasShield: true, maxHp: 0, hp: 0, maxShieldHp: 0, shieldHP: 0, lastDamageTimestamp: 0, shieldHitFeedback: 0 };
    classic.resetPlayerHealth(classicPlayer);
    assert.equal(classicPlayer.maxHp, 1);
    assert.equal(classicPlayer.hp, 1);
    assert.equal(classicPlayer.shieldHP, 1);
    const classicDamage = classic.applyDamage({ maxHp: 1, hp: 1, shieldHP: 0, hasShield: false, lastDamageTimestamp: 0 }, 1, {});
    assert.equal(classicDamage.isDead, true);
    assert.equal(classicDamage.remainingHp, 0);

    const huntPlayer = { hasShield: true, maxHp: 0, hp: 0, maxShieldHp: 0, shieldHP: 0, lastDamageTimestamp: 0, shieldHitFeedback: 0 };
    hunt.resetPlayerHealth(huntPlayer);
    assert.equal(huntPlayer.maxHp, 100);
    assert.equal(huntPlayer.hp, 100);
    assert.equal(huntPlayer.shieldHP, 40);
    const huntDamage = hunt.applyDamage(
        { maxHp: 100, hp: 100, maxShieldHp: 40, shieldHP: 40, hasShield: true, shieldHitFeedback: 0, lastDamageTimestamp: 0 },
        30,
        {}
    );
    assert.equal(huntDamage.isDead, false);
    assert.equal(huntDamage.absorbedByShield, 30);
    assert.equal(huntDamage.remainingHp, 100);
});

test('Projectile, collision and shield contracts stay stable across strategies', () => {
    const classic = new ClassicModeStrategy();
    const hunt = new HuntModeStrategy();
    const classicShieldPlayer = { hasShield: false, maxShieldHp: 0, shieldHP: 0, shieldHitFeedback: 0 };
    const huntShieldPlayer = { hasShield: false, maxShieldHp: 0, shieldHP: 0, shieldHitFeedback: 0 };

    assert.equal(classic.resolveCollisionDamage('WALL'), 1);
    assert.equal(classic.resolveCollisionDamage('TRAIL'), 1);
    assert.equal(classic.resolveRocketProjectileParams('ROCKET_WEAK'), null);
    assert.equal(classic.grantShield(classicShieldPlayer), 1);
    assert.equal(classicShieldPlayer.shieldHP, 1);

    const params = hunt.resolveRocketProjectileParams('ROCKET_WEAK');
    assert.ok(params);
    assert.ok(params.visualScale > 0);
    assert.equal(hunt.resolveRocketProjectileParams('SPEED_UP'), null);
    assert.equal(hunt.grantShield(huntShieldPlayer), 40);
    assert.equal(huntShieldPlayer.shieldHP, 40);
});

test('Rocket pickup normalization, weighted selection and allowlists stay deterministic', () => {
    const strong = normalizeRocketPickupType('ROCKET_STRONG');
    const weak = normalizeRocketPickupType('rocket');
    assert.equal(strong, 'ROCKET_HEAVY');
    assert.equal(weak, 'ROCKET_WEAK');
    assert.equal(isRocketTierType(strong), true);
    assert.equal(isRocketTierType(weak), true);

    const fallback = pickWeightedRocketTierType({
        allowedTypes: ['ROCKET_HEAVY', 'ROCKET_MEGA'],
        tiersConfig: {
            WEAK: { spawnChance: 0 },
            MEDIUM: { spawnChance: 0 },
            HEAVY: { spawnChance: 0 },
            MEGA: { spawnChance: 0 },
        },
        random: () => 0.97,
    });
    const weighted = pickWeightedRocketTierType({
        allowedTypes: ['ROCKET_HEAVY', 'ROCKET_MEGA'],
        tiersConfig: {
            HEAVY: { spawnChance: 0.2 },
            MEGA: { spawnChance: 0.8 },
        },
        random: () => 0.9,
    });

    assert.equal(fallback, 'ROCKET_HEAVY');
    assert.equal(weighted, 'ROCKET_MEGA');
});

test('HuntModeStrategy keeps spawn fallback and shield-hit regen delay robust', () => {
    const strategy = new HuntModeStrategy();
    const nonRocketFallback = strategy.resolveSpawnType(
        ['SHIELD', 'SPEED_UP', 'ROCKET_WEAK'],
        {
            HUNT: {
                ROCKET_PICKUP_SPAWN_CHANCE: 0,
                PICKUP_WEIGHTS: {
                    SHIELD: 0,
                    SPEED_UP: -4,
                },
            },
        }
    );
    const forcedRocket = strategy.resolveSpawnType(
        ['SPEED_UP', 'ROCKET_WEAK'],
        {
            HUNT: {
                ROCKET_PICKUP_SPAWN_CHANCE: 1,
                PICKUP_WEIGHTS: {
                    SPEED_UP: 10,
                },
                ROCKET_TIERS: {
                    WEAK: { spawnChance: 0 },
                    MEDIUM: { spawnChance: 0 },
                    HEAVY: { spawnChance: 0 },
                    MEGA: { spawnChance: 0 },
                },
            },
        }
    );
    assert.equal(nonRocketFallback, 'SHIELD');
    assert.equal(forcedRocket, 'ROCKET_WEAK');

    const player = {
        maxHp: 100,
        hp: 80,
        maxShieldHp: 40,
        shieldHP: 40,
        hasShield: true,
        shieldHitFeedback: 0,
        lastDamageTimestamp: -Infinity,
    };
    const config = {
        HUNT: {
            PLAYER_MAX_HP: 100,
            PLAYER_REGEN_DELAY: 3,
            PLAYER_REGEN_PER_SECOND: 2,
            SHIELD_MAX_HP: 40,
        },
    };

    const damage = strategy.applyDamage(player, 10, { nowSeconds: 10 }, config);
    strategy.updateHealthRegen(player, 1, config, 11.0);
    const hpAfterEarlyRegenTick = Number(player.hp || 0);
    strategy.updateHealthRegen(player, 1, config, 13.6);

    assert.ok(damage.absorbedByShield > 0);
    assert.equal(hpAfterEarlyRegenTick, 80);
    assert.ok(player.hp > 80);
    assert.equal(player.lastDamageTimestamp, 10);
});

test('B04 F5 hunt pickup distribution stays deterministic for equal runtime RNG seed', () => {
    const seed = 90210;
    const strategyA = new HuntModeStrategy({
        runtimeRng: createRuntimeRng({ seed }),
    });
    const strategyB = new HuntModeStrategy({
        runtimeRng: createRuntimeRng({ seed }),
    });
    const config = {
        HUNT: {
            ROCKET_PICKUP_SPAWN_CHANCE: 0.48,
            PICKUP_WEIGHTS: {
                SHIELD: 2.4,
                SPEED_UP: 0.6,
                GHOST: 1.2,
            },
            ROCKET_TIERS: {
                WEAK: { spawnChance: 0.42 },
                MEDIUM: { spawnChance: 0.31 },
                HEAVY: { spawnChance: 0.19 },
                MEGA: { spawnChance: 0.08 },
            },
        },
    };
    const spawnableTypes = ['SHIELD', 'SPEED_UP', 'GHOST', 'ROCKET_WEAK', 'ROCKET_MEDIUM', 'ROCKET_HEAVY', 'ROCKET_MEGA'];
    const picksA = [];
    const picksB = [];

    for (let index = 0; index < 64; index += 1) {
        picksA.push(strategyA.resolveSpawnType(spawnableTypes, config));
        picksB.push(strategyB.resolveSpawnType(spawnableTypes, config));
    }

    assert.deepEqual(picksA, picksB);
    assert.equal(picksA.some((type) => String(type || '').startsWith('ROCKET_')), true);
    assert.equal(picksA.some((type) => type === 'SHIELD' || type === 'SPEED_UP' || type === 'GHOST'), true);
});

test('registerGameModeStrategy supports targeted extensions without browser runtime', () => {
    class ArcadeTestModeStrategy extends GameModeContract {
        get modeType() {
            return 'ARCADE';
        }
    }

    registerGameModeStrategy('ARCADE_CONTRACT_TEST', () => new ArcadeTestModeStrategy());
    assert.equal(createGameModeStrategy('ARCADE_CONTRACT_TEST').modeType, 'ARCADE');
});

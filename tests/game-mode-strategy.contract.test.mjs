import assert from 'node:assert/strict';
import test from 'node:test';

import { GameModeContract } from '../src/modes/GameModeContract.js';
import { ClassicModeStrategy } from '../src/modes/ClassicModeStrategy.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { createGameModeStrategy, registerGameModeStrategy } from '../src/modes/GameModeRegistry.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';
import {
    getPickupTypes,
    isPickupTypeAllowedForMode,
    isRocketPickupType,
} from '../src/entities/PickupRegistry.js';
import {
    isRocketTierType,
    normalizeRocketPickupType,
    pickWeightedRocketTierType,
    resolveRocketTrailBlastMeters,
    resolveRocketTierDamage,
} from '../src/hunt/RocketPickupSystem.js';
import { createRuntimeRng } from '../src/shared/contracts/RuntimeRngContract.js';
import { CONFIG_BASE } from '../src/core/Config.js';

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

test('Fight enemy trail collisions kill and credit the trail owner', () => {
    const hunt = new HuntModeStrategy();
    const trailOwner = { index: 1 };
    const target = {
        index: 0,
        hp: 100,
        maxHp: 100,
        shieldHP: 40,
        maxShieldHp: 40,
        hasShield: true,
        shieldHitFeedback: 0,
        lastDamageTimestamp: 0,
        position: {},
        takeDamage(amount) {
            return hunt.applyDamage(this, amount, {});
        },
    };
    const kills = [];
    const damageEvents = [];
    const entityManager = {
        _emitHuntDamageEvent(event) {
            damageEvents.push(event);
        },
        _killPlayer(player, cause, options) {
            kills.push({ player, cause, killer: options?.killer || null });
        },
    };

    assert.equal(hunt.handleTrailCollision(
        target,
        { playerIndex: trailOwner.index },
        'TRAIL_OTHER',
        trailOwner,
        entityManager
    ), true);
    assert.equal(target.hp, 0);
    assert.equal(target.shieldHP, 0);
    assert.equal(damageEvents[0].sourcePlayer, trailOwner);
    assert.deepEqual(kills, [{ player: target, cause: 'TRAIL_OTHER', killer: trailOwner }]);
});

test('Fight rocket tiers use triple damage and trail destruction', () => {
    const fightConfig = { HUNT: HUNT_CONFIG };
    const rocketTypes = ['ROCKET_WEAK', 'ROCKET_MEDIUM', 'ROCKET_HEAVY', 'ROCKET_MEGA'];
    assert.deepEqual(rocketTypes.map((type) => resolveRocketTierDamage(type, fightConfig)), [30, 60, 120, 210]);
    assert.deepEqual(rocketTypes.map((type) => resolveRocketTrailBlastMeters(type, fightConfig)), [6, 12, 30, 90]);
});

test('Fight fans receive 5/4/3 percent and every other base spawn chance shrinks proportionally', () => {
    const nonRocketTypes = getPickupTypes().filter((type) => (
        isPickupTypeAllowedForMode(type, 'HUNT')
        && !isRocketPickupType(type)
        // Items parked at weight 0 never spawn and therefore take no share of the split.
        && (HUNT_CONFIG.PICKUP_WEIGHTS[type] ?? 1) > 0
    ));
    const otherTypes = nonRocketTypes.filter((type) => type !== 'MG_TURRET' && type !== 'ROCKET_TURRET');
    const weights = HUNT_CONFIG.PICKUP_WEIGHTS;
    const turretWeight = weights.MG_TURRET;
    const otherWeights = otherTypes.map((type) => weights[type] ?? 1);
    const weightedTypes = new Set(['FOG', 'FAN_3', 'FAN_4', 'FAN_5', 'FLAMETHROWER', 'LIGHTNING', 'RAILGUN', 'REPAIR_DRONE', 'BOMBER_STRIKE']);
    const standardOtherWeights = otherTypes
        .filter((type) => !weightedTypes.has(type))
        .map((type) => weights[type] ?? 1);
    const launcherWeight = weights.ROCKET_TURRET;
    const totalNonRocketWeight = turretWeight + launcherWeight
        + otherWeights.reduce((total, weight) => total + weight, 0);
    const nonRocketChance = 1 - HUNT_CONFIG.ROCKET_PICKUP_SPAWN_CHANCE;
    const turretChance = nonRocketChance * turretWeight / totalNonRocketWeight;
    const launcherChance = nonRocketChance * launcherWeight / totalNonRocketWeight;
    const otherChance = nonRocketChance - turretChance - launcherChance;

    // Later rare items take their share from everyone, so every older target shrinks equally.
    const dilution = (totalNonRocketWeight - weights.FLAMETHROWER - weights.LIGHTNING
        - weights.RAILGUN - weights.REPAIR_DRONE - weights.BOMBER_STRIKE) / totalNonRocketWeight;
    const remainingScale = 0.88 / (1 - 0.30 / 31.7);
    assert.ok(Math.abs(HUNT_CONFIG.ROCKET_PICKUP_SPAWN_CHANCE / 0.70 - remainingScale) < 1e-12);
    assert.ok(standardOtherWeights.every((weight) => weight === 1));
    assert.equal(weights.FOG, 0.7);
    assert.equal(weights.FLAMETHROWER, 0.225, 'the flamethrower was added after the fan split');
    assert.equal(weights.LIGHTNING, 0.225, 'and so was the lightning');
    assert.equal(weights.RAILGUN, 0.225, 'and the railgun');
    assert.equal(weights.REPAIR_DRONE, 0.225, 'and the repair drone');
    assert.equal(weights.BOMBER_STRIKE, 0.225, 'and the bomber strike');
    for (const [type, chance] of [['FAN_3', 0.05], ['FAN_4', 0.04], ['FAN_5', 0.03]]) {
        assert.ok(Math.abs(nonRocketChance * weights[type] / totalNonRocketWeight - chance * dilution) < 1e-12, type);
    }
    for (const type of nonRocketTypes.filter((type) => !type.startsWith('FAN_'))) {
        const previousChance = 0.30 * (weights[type] ?? 1) / 31.7;
        const nextChance = nonRocketChance * (weights[type] ?? 1) / totalNonRocketWeight;
        assert.ok(Math.abs(nextChance / previousChance - remainingScale * dilution) < 1e-12, type);
    }
    assert.deepEqual(Object.values(HUNT_CONFIG.ROCKET_TIERS).map((tier) => tier.spawnChance), [0.5, 0.28, 0.18, 0.03]);
    assert.equal(turretWeight, 10);
    assert.equal(launcherWeight, 5);
    assert.ok(Math.abs(turretChance + launcherChance + otherChance - nonRocketChance) < Number.EPSILON);
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

test('Rocket tier selection samples the supplied RNG exactly once', () => {
    let calls = 0;
    const values = [0.1, 0.9];
    const picked = pickWeightedRocketTierType({
        allowedTypes: ['ROCKET_WEAK', 'ROCKET_MEGA'],
        tiersConfig: {
            WEAK: { spawnChance: 0.5 },
            MEGA: { spawnChance: 0.5 },
        },
        random: () => values[calls++],
    });

    assert.equal(picked, 'ROCKET_WEAK');
    assert.equal(calls, 1);
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

test('classic and arcade pickup weights use seeded RNG and avoid immediate repeats', () => {
    for (const Strategy of [ClassicModeStrategy, ArcadeModeStrategy]) {
        const first = new Strategy({ runtimeRng: createRuntimeRng({ seed: 4815 }) });
        const second = new Strategy({ runtimeRng: createRuntimeRng({ seed: 4815 }) });
        const types = first.filterSpawnableTypes(getPickupTypes(), CONFIG_BASE.POWERUP.TYPES);
        assert.equal(types.includes('HEALTH'), Strategy === ArcadeModeStrategy);
        const picksA = [];
        const picksB = [];
        let previousA = '';
        let previousB = '';
        for (let i = 0; i < 32; i += 1) {
            previousA = first.resolveSpawnType(types, CONFIG_BASE, { excludeType: previousA });
            previousB = second.resolveSpawnType(types, CONFIG_BASE, { excludeType: previousB });
            picksA.push(previousA);
            picksB.push(previousB);
        }
        assert.deepEqual(picksA, picksB);
        assert.equal(picksA.some((type, index) => index > 0 && type === picksA[index - 1]), false);
    }
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

// Alle drei echten Strategien ueberschreiben resolveSpawnType. Die Basisimplementierung
// lief deshalb nie — und griff unbemerkt auf den globalen Zufall zu. Ein vierter Modus
// haette eine nicht reproduzierbare Auswahl geerbt, ohne dass es auffaellt.
test('the base strategy picks a spawn type without touching the global roll', () => {
    const originalRandom = Math.random;
    Math.random = () => {
        throw new Error('the base strategy must not fall back to Math.random');
    };
    try {
        const base = new GameModeContract();
        const types = ['SHIELD', 'ROCKET', 'BOOST', 'MINE'];

        const first = base.resolveSpawnType(types, null);
        const second = base.resolveSpawnType(types, null);

        assert.ok(types.includes(first));
        assert.equal(second, first, 'without a seeded roll the choice stays reproducible');
    } finally {
        Math.random = originalRandom;
    }
});

test('the base strategy draws from a bound roll when one exists', () => {
    const base = new GameModeContract();
    const types = ['SHIELD', 'ROCKET', 'BOOST', 'MINE'];
    const rolls = [0, 0.3, 0.6, 0.99];
    let index = 0;
    base._random = () => rolls[index++];

    assert.deepEqual(types.map(() => base.resolveSpawnType(types, null)), types);
});

test('the base strategy survives an empty or broken type list', () => {
    const base = new GameModeContract();

    assert.equal(base.resolveSpawnType([], null), undefined);
    assert.equal(base.resolveSpawnType(null, null), undefined);

    base._random = () => Number.NaN;
    assert.equal(base.resolveSpawnType(['ONLY'], null), 'ONLY');
});

test('D6 hazard damage keeps the regen delay because both sides read one clock', () => {
    // Karten-Hazards und Sperrzonen reichen die Spieluhr (Sekunden seit Rundenbeginn) als
    // nowSeconds herein; Player.update reicht den EntityManager als config durch, dessen
    // _simulationClockMs dieselbe Uhr ist. Vor der Korrektur las die Heilung die Laufzeituhr,
    // der Abstand war immer groesser als die Sperre und die Heilung setzte sofort ein.
    const strategy = new HuntModeStrategy({ nowHighRes: () => 900_000 });
    const entityManager = {
        _simulationClockMs: 20_000,
        entityRuntimeConfig: {
            HUNT: {
                PLAYER_MAX_HP: 100,
                PLAYER_REGEN_DELAY: 3,
                PLAYER_REGEN_PER_SECOND: 2,
                SHIELD_MAX_HP: 40,
            },
        },
    };
    const player = {
        index: 0,
        maxHp: 100,
        hp: 100,
        maxShieldHp: 40,
        shieldHP: 0,
        hasShield: false,
        shieldHitFeedback: 0,
        lastDamageTimestamp: -Infinity,
        entityManager,
    };

    // MapHazardSystem._applyHit reicht die verstrichene Kartenzeit als nowSeconds herein.
    strategy.applyDamage(player, 10, { nowSeconds: 20 }, entityManager.entityRuntimeConfig);
    assert.equal(player.hp, 90);
    assert.equal(player.lastDamageTimestamp, 20, 'Trefferzeitpunkt liegt auf der Spieluhr');

    entityManager._simulationClockMs = 20_016;
    strategy.updateHealthRegen(player, 1, entityManager);
    assert.equal(player.hp, 90, 'keine Heilung solange die Regenerationssperre laeuft');

    entityManager._simulationClockMs = 22_000;
    strategy.updateHealthRegen(player, 1, entityManager);
    assert.equal(player.hp, 90);

    entityManager._simulationClockMs = 24_000;
    strategy.updateHealthRegen(player, 1, entityManager);
    assert.ok(player.hp > 90, 'nach Ablauf der Sperre heilt der Spieler wieder');
});

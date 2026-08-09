import assert from 'node:assert/strict';
import test from 'node:test';

import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { createGameModeStrategy } from '../src/modes/GameModeRegistry.js';
import { applyMenuCompatibilityRules } from '../src/ui/menu/MenuCompatibilityRules.js';
import {
    createArcadeVehicleProfile,
    getSlotStatBonuses,
    purchaseUpgrade,
    UPGRADE_PURCHASE_CODES,
} from '../src/state/arcade/ArcadeVehicleProfile.js';
import { purchaseHangarStone } from '../src/ui/hangar/HangarStoneInventory.js';

const UPGRADE_STAT_CAP_PCT = 50;

function bonusesToStrategy(bonuses) {
    const strategy = new ArcadeModeStrategy({ random: () => 0.5 });
    strategy.applyVehicleUpgrades(bonuses);
    return strategy;
}

function spawnPlayer(strategy, baseSpeed = 18) {
    const player = { hasShield: false, baseSpeed, speed: baseSpeed };
    strategy.resetPlayerHealth(player);
    strategy.applySpawnStatBonuses(player);
    return player;
}

test('a fresh profile grants no flight bonus at all', () => {
    const profile = createArcadeVehicleProfile('ship5', 0);
    const bonuses = getSlotStatBonuses(profile.upgrades, profile.hangarBonuses);
    assert.deepEqual(bonuses, { turningBonusPct: 0, speedBonusPct: 0, maxHpBonus: 0 });

    const strategy = bonusesToStrategy(bonuses);
    const player = spawnPlayer(strategy);
    assert.equal(strategy.getTurnRateMultiplier(), 1);
    assert.equal(strategy.getSpeedMultiplier(), 1);
    assert.equal(player.maxHp, 100);
    assert.equal(player.baseSpeed, 18);
});

test('an upgraded wing slot raises the turn rate the player actually flies with', () => {
    const profile = createArcadeVehicleProfile('ship5', 0);
    const upgraded = { ...profile, upgrades: { wing_left: 'T2', wing_right: 'T2' } };
    const bonuses = getSlotStatBonuses(upgraded.upgrades, upgraded.hangarBonuses);
    assert.equal(bonuses.turningBonusPct, 10);

    const strategy = bonusesToStrategy(bonuses);
    assert.equal(strategy.getTurnRateMultiplier(), 1.1);
    // Mirrors Player.js: the strategy multiplier scales the flown turn rate.
    const baseTurnRate = 2.2;
    assert.ok(baseTurnRate * strategy.getTurnRateMultiplier() > baseTurnRate);
});

test('an upgraded engine slot raises the speed the player spawns with', () => {
    const upgrades = { engine_left: 'T3', engine_right: 'T3' };
    const bonuses = getSlotStatBonuses(upgrades, null);
    assert.equal(bonuses.speedBonusPct, 16);

    const strategy = bonusesToStrategy(bonuses);
    const player = spawnPlayer(strategy, 18);
    assert.equal(strategy.getSpeedMultiplier(), 1.16);
    assert.ok(Math.abs(player.baseSpeed - 18 * 1.16) < 1e-9);
    assert.equal(player.speed, player.baseSpeed);
});

test('an upgraded core slot raises the health the player spawns with', () => {
    const bonuses = getSlotStatBonuses({ core: 'T3' }, null);
    assert.equal(bonuses.maxHpBonus, 30);

    const player = spawnPlayer(bonusesToStrategy(bonuses));
    assert.equal(player.maxHp, 130);
    assert.equal(player.hp, 130);
});

test('every stat bonus stays capped at fifty percent of the base value', () => {
    const strategy = bonusesToStrategy({ turningBonusPct: 400, speedBonusPct: 400, maxHpBonus: 400 });
    assert.equal(strategy.getTurnRateMultiplier(), 1 + UPGRADE_STAT_CAP_PCT / 100);
    assert.equal(strategy.getSpeedMultiplier(), 1 + UPGRADE_STAT_CAP_PCT / 100);

    const player = spawnPlayer(strategy, 18);
    assert.equal(player.maxHp, 150);
    assert.ok(Math.abs(player.baseSpeed - 27) < 1e-9);
});

test('the sector modifier and the upgrade bonus multiply instead of replacing each other', () => {
    const strategy = bonusesToStrategy({ turningBonusPct: 10, speedBonusPct: 0, maxHpBonus: 0 });
    strategy.setActiveModifier('tight_turns');
    assert.ok(Math.abs(strategy.getTurnRateMultiplier() - 0.7 * 1.1) < 1e-9);
});

test('buying a hangar stone spends run points and changes what the player flies with', () => {
    // The arcade hangar is the production purchase path: it spends the XP bank and
    // writes the resulting bonuses back into the vehicle profile.
    const profile = { ...createArcadeVehicleProfile('ship5', 0), level: 12, xp: 5000, xpBank: 5000 };
    const before = getSlotStatBonuses(profile.upgrades, { turningBonusPct: 0, speedBonusPct: 0, maxHpBonus: 0 });
    assert.equal(before.speedBonusPct, 0);

    const purchase = purchaseHangarStone(profile, 'stone_blue_t2', 0);
    assert.equal(purchase.ok, true, `stone purchase succeeded (code ${purchase.code})`);
    assert.equal(purchase.remainingXrp, profile.xpBank - 350);
    assert.equal(purchase.profile.xpBank, profile.xpBank - 350);

    const after = getSlotStatBonuses(purchase.profile.upgrades, { turningBonusPct: 0, speedBonusPct: 9, maxHpBonus: 0 });
    const strategy = bonusesToStrategy(after);
    const player = spawnPlayer(strategy, 18);
    assert.ok(player.baseSpeed > 18, 'the equipped bonus reaches the spawned player');
});

test('the strategy the arcade menu path resolves to carries the bonuses to the player', () => {
    // The whole chain in one place: menu settings -> strategy factory -> spawned player.
    // A mode path that resolves to Classic drops every bonus silently, because the
    // Classic strategy has no applyVehicleUpgrades and no health pool at all.
    const settings = {
        gameMode: 'CLASSIC',
        mapKey: 'parcours_rift',
        hunt: { respawnEnabled: false },
        localSettings: { sessionType: 'single', modePath: 'arcade' },
    };
    applyMenuCompatibilityRules(settings, {});

    const strategy = createGameModeStrategy(settings.gameMode, { random: () => 0.5 });
    const bonuses = getSlotStatBonuses({ core: 'T3', engine_left: 'T3', engine_right: 'T3' }, null);
    strategy.applyVehicleUpgrades?.(bonuses);

    const player = { hasShield: false, baseSpeed: 18, speed: 18 };
    strategy.resetPlayerHealth(player);
    strategy.applySpawnStatBonuses?.(player);

    assert.equal(player.maxHp, 130, 'the core upgrade reaches the spawned player');
    assert.ok(player.baseSpeed > 18, 'the engine upgrade reaches the spawned player');
});

test('an unaffordable upgrade is refused with its reason instead of applying', () => {
    const profile = { ...createArcadeVehicleProfile('ship5', 0), level: 12, xpBank: 0 };
    const result = purchaseUpgrade(profile, 'wing_left', 'T2', 0);
    assert.equal(result.ok, false);
    assert.equal(result.code, UPGRADE_PURCHASE_CODES.INSUFFICIENT_XP);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { createGameModeStrategy } from '../src/modes/GameModeRegistry.js';
import { applyMenuCompatibilityRules } from '../src/ui/menu/MenuCompatibilityRules.js';
import { createArcadeVehicleProfile, getArcadeRunVehicleBonuses } from '../src/state/arcade/ArcadeVehicleProfile.js';
import {
    ARCADE_STONE_WORKSHOP_STORAGE_KEY,
    commitArcadeStoneWorkshopResult,
    createArcadeStoneWorkshopRecord,
    evaluateArcadeStonePurchase,
    evaluateArcadeStoneUpgrade,
    readArcadeStoneWorkshopRecord,
} from '../src/shared/contracts/ArcadeStoneWorkshopContract.js';
import { applyArcadeStonePlacement } from '../src/shared/contracts/ArcadeStonePlacementContract.js';

// Paket 3: flight bonuses come from stones of the workshop pool placed in the vehicle's slots.

function createStore() {
    const records = new Map();
    return {
        readJsonRecordResult(key) {
            return records.has(key)
                ? { ok: true, status: 'found', value: JSON.parse(records.get(key)) }
                : { ok: true, status: 'missing', value: null };
        },
        loadJsonRecord(key, fallback = null) { return records.has(key) ? JSON.parse(records.get(key)) : fallback; },
        saveJsonRecord(key, value) { records.set(key, JSON.stringify(value)); return { success: true }; },
    };
}

/** Places the three free stones of a fresh pool and saves it; returns the run bonuses of the profile. */
function bonusesWithStones(profile, stoneSlots) {
    const store = createStore();
    const pool = createArcadeStoneWorkshopRecord(0);
    const placed = applyArcadeStonePlacement(pool, profile.vehicleId, stoneSlots, profile, { nowMs: 0 });
    assert.equal(placed.ok, true, `placement accepted (${placed.reason})`);
    store.saveJsonRecord(ARCADE_STONE_WORKSHOP_STORAGE_KEY, placed.pool);
    return getArcadeRunVehicleBonuses(profile, store);
}

function bonusesToStrategy(bonuses) {
    const strategy = new ArcadeModeStrategy({ random: () => 0.5 });
    strategy.applyVehicleUpgrades(bonuses);
    return strategy;
}

function spawnPlayer(strategy, baseSpeed = 18) {
    const player = { vehicleId: 'ship5', hasShield: false, baseSpeed, speed: baseSpeed };
    strategy.resetPlayerHealth(player);
    strategy.applySpawnStatBonuses(player);
    return player;
}

function shipProfile(extra = {}) {
    return { ...createArcadeVehicleProfile('ship5', 0), ...extra };
}

test('a fresh profile with an untouched stone pool grants no flight bonus at all', () => {
    const strategy = bonusesToStrategy(bonusesWithStones(shipProfile(), {}));
    const player = spawnPlayer(strategy);
    assert.equal(strategy.getTurnRateMultiplier(player), 1);
    assert.equal(strategy.getSpeedMultiplier(player), 1);
    assert.equal(player.maxHp, 100);
    assert.equal(player.baseSpeed, 18);
});

test('stones in both wing slots raise the turn rate the player actually flies with', () => {
    const profile = shipProfile({ stoneSlotPackages: ['wings'] });
    const strategy = bonusesToStrategy(bonusesWithStones(profile, { wing_left: 'stone-0001', wing_right: 'stone-0002' }));
    const player = spawnPlayer(strategy);
    assert.ok(Math.abs(strategy.getTurnRateMultiplier(player) - 1.06) < 1e-9, 'each wing stone counts as one step');
    // Mirrors Player.js: the strategy multiplier scales the flown turn rate.
    const baseTurnRate = 2.2;
    assert.ok(baseTurnRate * strategy.getTurnRateMultiplier(player) > baseTurnRate);
});

test('stones in both engine slots raise the speed the player spawns with', () => {
    const profile = shipProfile({ stoneSlotPackages: ['engines'] });
    const strategy = bonusesToStrategy(bonusesWithStones(profile, { engine_left: 'stone-0001', engine_right: 'stone-0002' }));
    const player = spawnPlayer(strategy, 18);
    assert.ok(Math.abs(strategy.getSpeedMultiplier(player) - 1.05) < 1e-9);
    assert.ok(Math.abs(player.baseSpeed - 18 * 1.05) < 1e-9);
    assert.equal(player.speed, player.baseSpeed);
});

test('a stone in the core slot raises the health the player spawns with', () => {
    const player = spawnPlayer(bonusesToStrategy(bonusesWithStones(shipProfile(), { core: 'stone-0001' })));
    assert.equal(player.maxHp, 104);
    assert.equal(player.hp, 104);
});

// Paket 1 (Arcade-Hangar: Fahrzeugrollen und Ausbau) hat die Tempo-/Wendigkeitsobergrenze
// für normale Arcade-Runs von "Grundwert + 50 Punkte" auf "Grundwert + 100 Punkte" je
// Fahrzeug angehoben (siehe ArcadeVehicleBalanceContract.resolveArcadeStatCapPct). Der
// Spieler hier hat keine vehicleId, fällt also auf die Star-Cruiser-Grundwerte (100 %)
// zurück; die HP-Klemmung (weiterhin 50 % des Fahrzeug-Grundwerts) ist davon nicht berührt.
test('every stat bonus stays capped at the vehicle base plus one hundred points', () => {
    const strategy = bonusesToStrategy({ turningBonusPct: 400, speedBonusPct: 400, maxHpBonus: 400 });
    assert.equal(strategy.getTurnRateMultiplier(), 2);
    assert.equal(strategy.getSpeedMultiplier(), 2);

    const player = { hasShield: false, baseSpeed: 18, speed: 18 };
    strategy.resetPlayerHealth(player);
    strategy.applySpawnStatBonuses(player);
    assert.equal(player.maxHp, 150);
    assert.ok(Math.abs(player.baseSpeed - 36) < 1e-9);
});

test('the sector modifier and the upgrade bonus multiply instead of replacing each other', () => {
    const strategy = bonusesToStrategy({ turningBonusPct: 10, speedBonusPct: 0, maxHpBonus: 0 });
    strategy.setActiveModifier('tight_turns');
    assert.ok(Math.abs(strategy.getTurnRateMultiplier() - 0.7 * 1.1) < 1e-9);
});

test('buying a stone spends vehicle XP and, once placed, changes what the player flies with', () => {
    const store = createStore();
    const profile = shipProfile({ level: 12, xp: 5000, xpBank: 5000 });
    const bought = evaluateArcadeStonePurchase(readArcadeStoneWorkshopRecord(store, 0).pool, profile, 0);
    assert.equal(bought.ok, true, `stone purchase succeeded (${bought.reason})`);
    assert.equal(bought.next.xpBank, profile.xpBank - 200);
    let saved = null;
    assert.equal(commitArcadeStoneWorkshopResult(store, bought, (next) => { saved = next; }).ok, true);
    assert.equal(saved.xpBank, 4800);

    const placed = applyArcadeStonePlacement(readArcadeStoneWorkshopRecord(store, 0).pool, 'ship5', { core: 'stone-0004' }, saved, { nowMs: 0 });
    assert.equal(commitArcadeStoneWorkshopResult(store, placed, null).ok, true);
    const player = spawnPlayer(bonusesToStrategy(getArcadeRunVehicleBonuses(saved, store)));
    assert.equal(player.maxHp, 104, 'the placed stone reaches the spawned player');
});

test('the strategy the arcade menu path resolves to carries the stones to the player', () => {
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
    const profile = shipProfile({ stoneSlotPackages: ['engines'] });
    strategy.applyVehicleUpgrades?.(bonusesWithStones(profile, { core: 'stone-0001', engine_left: 'stone-0002', engine_right: 'stone-0003' }));

    const player = { vehicleId: 'ship5', hasShield: false, baseSpeed: 18, speed: 18 };
    strategy.resetPlayerHealth(player);
    strategy.applySpawnStatBonuses?.(player);

    assert.equal(player.maxHp, 104, 'the core stone reaches the spawned player');
    assert.ok(player.baseSpeed > 18, 'the engine stones reach the spawned player');
});

test('an unaffordable stone upgrade is refused with its reason instead of applying', () => {
    const pool = createArcadeStoneWorkshopRecord(0);
    const profile = shipProfile({ level: 12, xpBank: 0 });
    const result = evaluateArcadeStoneUpgrade(pool, profile, 'stone-0001', 0);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'insufficient_xp');
    assert.equal(pool.stones[0].level, 1);
    assert.equal(profile.xpBank, 0);
});

// ============================================
// arcade-vehicle-balance.contract.test.mjs - Paket 1 der Arcade-Hangar-Umbau:
// Fahrzeugtabelle, Tempo-/Wendigkeitsobergrenze, Lagergrenze; dazu ein
// Runtime-naher Test für Spawn-Werte, getrennte Lager und Bot-Pickup.
// ============================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    ARCADE_STORAGE_MAX_SLOTS,
    ARCADE_VEHICLE_ROLE_TEMPLATES,
    resolveArcadeStatCapPct,
    resolveArcadeVehicleBaseStats,
} from '../src/shared/contracts/ArcadeVehicleBalanceContract.js';
import { resolveArcadeVehicleBuildStats } from '../src/shared/contracts/ArcadeVehicleBuildContract.js';
import { applyArenaWavesChoice } from '../src/shared/contracts/ArenaWavesContract.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { addPlayerInventoryItem } from '../src/entities/player/PlayerInventoryOps.js';
import { findPreferredPickupTarget } from '../src/entities/ai/BotPickupTargetingOps.js';
import { isNormalArcadeRunType } from '../src/modes/ArcadeVehicleStatOps.js';
import { normalizeArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { ArenaWavesRuntime } from '../src/core/arcade/ArenaWavesRuntime.js';
import { applyLiveRuntimeConfig } from '../src/entities/EntityManagerLiveConfigOps.js';

const PLAN_TABLE = {
    ship5: { role: 'allrounder', maxHpPct: 100, itemCapacity: 5, rocketCapacity: 5, speedPct: 100, turnPct: 100 },
    spaceship: { role: 'tank', maxHpPct: 125, itemCapacity: 6, rocketCapacity: 5, speedPct: 90, turnPct: 90 },
    arrow: { role: 'fighter', maxHpPct: 75, itemCapacity: 3, rocketCapacity: 3, speedPct: 120, turnPct: 125 },
    manta: { role: 'tank', maxHpPct: 150, itemCapacity: 7, rocketCapacity: 8, speedPct: 80, turnPct: 75 },
    drone: { role: 'fighter', maxHpPct: 70, itemCapacity: 3, rocketCapacity: 2, speedPct: 115, turnPct: 130 },
    ship1: { role: 'fighter', maxHpPct: 90, itemCapacity: 4, rocketCapacity: 4, speedPct: 110, turnPct: 110 },
    ship9: { role: 'fighter', maxHpPct: 80, itemCapacity: 4, rocketCapacity: 3, speedPct: 120, turnPct: 115 },
    lab_helix_interceptor: { role: 'fighter', maxHpPct: 85, itemCapacity: 4, rocketCapacity: 4, speedPct: 108, turnPct: 125 },
};

test('arcade-vehicle-balance: alle acht Werksschiffe tragen exakt die Plan-Werte', () => {
    for (const [vehicleId, expected] of Object.entries(PLAN_TABLE)) {
        const actual = resolveArcadeVehicleBaseStats(vehicleId);
        assert.equal(actual.role, expected.role, `${vehicleId}.role`);
        assert.equal(actual.maxHpPct, expected.maxHpPct, `${vehicleId}.maxHpPct`);
        assert.equal(actual.itemCapacity, expected.itemCapacity, `${vehicleId}.itemCapacity`);
        assert.equal(actual.rocketCapacity, expected.rocketCapacity, `${vehicleId}.rocketCapacity`);
        assert.equal(actual.speedPct, expected.speedPct, `${vehicleId}.speedPct`);
        assert.equal(actual.turnPct, expected.turnPct, `${vehicleId}.turnPct`);
        assert.ok(actual.itemCapacity <= ARCADE_STORAGE_MAX_SLOTS, `${vehicleId} item capacity <= 10`);
        assert.ok(actual.rocketCapacity <= ARCADE_STORAGE_MAX_SLOTS, `${vehicleId} rocket capacity <= 10`);
    }
});

test('arcade-vehicle-balance: unbekanntes Fahrzeug fällt auf Star-Cruiser-Werte (allrounder) zurück', () => {
    const actual = resolveArcadeVehicleBaseStats('aircraft');
    assert.equal(actual.role, 'allrounder');
    assert.equal(actual.speedPct, 100);
    assert.equal(actual.turnPct, 100);
});

test('arcade-vehicle-balance: Tempo-/Wendigkeitsobergrenze ist Grundwert + 100 Punkte', () => {
    assert.equal(resolveArcadeStatCapPct(100), 200);
    const drone = resolveArcadeVehicleBaseStats('drone');
    assert.equal(resolveArcadeStatCapPct(drone.speedPct), 215, 'Kampfdrohne max. Tempo 215 %');
    assert.equal(resolveArcadeStatCapPct(drone.turnPct), 230, 'Kampfdrohne max. Wendigkeit 230 %');
});

test('arcade-vehicle-balance: Lager ist höchstens 10 Plätze', () => {
    assert.equal(ARCADE_STORAGE_MAX_SLOTS, 10);
});

test('arcade-vehicle-balance: Rollgeschwindigkeit ist ein Tabellenfeld (100 %), gedeckelt auf Grundwert + 100', () => {
    for (const vehicleId of [...Object.keys(PLAN_TABLE), 'aircraft']) {
        assert.equal(resolveArcadeVehicleBaseStats(vehicleId).rollPct, 100, vehicleId);
    }
    for (const [role, template] of Object.entries(ARCADE_VEHICLE_ROLE_TEMPLATES)) assert.equal(template.rollPct, 100, role);
    const maxedWings = resolveArcadeVehicleBuildStats('drone', null, { wings: 500 });
    assert.equal(maxedWings.rollPct, resolveArcadeStatCapPct(resolveArcadeVehicleBaseStats('drone').rollPct));
});

test('arcade-vehicle-balance: Live-Konfiguration setzt rollSpeed neu, der Arcade-Rollfaktor und das Leben bleiben', () => {
    const player = {
        rollSpeed: 7, arcadeRollMultiplier: 1.1, maxHp: 150, hp: 150,
        setControlOptions(options) { this.rollSpeed = options.rollSpeed; },
    };
    const em = { players: [player], humanPlayers: [player], bots: [], gameModeStrategy: new ArcadeModeStrategy({ runType: 'gauntlet' }) };
    applyLiveRuntimeConfig(em, null, undefined);
    assert.notEqual(player.rollSpeed, 7, 'die Einstellungs-Rollgeschwindigkeit wird wie bisher neu geschrieben');
    assert.equal(player.arcadeRollMultiplier, 1.1, 'der Build-Faktor liegt getrennt und bleibt');
    assert.equal(player.maxHp, 150);
});

// --- Runtime-naher Test: Spawn-Pfad, getrennte Lager, Bot-Pickup ---

function makePlayer(vehicleId, { isBot = false } = {}) {
    return {
        vehicleId,
        isBot,
        baseSpeed: 40,
        speed: 40,
        turnSpeed: 2,
        hasShield: false,
        maxHp: 1,
        hp: 1,
        maxShieldHp: 1,
        shieldHP: 0,
        position: null,
        inventory: [],
        rocketInventory: [],
    };
}

test('arcade-vehicle-balance runtime: gauntlet-Spawn setzt Manta-Werte (Leben, Lager, Tempo/Wendigkeit)', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    const manta = makePlayer('manta');
    strategy.resetPlayerHealth(manta);
    strategy.applySpawnStatBonuses(manta);

    assert.equal(manta.maxHp, 150, 'Manta maxHp = 100 (Modus-Basis) * 150 / 100');
    assert.equal(manta.itemCapacity, 7);
    assert.equal(manta.rocketCapacity, 8);
    assert.equal(manta.baseSpeed, 40 * 0.8, 'baseSpeed = Grundtempo * 80 %');
    assert.equal(strategy.getTurnRateMultiplier(manta), 0.75, 'Wendigkeit 75 %');
});

test('arcade-vehicle-balance runtime: Kampfdrohne-Bot bekommt Grundwerte ohne Hangar-Bonus', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    strategy.applyVehicleUpgrades({ speedBonusPct: 40, turningBonusPct: 40, maxHpBonus: 40 });
    const bot = makePlayer('drone', { isBot: true });
    strategy.resetPlayerHealth(bot);
    strategy.applySpawnStatBonuses(bot);

    assert.equal(bot.maxHp, 70, 'Bot bekommt nur den Fahrzeug-Grundwert, keinen Hangar-Bonus');
    assert.equal(bot.baseSpeed, 40 * 1.15, 'Bot-Tempo = Grundtempo * 115 % ohne Hangar-Bonus');
});

test('arcade-vehicle-balance runtime: Hangar-Bonus wird auf Fahrzeug-Obergrenze geklemmt (Kampfdrohne)', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    strategy.applyVehicleUpgrades({ speedBonusPct: 500, turningBonusPct: 500, maxHpBonus: 0 });
    const drone = makePlayer('drone');
    const speedMult = strategy.getSpeedMultiplier(drone);
    const turnMult = strategy.getTurnRateMultiplier(drone);
    assert.equal(speedMult, 2.15, 'Kampfdrohne Tempo geklemmt auf 215 %');
    assert.equal(turnMult, 2.3, 'Kampfdrohne Wendigkeit geklemmt auf 230 %');
});

test('arcade-vehicle-balance runtime: Daily/Waffenrennen behalten die alten Fixwerte (kein Fahrzeug-Tempo, Deckel 50)', () => {
    const daily = new ArcadeModeStrategy({ runType: 'gauntlet', isDailyChallenge: true });
    const dailyPlayer = makePlayer('manta');
    daily.resetPlayerHealth(dailyPlayer);
    assert.equal(dailyPlayer.maxHp, 100, 'Daily bleibt bei DEFAULT_MAX_HP=100, keine Fahrzeugskalierung');
    assert.equal(dailyPlayer.itemCapacity, undefined, 'Daily setzt keine Fahrzeug-Lagergröße');

    const weaponRace = new ArcadeModeStrategy({ runType: 'weapon_race' });
    weaponRace.applyVehicleUpgrades({ speedBonusPct: 500, turningBonusPct: 500, maxHpBonus: 0 });
    const racePlayer = makePlayer('manta');
    assert.equal(weaponRace.getSpeedMultiplier(racePlayer), 1.5, 'Alter Deckel: 100 % + 50 Punkte Hangar-Bonus');
});

test('arcade-vehicle-balance runtime: addPlayerInventoryItem respektiert getrennte Kapazitäten', () => {
    const player = makePlayer('manta');
    player.itemCapacity = 2;
    player.rocketCapacity = 1;
    assert.equal(addPlayerInventoryItem(player, 'SHIELD'), true);
    assert.equal(addPlayerInventoryItem(player, 'SPEED_UP'), true);
    assert.equal(addPlayerInventoryItem(player, 'GHOST'), false, 'Item-Lager (2) ist voll');
    assert.equal(addPlayerInventoryItem(player, 'ROCKET_MEDIUM'), true);
    assert.equal(addPlayerInventoryItem(player, 'ROCKET_GUIDED'), false, 'Raketen-Lager (1) ist voll');
});

// --- Review-Befunde Paket 1 ---

test('arcade-vehicle-balance: normale Runs sind eine Positivliste (unbekannter runType bekommt keine Werte)', () => {
    for (const runType of ['gauntlet', 'endless_parcours', 'five_portals', 'arena_waves']) {
        assert.equal(isNormalArcadeRunType(runType, false), true, runType);
        assert.equal(isNormalArcadeRunType(runType, true), false, `${runType} als Daily`);
    }
    assert.equal(isNormalArcadeRunType('weapon_race', false), false);
    assert.equal(isNormalArcadeRunType('mystery_run', false), false, 'unbekannter runType ist kein normaler Run');
    assert.equal(isNormalArcadeRunType('', false), false, 'leerer runType allein ist kein normaler Run');
});

test('arcade-vehicle-balance: Gauntlet ohne runType-Option bleibt ein normaler Run (Strategie-Default gauntlet)', () => {
    // Der produktive Pfad (RuntimeConfig -> normalizeArcadeRunSettings) setzt immer einen runType;
    // fehlt er trotzdem, gilt der Strategie-Default gauntlet und der Run bekommt die Fahrzeugwerte.
    assert.equal(normalizeArcadeRunSettings({}).runType, 'gauntlet');
    assert.equal(normalizeArcadeRunSettings({ runType: '' }).runType, 'gauntlet');
    for (const options of [{}, { runType: undefined }, { runType: '' }]) {
        const strategy = new ArcadeModeStrategy(options);
        assert.equal(strategy.isNormalArcadeRun(), true, JSON.stringify(options));
        const manta = makePlayer('manta');
        strategy.resetPlayerHealth(manta);
        assert.equal(manta.maxHp, 150);
    }
});

test('arcade-vehicle-balance: Tempo-Obergrenze gilt für Tabelle x Hangar x Lauf-Belohnung', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    strategy.applyVehicleUpgrades({ speedBonusPct: 500, turningBonusPct: 0, maxHpBonus: 0 });
    strategy.applyRunRewardEffects({ speedBonusPct: 20 });
    const drone = makePlayer('drone');
    assert.equal(strategy.getSpeedMultiplier(drone), 2.15, 'Belohnung darf den Deckel 215 % nicht überschreiten');
    strategy.applySpawnStatBonuses(drone);
    assert.ok(Math.abs(drone.baseSpeed - 40 * 2.15) < 1e-9);

    const cruiser = makePlayer('ship5');
    strategy.applyVehicleUpgrades({ speedBonusPct: 20, turningBonusPct: 0, maxHpBonus: 0 });
    assert.ok(Math.abs(strategy.getSpeedMultiplier(cruiser) - 1.2 * 1.2) < 1e-9, 'unter dem Deckel wirkt die Belohnung voll');
});

test('arcade-vehicle-balance: Arena-Aufwertung klemmt das Tempo auf die Fahrzeug-Obergrenze', () => {
    const human = {
        index: 0, isBot: false, alive: true, vehicleId: 'drone', maxHp: 70, hp: 70,
        _arcadeBaseSpeed: 10, baseSpeed: 21.5, speed: 21.5, fightLoadout: {},
    };
    const runtime = new ArenaWavesRuntime();
    runtime.start({ entityManager: { humanPlayers: [human], players: [human], bots: [] } });
    runtime.upgrades.speed = 50;
    runtime._applyHumanUpgrades();
    assert.ok(Math.abs(human.baseSpeed - 21.5) < 1e-9, `Kampfdrohne bleibt bei 215 % (war ${human.baseSpeed})`);
    assert.equal(human.speed, human.baseSpeed);

    const slow = { ...human, vehicleId: 'manta', _arcadeBaseSpeed: 10, baseSpeed: 8, speed: 8 };
    delete slow._arenaWavesBaseSpeed;
    const slowRuntime = new ArenaWavesRuntime();
    slowRuntime.start({ entityManager: { humanPlayers: [slow], players: [slow], bots: [] } });
    slowRuntime.upgrades.speed = 50;
    slowRuntime._applyHumanUpgrades();
    assert.ok(Math.abs(slow.baseSpeed - 12) < 1e-9, 'unter dem Deckel wirkt die Arena-Aufwertung voll');
});

function makeArenaHuman(vehicleId) {
    return {
        index: 0, isBot: false, alive: true, vehicleId, maxHp: 100, hp: 100, baseSpeed: 10, speed: 10,
        fightLoadout: {}, hasShield: false, shieldHP: 0, maxShieldHp: 40,
    };
}

test('Arena: Leben-Aufwertung setzt auf das Tabellenleben nach dem Spawn auf, nicht auf den Wert vor dem Spawn', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'arena_waves', combatProfile: 'hunt' });
    const human = makeArenaHuman('manta');
    const runtime = new ArenaWavesRuntime();
    runtime.start({ entityManager: { humanPlayers: [human], players: [human], bots: [] }, strategy });
    strategy.resetPlayerHealth(human);
    assert.equal(human.maxHp, 150, 'Spawn: Manta-Tabellenleben');
    runtime.update(0);
    assert.equal(human.maxHp, 150);
    runtime.upgrades = applyArenaWavesChoice(runtime.upgrades, 'max_hp');
    runtime._applyHumanUpgrades(true);
    assert.equal(human.maxHp, 162, '150 + 12 statt 100 + 12');
    assert.equal(human.hp, 162);
    runtime.dispose();
    assert.equal(human.maxHp, 150, 'Abbau stellt das Spawn-Leben wieder her');
});

test('Arena: nach dem Neuaufbau einer Karte gilt die Leben-Aufwertung auch auf dem neuen Spawn', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'arena_waves', combatProfile: 'hunt' });
    const runtime = new ArenaWavesRuntime();
    const first = makeArenaHuman('manta');
    runtime.start({ entityManager: { humanPlayers: [first], players: [first], bots: [] }, strategy });
    strategy.resetPlayerHealth(first);
    runtime.update(0);
    runtime.upgrades = applyArenaWavesChoice(runtime.upgrades, 'max_hp');
    runtime._applyHumanUpgrades(true);

    const reborn = makeArenaHuman('manta');
    runtime.start({ entityManager: { humanPlayers: [reborn], players: [reborn], bots: [] }, strategy });
    strategy.resetPlayerHealth(reborn);
    runtime.update(0);
    assert.equal(reborn.maxHp, 162, 'neuer Spawn 150 + Aufwertung 12');
    assert.equal(reborn.hp, 162);
});

test('Arena: das Tabellentempo bleibt nach dem ersten Bild, unter einer Tempo-Aufwertung und nach dem Neuaufbau', () => {
    // Echte Reihenfolge: start() vor dem Spawn, dann resetPlayerHealth + applySpawnStatBonuses, dann update().
    for (const [vehicleId, tableFactor] of [['manta', 0.8], ['drone', 1.15]]) {
        const runtime = new ArenaWavesRuntime();
        const strategy = new ArcadeModeStrategy({ runType: 'arena_waves', combatProfile: 'hunt' });
        const human = makeArenaHuman(vehicleId);
        runtime.start({ entityManager: { humanPlayers: [human], players: [human], bots: [] }, strategy });
        strategy.resetPlayerHealth(human);
        strategy.applySpawnStatBonuses(human);
        assert.ok(Math.abs(human.baseSpeed - 10 * tableFactor) < 1e-9, `${vehicleId}: Spawn-Tempo ${human.baseSpeed}`);
        runtime.update(0);
        assert.ok(Math.abs(human.baseSpeed - 10 * tableFactor) < 1e-9, `${vehicleId}: nach dem ersten Bild ${human.baseSpeed}`);
        assert.equal(human.speed, human.baseSpeed);
        runtime.upgrades = applyArenaWavesChoice(runtime.upgrades, 'speed');
        runtime._applyHumanUpgrades(true);
        assert.ok(Math.abs(human.baseSpeed - 10 * tableFactor * 1.04) < 1e-9, `${vehicleId}: Aufwertung auf das Tabellentempo ${human.baseSpeed}`);

        // Neuaufbau nach einem Tod: neue Sitzung, neue Strategie, neuer Spieler; die Aufwertung zählt genau einmal.
        const rebuilt = new ArcadeModeStrategy({ runType: 'arena_waves', combatProfile: 'hunt' });
        const reborn = makeArenaHuman(vehicleId);
        runtime.start({ entityManager: { humanPlayers: [reborn], players: [reborn], bots: [] }, strategy: rebuilt });
        rebuilt.resetPlayerHealth(reborn);
        rebuilt.applySpawnStatBonuses(reborn);
        runtime.update(0);
        assert.ok(Math.abs(reborn.baseSpeed - 10 * tableFactor * 1.04) < 1e-9, `${vehicleId}: neuer Spawn ${reborn.baseSpeed}`);
    }
});

test('arcade-vehicle-balance: Wendigkeit wird beim Spawn gecacht und pro Bild nur gelesen', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    const manta = makePlayer('manta');
    strategy.applySpawnStatBonuses(manta);
    assert.equal(manta._arcadeTurnPct, 75, 'Tabellenwert liegt nach dem Spawn am Spieler');
    manta.vehicleId = 'drone';
    assert.equal(strategy.getTurnRateMultiplier(manta), 0.75, 'pro Bild zählt der gecachte Wert, keine neue Tabellensuche');
    assert.equal(strategy.getTurnRateMultiplier(makePlayer('drone')), 1.3, 'ohne Cache fällt es auf die Tabelle zurück');
});

test('arcade-vehicle-balance runtime: Bot-Pickup-Ziel respektiert getrennte Kapazitäten', () => {
    const player = makePlayer('manta', { isBot: true });
    player.itemCapacity = 1;
    player.rocketCapacity = 5;
    player.inventory = ['SHIELD'];
    player.position = { distanceToSquared: () => 4 };
    const rocketPickup = { mesh: { position: {} }, type: 'ROCKET_MEDIUM', predictedCollected: false, telegraphRemaining: 0 };
    const itemPickup = { mesh: { position: {} }, type: 'SPEED_UP', predictedCollected: false, telegraphRemaining: 0 };
    const target = findPreferredPickupTarget(player, { powerups: [itemPickup, rocketPickup] });
    assert.equal(target, rocketPickup, 'Item-Lager voll, also zielt der Bot auf die Rakete');
});

test('HUD projection carries the per-player Arcade storage sizes', async () => {
    const { createMatchRuntimePlayerProjection } = await import('../src/shared/contracts/MatchRuntimeProjectionContract.js');
    const manta = createMatchRuntimePlayerProjection({ playerIndex: 0, itemCapacity: 7, rocketCapacity: 8 });
    assert.equal(manta.itemCapacity, 7);
    assert.equal(manta.rocketCapacity, 8);
    const classic = createMatchRuntimePlayerProjection({ playerIndex: 0 });
    assert.equal(classic.itemCapacity, 0, 'unset capacity falls back to POWERUP.MAX_INVENTORY in the HUD');
});

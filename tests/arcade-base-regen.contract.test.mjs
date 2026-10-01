// ============================================
// arcade-base-regen.contract.test.mjs - Paket 1 (Korrektur): Grund-Regeneration in
// normalen Arcade-Runs. 2 % des Höchstlebens pro Sekunde, 3 s nach dem letzten Treffer
// (Rumpf-Build verkürzt, nie unter 1 s), auf der Simulationsuhr. Daily, Waffenrennen und
// Hunt bleiben unverändert.
// ============================================
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import { EntityManager } from '../src/entities/EntityManager.js';

const WALL_CLOCK_MS = 1_800_000_000_000;

function makeEntityManager(clockSeconds) {
    return { _simulationClockMs: clockSeconds * 1000, runtimeConfig: null };
}

function makePlayer(entityManager, overrides = {}) {
    return {
        alive: true, isBot: false, vehicleId: 'manta', hp: 50, maxHp: 150,
        shieldHP: 0, hasShield: false, lastDamageTimestamp: -Infinity, entityManager, ...overrides,
    };
}

function close(actual, expected, message) {
    assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);
}

const NORMAL_RUNS = [
    { runType: 'gauntlet' },
    { runType: 'endless_parcours', combatProfile: 'hunt' },
    { runType: 'endless_parcours' },
    { runType: 'five_portals' },
    { runType: 'arena_waves', combatProfile: 'hunt' },
];

for (const options of NORMAL_RUNS) {
    test(`${options.runType}${options.combatProfile ? ' (Kampfprofil)' : ''}: heilt 2 % Höchstleben pro Sekunde ab 3 s nach dem letzten Treffer`, () => {
        const strategy = new ArcadeModeStrategy({ ...options, nowMs: () => WALL_CLOCK_MS });
        const em = makeEntityManager(10);
        const player = makePlayer(em, { lastDamageTimestamp: 8 });
        strategy.updateHealthRegen(player, 1, em);
        assert.equal(player.hp, 50, 'nach 2 s wartet die Heilung noch');
        em._simulationClockMs = 11_000;
        strategy.updateHealthRegen(player, 1, em);
        close(player.hp, 53, '150 * 2 % in einer Sekunde, nur einmal (kein Hunt-Regen dazu)');
        player.hp = 149.5;
        strategy.updateHealthRegen(player, 1, em);
        assert.equal(player.hp, 150, 'nie über das Höchstleben');
    });
}

test('Rumpf-Build verkürzt die Wartezeit, aber nie unter 1 s', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    const em = makeEntityManager(20);
    const built = makePlayer(em, { lastDamageTimestamp: 18.5, arcadeRegenDelay: 1.5 });
    strategy.updateHealthRegen(built, 0.5, em);
    close(built.hp, 51.5, 'nach 1,5 s heilt der Build');
    const tooShort = makePlayer(em, { lastDamageTimestamp: 19.5, arcadeRegenDelay: 0.2 });
    strategy.updateHealthRegen(tooShort, 0.5, em);
    assert.equal(tooShort.hp, 50, 'Untergrenze 1 s');
});

test('Sudden Death sperrt die Grund-Regeneration', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    strategy.enterSuddenDeath();
    const em = makeEntityManager(30);
    const player = makePlayer(em);
    strategy.updateHealthRegen(player, 1, em);
    assert.equal(player.hp, 50);
});

test('Tote und volle Spieler heilen nicht; heat_stress zieht weiter ab statt zu heilen', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    const em = makeEntityManager(30);
    const dead = makePlayer(em, { hp: 0 });
    strategy.updateHealthRegen(dead, 1, em);
    assert.equal(dead.hp, 0);
    strategy.setActiveModifier('heat_stress');
    const drained = makePlayer(em);
    strategy.updateHealthRegen(drained, 1, em);
    close(drained.hp, 47.5, 'Hitze-Abzug wie bisher, keine Heilung im selben Bild');
});

test('Treffer im Gauntlet stempeln die Simulationsuhr, nicht die Wanduhr', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet', nowMs: () => WALL_CLOCK_MS });
    const em = makeEntityManager(42);
    const player = makePlayer(em);
    strategy.applyDamage(player, 10);
    assert.equal(player.lastDamageTimestamp, 42);
    em._simulationClockMs = 46_000;
    strategy.updateHealthRegen(player, 1, em);
    close(player.hp, 43, 'nach 4 s Simulationszeit heilt der Spieler wieder');
});

test('Ein Treffer, den der Schild ganz abfängt, hält die Grund-Regeneration an (Gauntlet wie Kampfprofil)', () => {
    for (const options of [{ runType: 'gauntlet' }, { runType: 'endless_parcours', combatProfile: 'hunt' }]) {
        const strategy = new ArcadeModeStrategy({ ...options, nowMs: () => WALL_CLOCK_MS });
        const em = makeEntityManager(10);
        const player = makePlayer(em, { shieldHP: 40, maxShieldHp: 40, hasShield: true });
        const result = strategy.applyDamage(player, 22);
        assert.equal(result.absorbedByShield, 22, options.runType);
        assert.equal(player.hp, 50, `${options.runType}: der Schild fängt alles ab`);
        assert.equal(player.lastDamageTimestamp, 10, `${options.runType}: auch ein reiner Schildtreffer stempelt`);
        em._simulationClockMs = 11_000;
        strategy.updateHealthRegen(player, 1, em);
        assert.equal(player.hp, 50, `${options.runType}: 1 s nach dem Schildtreffer wartet die Heilung`);
    }
});

test('Treffer mit Kampfprofil (Arena) stempeln ebenfalls die Simulationsuhr', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'arena_waves', combatProfile: 'hunt', nowMs: () => WALL_CLOCK_MS });
    assert.equal(strategy.hasCombatHud(), true, 'Arena läuft mit Hunt-Kampfprofil');
    const em = makeEntityManager(12);
    const player = makePlayer(em, { hp: 150 });
    strategy.applyDamage(player, 20);
    assert.equal(player.lastDamageTimestamp, 12);
    strategy.applyDamage(player, 5, { nowSeconds: 13 });
    assert.equal(player.lastDamageTimestamp, 13, 'ein mitgegebener Zeitpunkt gewinnt');
});

test('Gauntlet ohne Kampfprofil: echter EntityManager-Weg heilt über Player.update-Signatur', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'gauntlet' });
    const em = Object.create(EntityManager.prototype);
    em._simulationClockMs = 60_000;
    const player = makePlayer(em, { lastDamageTimestamp: 50 });
    strategy.updateHealthRegen(player, 0.5, player.entityManager);
    close(player.hp, 51.5, '150 * 2 % * 0,5 s');
});

test('Daily und Waffenrennen bleiben ohne Grund-Regeneration bzw. beim alten Hunt-Regen', () => {
    const em = makeEntityManager(100);
    const daily = new ArcadeModeStrategy({ runType: 'gauntlet', isDailyChallenge: true });
    const dailyPlayer = makePlayer(em);
    daily.updateHealthRegen(dailyPlayer, 1, em);
    assert.equal(dailyPlayer.hp, 50, 'Daily-Gauntlet heilt nicht');

    const race = new ArcadeModeStrategy({ runType: 'weapon_race' });
    const racePlayer = makePlayer(em);
    race.updateHealthRegen(racePlayer, 1, em);
    close(racePlayer.hp, 52.5, 'Waffenrennen behält den Hunt-Regen (2,5 HP/s)');

    const dailyEndless = new ArcadeModeStrategy({ runType: 'endless_parcours', isDailyChallenge: true, combatProfile: 'hunt' });
    const huntPlayer = makePlayer(em, { maxHp: 100 });
    dailyEndless.updateHealthRegen(huntPlayer, 1, em);
    close(huntPlayer.hp, 52.5, 'Daily mit Kampfprofil behält den Hunt-Regen (2,5 HP/s) exakt wie bisher');
});

test('Befund: Hunt liest den EntityManager als Konfiguration und heilt mit den Rückfallwerten', () => {
    const hunt = new HuntModeStrategy();
    const em = Object.create(EntityManager.prototype);
    em.runtimeConfig = null;
    em._simulationClockMs = 10_000;
    const player = { hp: 50, maxHp: 100, lastDamageTimestamp: 6.5 };
    hunt.updateHealthRegen(player, 1, em);
    close(player.hp, 52.5, 'Player.update übergibt den EntityManager statt der Konfiguration: 2,5 HP/s statt HUNT 2,0');
});

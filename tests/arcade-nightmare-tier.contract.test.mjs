// DF1, decision 18.09.2026: the sector plan already knew a "nightmare" scale (1.24) that no menu
// could reach. It becomes an arcade-only run tier "Albtraum"; the global bot difficulty stays
// Leicht/Normal/Schwer, and the Daily keeps its fixed rules.

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { resolveArcadeDailySettings } from '../src/shared/contracts/ArcadeDailyRulesContract.js';
import { buildArcadeEncounterPlan } from '../src/core/runtime/GameRuntimeArcadeSupportOps.js';
import { buildArcadeSectorPlan, resolveArcadeSectorRuntimeProfile } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { ARCADE_DIFFICULTY_TIERS } from '../src/shared/contracts/ArcadeDifficultyContract.js';
import { resolveArcadeTierAggressiveness } from '../src/shared/contracts/ArcadeBotAggressionContract.js';
import { ARENA_WAVES_BOT_CAPACITY } from '../src/shared/contracts/ArenaWavesContract.js';
import { ArenaWavesRuntime } from '../src/core/arcade/ArenaWavesRuntime.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';

test('the run tier survives saving and loading and defaults to off', () => {
    assert.equal(normalizeArcadeRunSettings({}).nightmare, false);
    assert.equal(normalizeArcadeRunSettings({ nightmare: true }).nightmare, true);
    assert.equal(normalizeArcadeRunSettings({ nightmare: 'yes' }).nightmare, false);
});

test('the Daily ignores the run tier', () => {
    const daily = resolveArcadeDailySettings({
        localSettings: { modePath: 'arcade' },
        arcade: { dailyChallenge: true, nightmare: true },
    });
    assert.equal(daily.arcade.nightmare, false);
});

test('a nightmare run builds its sectors with the nightmare scale', () => {
    const config = (difficultyTierId) => ({
        arcade: { enabled: true, seed: 7, sectorCount: 5, difficultyTierId },
        bot: { activeDifficulty: 'HARD' },
        session: { mapKey: 'standard' },
    });
    const pressures = (plan) => plan.sequence.map((entry) => entry.pressure);
    const store = { readJsonRecordResult: () => ({ status: 'found', value: { schemaVersion: 'arcade-difficulty-progress.v1', unlockedTierIds: ['normal', 'hard', 'nightmare'] } }) };
    const nightmarePlan = buildArcadeEncounterPlan(config('nightmare'), store);
    const hardPlan = buildArcadeEncounterPlan(config('hard'), store);
    assert.equal(buildArcadeEncounterPlan(config('nightmare')).tierId, 'normal', 'locked nightmare is normal');
    assert.deepEqual(
        pressures(nightmarePlan),
        pressures(buildArcadeSectorPlan({ seed: 7, sectorCount: 5, difficulty: 'nightmare' })),
    );
    assert.notDeepEqual(pressures(nightmarePlan), pressures(hardPlan));
});

// D5: Albtraum shares the HARD bot AI with Hart. Two tier properties set it apart: less healing
// in the intermission and more aggressive bots.
test('nightmare heals less in the intermission than hard', () => {
    const hard = ARCADE_DIFFICULTY_TIERS.find((tier) => tier.id === 'hard');
    const nightmare = ARCADE_DIFFICULTY_TIERS.find((tier) => tier.id === 'nightmare');
    assert.ok(nightmare.intermissionHealFactor < hard.intermissionHealFactor);
    const healed = (tierId) => {
        const strategy = new ArcadeModeStrategy();
        strategy._botRankBonuses = Object.freeze({ botStrength: { tierId } });
        const player = { alive: true, hp: 10, maxHp: 100, shieldHP: 0, maxShieldHp: 40 };
        return strategy.applyIntermissionHealing(player, { totalMissions: 0 }).healed;
    };
    assert.equal(healed('hard'), 12, 'hard keeps the base heal');
    assert.equal(healed('nightmare'), Math.round(100 * 0.12 * nightmare.intermissionHealFactor));
    assert.equal(healed(undefined), 12, 'runs without a tier keep the base heal');
});

test('nightmare bots drive more aggressively than hard bots', () => {
    const hard = ARCADE_DIFFICULTY_TIERS.find((tier) => tier.id === 'hard');
    const nightmare = ARCADE_DIFFICULTY_TIERS.find((tier) => tier.id === 'nightmare');
    assert.ok(nightmare.aggressionBonus > hard.aggressionBonus);
    assert.ok(Math.abs(resolveArcadeTierAggressiveness(0.5, 'nightmare') - (0.5 + nightmare.aggressionBonus)) < 1e-9);
    assert.equal(resolveArcadeTierAggressiveness(0.5, 'hard'), 0.5);
    assert.equal(resolveArcadeTierAggressiveness(0.97, 'nightmare'), 1, 'stays inside the aggressiveness range');

    const profiles = (difficulty) => buildArcadeSectorPlan({ seed: 7, sectorCount: 5, difficulty }).sequence
        .map((entry) => resolveArcadeSectorRuntimeProfile(entry, {}).aggressiveness);
    const hardSectors = profiles('hard');
    const nightmareSectors = profiles('nightmare');
    assert.ok(nightmareSectors.some((value, index) => value > hardSectors[index]), `${hardSectors} vs ${nightmareSectors}`);
    assert.ok(nightmareSectors.every((value, index) => value >= hardSectors[index]));
});

test('nightmare raises the arena waves aggressiveness too', () => {
    const authored = (tierId) => {
        const values = [];
        const human = { index: 0, isBot: false, alive: true, maxHp: 100, hp: 100, baseSpeed: 10, speed: 10, fightLoadout: {}, position: { x: 0, y: 1, z: 0 } };
        const bots = Array.from({ length: ARENA_WAVES_BOT_CAPACITY }, (_, slot) => ({ player: { index: slot + 1, isBot: true, alive: false, maxHp: 100, hp: 100 }, ai: { setArcadeBotAggressiveness(value) { values.push(value); } } }));
        const manager = {
            humanPlayers: [human], players: [human, ...bots.map((entry) => entry.player)], bots,
            _findSpawnPosition(_x, _z, { player }) { return { x: player.index, y: 1, z: 9 }; },
            activateBotSlot({ slot }) { bots[slot].player.alive = true; return true; },
            deactivateBotSlot(slot) { bots[slot].player.alive = false; return true; },
            powerupManager: { spawnAtAnchor() {} },
        };
        const runtime = new ArenaWavesRuntime();
        runtime.rankContext = { tierId, botStrength: { ai: 'HARD', tierId } };
        runtime.start({ entityManager: manager });
        runtime.update(5); runtime.update(1);
        return values;
    };
    const hard = authored('hard');
    const nightmare = authored('nightmare');
    assert.equal(hard.length, 2);
    assert.ok(nightmare.every((value, index) => value > hard[index]), `${hard} vs ${nightmare}`);
});

test('the arcade menu switch writes and mirrors the run tier', async () => {
    const { bindArcadeNightmareToggle, syncArcadeNightmareToggle } = await import('../src/ui/arcade/ArcadeNightmareToggle.js');
    const input = { value: 'normal', options: ['normal', 'hard', 'nightmare'].map(value => ({ value })) };
    const settings = { arcade: { sectorCount: 5 } };
    let handler = null;
    let changes = 0;
    bindArcadeNightmareToggle(input, settings, (_el, type, fn) => { if (type === 'change') handler = fn; }, () => { changes += 1; });
    input.value = 'hard'; handler();
    assert.equal(settings.arcade.difficultyTierId, 'hard');
    assert.equal(changes, 1);
    settings.arcade.difficultyTierId = 'normal';
    syncArcadeNightmareToggle(input, settings);
    assert.equal(input.value, 'normal');
    assert.equal(input.options[1].disabled, true);
});
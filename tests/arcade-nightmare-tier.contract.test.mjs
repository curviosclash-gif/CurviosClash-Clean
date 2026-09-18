// DF1, decision 18.09.2026: the sector plan already knew a "nightmare" scale (1.24) that no menu
// could reach. It becomes an arcade-only run tier "Albtraum"; the global bot difficulty stays
// Leicht/Normal/Schwer, and the Daily keeps its fixed rules.

import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { resolveArcadeDailySettings } from '../src/shared/contracts/ArcadeDailyRulesContract.js';
import { GameRuntimeArcadeSupport } from '../src/core/runtime/GameRuntimeArcadeSupport.js';
import { buildArcadeSectorPlan } from '../src/entities/directors/ArcadeEncounterCatalog.js';

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
    const support = Object.create(GameRuntimeArcadeSupport.prototype);
    const config = (nightmare) => ({
        arcade: { enabled: true, seed: 7, sectorCount: 5, nightmare },
        bot: { activeDifficulty: 'HARD' },
        session: { mapKey: 'standard' },
    });
    const pressures = (plan) => plan.sequence.map((entry) => entry.pressure);
    const nightmarePlan = support._buildEncounterPlan(config(true));
    const hardPlan = support._buildEncounterPlan(config(false));
    assert.deepEqual(
        pressures(nightmarePlan),
        pressures(buildArcadeSectorPlan({ seed: 7, sectorCount: 5, difficulty: 'nightmare' })),
    );
    assert.notDeepEqual(pressures(nightmarePlan), pressures(hardPlan));
});

test('the arcade menu switch writes and mirrors the run tier', async () => {
    const { bindArcadeNightmareToggle, syncArcadeNightmareToggle } = await import('../src/ui/arcade/ArcadeNightmareToggle.js');
    const input = { checked: false };
    const settings = { arcade: { sectorCount: 5 } };
    let handler = null;
    let changes = 0;
    bindArcadeNightmareToggle(input, settings, (_el, type, fn) => { if (type === 'change') handler = fn; }, () => { changes += 1; });
    input.checked = true; handler();
    assert.equal(settings.arcade.nightmare, true);
    assert.equal(changes, 1);
    settings.arcade.nightmare = false;
    syncArcadeNightmareToggle(input, settings);
    assert.equal(input.checked, false);
});
// D3: the intermission route choice. Alternatives used to follow the sector index, so every run
// offered the same routes; a swapped modifier kept the pressure of the planned one. Now the
// alternatives come from the run seed (deterministic), each option carries its pressure and its
// score bonus, and the sector profile re-derives the pressure from the chosen modifier.

import assert from 'node:assert/strict';
import test from 'node:test';

import { registerMapCatalogConfigSource } from '../src/shared/contracts/RuntimeMapCatalogContract.js';

registerMapCatalogConfigSource({
    MAPS: Object.fromEntries(['standard', 'burg', 'canyon', 'maze', 'trench', 'pyramid', 'crossfire', 'foam_forest', 'complex']
        .map((key) => [key, { name: key, size: [80, 30, 80] }])),
});

const { buildArcadeIntermissionChoices } = await import('../src/core/arcade/ArcadeIntermissionPlanOps.js');
const {
    ARCADE_SECTOR_MODIFIERS,
    ARCADE_SQUAD_PROFILES,
    buildArcadeSectorPlan,
    resolveArcadeSectorRuntimeProfile,
} = await import('../src/entities/directors/ArcadeEncounterCatalog.js');

const modifier = (id) => ARCADE_SECTOR_MODIFIERS.find((entry) => entry.id === id);

function runtimeFor(seed, entry) {
    return {
        _state: { mapSequence: ['standard', 'standard', 'standard'], config: { seed } },
        _activeModifierId: '',
        _resolveActiveRunSeed: () => seed,
        _getEncounterSectorEntry: () => entry,
    };
}

const plainEntry = { parcoursEnabled: false, modifierId: 'tight_turns', squadId: 'striker_tri', objectiveId: 'clean_sector' };

test('route alternatives follow the run seed and stay deterministic', () => {
    const signature = (seed) => buildArcadeIntermissionChoices(runtimeFor(seed, plainEntry), 2)
        .map((choice) => `${choice.mapKey}/${choice.modifierId}`).join(',');
    assert.equal(signature(11), signature(11), 'same seed, same routes');
    const variants = new Set(Array.from({ length: 12 }, (_, seed) => signature(seed + 1)));
    assert.ok(variants.size > 1, `different seeds offer different routes: ${[...variants].join(' | ')}`);
});

test('every route option carries its score bonus and pressure', () => {
    const entry = buildArcadeSectorPlan({ seed: 3, sectorCount: 8, difficulty: 'hard' }).sequence[1];
    assert.equal(entry.scenarioId, undefined);
    const choices = buildArcadeIntermissionChoices(runtimeFor(3, entry), 2);
    assert.ok(choices.length >= 2);
    const scale = 1.12;
    for (const choice of choices) {
        const def = modifier(choice.modifierId);
        assert.equal(choice.scoreBonus, def?.scoreBonus || 0, choice.id);
        const expected = choice.source === 'plan'
            ? entry.pressure
            : Number(Math.min(1, (ARCADE_SQUAD_PROFILES[entry.squadId].pressure + (def?.difficultyDelta || 0)) * scale).toFixed(3));
        assert.ok(Math.abs(choice.pressure - expected) < 1e-9, `${choice.id}: ${choice.pressure} vs ${expected}`);
    }
});

test('a swapped modifier re-derives the sector pressure for the bots', () => {
    const entry = buildArcadeSectorPlan({ seed: 5, sectorCount: 8, difficulty: 'normal' }).sequence[0];
    assert.equal(entry.modifierId, 'tight_turns');
    // The intermission swap keeps every other entry field and only replaces modifier and bonus.
    const swapped = { ...entry, modifierId: 'boost_tax', scoreBonus: modifier('boost_tax').scoreBonus };
    const squad = ARCADE_SQUAD_PROFILES[entry.squadId].pressure;
    const profile = resolveArcadeSectorRuntimeProfile(swapped, { fallbackDifficulty: 'EASY' });
    assert.ok(Math.abs(profile.pressure - Math.min(1, squad + modifier('boost_tax').difficultyDelta)) < 1e-9, String(profile.pressure));
    assert.equal(resolveArcadeSectorRuntimeProfile(entry, {}).pressure, entry.pressure, 'the planned modifier keeps the planned pressure');
});

test('the run runtime swap reaches the sector profile with the new pressure', async () => {
    const { ArcadeRunRuntime } = await import('../src/core/arcade/ArcadeRunRuntime.js');
    const plan = buildArcadeSectorPlan({ seed: 5, sectorCount: 8, difficulty: 'normal' });
    const runtime = new ArcadeRunRuntime();
    runtime._state = {
        encounterSequence: plan.sequence.map((entry) => ({ ...entry })),
        mapSequence: plan.sequence.map((entry) => entry.mapKey),
        completedSectors: 0,
        config: { seed: 5 },
        intermission: { nextSectorIndex: 1, choices: [{ id: 'alt-maze-boost_tax', mapKey: 'maze', modifierId: 'boost_tax' }] },
    };
    const before = runtime.getSectorRuntimeProfile(1).pressure;
    runtime.selectIntermissionChoice('alt-maze-boost_tax');
    const squad = ARCADE_SQUAD_PROFILES[plan.sequence[0].squadId].pressure;
    const after = runtime.getSectorRuntimeProfile(1).pressure;
    assert.equal(before, plan.sequence[0].pressure);
    assert.ok(Math.abs(after - (squad + modifier('boost_tax').difficultyDelta)) < 1e-9, `${before} -> ${after}`);
});

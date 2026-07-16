import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAirframeMasteryState, awardAirframeXp } from '../src/entities/arcade/AirframeMasteryOps.js';
import {
    createArcadeBlueprintFromVehicleConfig,
    validateArcadeBlueprint,
} from '../src/entities/arcade/ArcadeBlueprintSchema.js';
import { buildArcadeSectorPlan } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { createArcadeEncounterDirector } from '../src/entities/directors/ArcadeEncounterDirector.js';

test('Arcade sector plan is deterministic per seed', () => {
    const first = buildArcadeSectorPlan({ seed: 'seed-123', sectorCount: 6, difficulty: 'normal' });
    const second = buildArcadeSectorPlan({ seed: 'seed-123', sectorCount: 6, difficulty: 'normal' });
    const third = buildArcadeSectorPlan({ seed: 'seed-321', sectorCount: 6, difficulty: 'normal' });

    assert.deepEqual(first.sequence, second.sequence);
    assert.notDeepEqual(first.sequence, third.sequence);
});

test('Arcade encounter director consumes sectors in order and tracks completion', () => {
    const director = createArcadeEncounterDirector({ seed: 'dir-seed', sectorCount: 3, difficulty: 'hard' });
    assert.equal(director.peekNextSector()?.sectorNumber, 1);

    director.consumeNextSector({ outcome: 'cleared' });
    assert.equal(director.peekNextSector()?.sectorNumber, 2);

    const snapshot = director.getSnapshot();
    assert.equal(snapshot.cursor, 1);
    assert.equal(snapshot.completed.length, 1);
    assert.equal(snapshot.remaining, 2);
});

test('Airframe mastery XP upgrades level and editor budget', () => {
    const base = createAirframeMasteryState('ship5', { airframeXp: 0 });
    const upgraded = awardAirframeXp(base, 1000);

    assert.equal(base.airframeLevel, 1);
    assert.ok(upgraded.airframeLevel > base.airframeLevel);
    assert.ok(upgraded.editorBudget > base.editorBudget);
    assert.ok(upgraded.unlockedPartFamilies.length > 0);
});

test('Arcade blueprint validation rejects missing required slots', () => {
    const blueprint = createArcadeBlueprintFromVehicleConfig({
        label: 'Invalid Build',
        parts: [{ name: 'Core Body', geo: 'box', size: [1.4, 1.2, 2.8], pos: [0, 0, 0] }],
    });
    const validation = validateArcadeBlueprint(blueprint);

    assert.equal(validation.ok, false);
    assert.ok(validation.errors.some((entry) => entry.includes('missing required slot')));
});

test('Arcade blueprint validation accepts a balanced required-slot layout', () => {
    const blueprint = createArcadeBlueprintFromVehicleConfig({
        label: 'Balanced Build',
        parts: [
            { name: 'Core Body', geo: 'box', size: [1.2, 0.9, 2.4], pos: [0, 0, 0] },
            { name: 'Nose Cone', geo: 'cone', size: [0.4, 1.2], pos: [0, 0, -1.8] },
            { name: 'L-Wing', geo: 'box', size: [1.6, 0.12, 0.9], pos: [-1.3, 0, 0.2] },
            { name: 'R-Wing', geo: 'box', size: [1.6, 0.12, 0.9], pos: [1.3, 0, 0.2] },
            { name: 'L-Engine', geo: 'engine', size: [0.18, 0.16, 0.5], pos: [-1.1, 0, 1.0] },
            { name: 'R-Engine', geo: 'engine', size: [0.18, 0.16, 0.5], pos: [1.1, 0, 1.0] },
        ],
    }, {
        hitboxClass: 'compact',
        editorBudget: 110,
        massBudget: 100,
        powerBudget: 110,
        heatBudget: 100,
    });
    const validation = validateArcadeBlueprint(blueprint);

    assert.equal(validation.ok, true);
    assert.deepEqual(validation.errors, []);
});

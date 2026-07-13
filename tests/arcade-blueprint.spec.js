import { expect, test } from '@playwright/test';

import { createAirframeMasteryState, awardAirframeXp } from '../src/entities/arcade/AirframeMasteryOps.js';
import {
    createArcadeBlueprintFromVehicleConfig,
    validateArcadeBlueprint,
} from '../src/entities/arcade/ArcadeBlueprintSchema.js';
import { buildArcadeSectorPlan } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { createArcadeEncounterDirector } from '../src/entities/directors/ArcadeEncounterDirector.js';

test.describe('Arcade Encounter Director', () => {
    test('sector plan is deterministic per seed', () => {
        const first = buildArcadeSectorPlan({ seed: 'seed-123', sectorCount: 6, difficulty: 'normal' });
        const second = buildArcadeSectorPlan({ seed: 'seed-123', sectorCount: 6, difficulty: 'normal' });
        const third = buildArcadeSectorPlan({ seed: 'seed-321', sectorCount: 6, difficulty: 'normal' });

        expect(first.sequence).toEqual(second.sequence);
        expect(first.sequence).not.toEqual(third.sequence);
    });

    test('director consumes sectors in order and tracks completion', () => {
        const director = createArcadeEncounterDirector({ seed: 'dir-seed', sectorCount: 3, difficulty: 'hard' });
        const firstPeek = director.peekNextSector();
        expect(firstPeek?.sectorNumber).toBe(1);

        director.consumeNextSector({ outcome: 'cleared' });
        const secondPeek = director.peekNextSector();
        expect(secondPeek?.sectorNumber).toBe(2);

        const snapshot = director.getSnapshot();
        expect(snapshot.cursor).toBe(1);
        expect(snapshot.completed).toHaveLength(1);
        expect(snapshot.remaining).toBe(2);
    });
});

test.describe('Airframe Mastery', () => {
    test('xp gain upgrades level and editor budget', () => {
        const base = createAirframeMasteryState('ship5', { airframeXp: 0 });
        const upgraded = awardAirframeXp(base, 1000);

        expect(base.airframeLevel).toBe(1);
        expect(upgraded.airframeLevel).toBeGreaterThan(base.airframeLevel);
        expect(upgraded.editorBudget).toBeGreaterThan(base.editorBudget);
        expect(upgraded.unlockedPartFamilies.length).toBeGreaterThan(0);
    });
});

test.describe('Arcade Blueprint Schema', () => {
    test('blueprint fails when required slots are missing', () => {
        const blueprint = createArcadeBlueprintFromVehicleConfig({
            label: 'Invalid Build',
            parts: [{ name: 'Core Body', geo: 'box', size: [1.4, 1.2, 2.8], pos: [0, 0, 0] }],
        });
        const validation = validateArcadeBlueprint(blueprint);

        expect(validation.ok).toBeFalsy();
        expect(validation.errors.some((entry) => entry.includes('missing required slot'))).toBeTruthy();
    });

    test('blueprint passes with balanced required slot layout', () => {
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

        expect(validation.ok).toBeTruthy();
        expect(validation.errors).toHaveLength(0);
    });
});

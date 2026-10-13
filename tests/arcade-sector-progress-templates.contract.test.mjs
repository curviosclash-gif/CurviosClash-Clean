// D2: sector templates follow the run progress, not fixed sector numbers. A default run of five
// sectors used to end inside the pressure template and never met hazard_lane or the heavier
// modifiers; a 20-sector run keeps the authored sector numbers.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ARCADE_SECTOR_CATALOG, buildArcadeSectorPlan } from '../src/entities/directors/ArcadeEncounterCatalog.js';

const legacyTemplate = (sectorNumber) => ARCADE_SECTOR_CATALOG.find((template) => (
    sectorNumber >= template.minSector && sectorNumber <= template.maxSector
)).id;

const seeds = Array.from({ length: 24 }, (_, index) => `progress-${index}`);

test('a five-sector run starts in the intro and reaches the late templates', () => {
    const objectives = new Set();
    const modifiers = new Set();
    for (const seed of seeds) {
        const plan = buildArcadeSectorPlan({ seed, sectorCount: 5, difficulty: 'normal' });
        const templates = plan.sequence.map((entry) => entry.templateId);
        assert.deepEqual(templates, ['sector_intro', 'sector_pressure', 'sector_endurance', 'sector_parcours', 'sector_endurance'], seed);
        assert.equal(plan.sequence[3].parcoursEnabled, true, 'every fourth sector stays a parcours');
        assert.equal(plan.sequence[4].isBoss, true, 'the last sector stays the boss');
        for (const entry of plan.sequence) {
            if (entry.objectiveId) objectives.add(entry.objectiveId);
            if (entry.modifierId) modifiers.add(entry.modifierId);
        }
    }
    assert.ok(objectives.has('hazard_lane'), [...objectives].join(','));
    assert.ok(modifiers.has('portal_storm') && modifiers.has('boost_tax'), [...modifiers].join(','));
});

test('a 20-sector run keeps the authored template numbers', () => {
    const plan = buildArcadeSectorPlan({ seed: 'long-run', sectorCount: 20, difficulty: 'normal' });
    for (const entry of plan.sequence) {
        if (entry.parcoursEnabled) continue;
        assert.equal(entry.templateId, legacyTemplate(entry.sectorNumber), `sector ${entry.sectorNumber}`);
    }
    assert.deepEqual(plan.sequence.filter((entry) => entry.parcoursEnabled).map((entry) => entry.sectorNumber), [4, 8, 12, 16]);
});

test('the Daily keeps its fixed sector-number templates', () => {
    const plan = buildArcadeSectorPlan({ seed: 'daily-progress', sectorCount: 5, dailyChallenge: true });
    assert.deepEqual(plan.sequence.filter((entry) => !entry.parcoursEnabled).map((entry) => entry.templateId),
        plan.sequence.filter((entry) => !entry.parcoursEnabled).map((entry) => legacyTemplate(entry.sectorNumber)));
});

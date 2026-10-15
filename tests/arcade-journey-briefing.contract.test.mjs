import test from 'node:test';
import assert from 'node:assert/strict';
import { createArcadeJourneyBriefing } from '../src/core/arcade/ArcadeJourneyBriefing.js';
import { buildArcadeSectorPlan } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { createDefaultArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';

test('boss briefing is the real final encounter for the selected seed and tier', () => {
    for (const seed of [1, 3, 7, 8, 100]) for (const difficulty of ['normal', 'hard', 'nightmare']) {
        const finale = buildArcadeSectorPlan({ seed, difficulty,
            sectorCount: createDefaultArcadeRunSettings().sectorCount }).sequence.at(-1);
        const preview = createArcadeJourneyBriefing(seed, difficulty);
        assert.equal(preview.mapKey, finale.mapKey);
        assert.equal(preview.scenarioId, finale.scenarioId);
        if (finale.briefing) assert.equal(preview.text, finale.briefing);
        assert.ok(preview.label); assert.ok(preview.silhouette);
    }
});

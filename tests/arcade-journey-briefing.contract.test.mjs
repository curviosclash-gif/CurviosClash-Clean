import test from 'node:test';
import assert from 'node:assert/strict';
import { createArcadeJourneyBriefing } from '../src/core/arcade/ArcadeJourneyBriefing.js';

test('the first-route briefing describes the actual single Rift course and time targets', () => {
    for (const seed of [1, 3, 8, 100]) for (const tier of ['normal', 'hard', 'nightmare']) {
        const preview = createArcadeJourneyBriefing(seed, tier);
        assert.equal(preview.mapKey, 'parcours_rift');
        assert.equal(preview.label, 'Parcours Rift');
        assert.match(preview.text, /alle Checkpoints/);
        assert.match(preview.text, /75 Sekunden/);
        assert.equal(preview.scenarioId, undefined);
    }
});

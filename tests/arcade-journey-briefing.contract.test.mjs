import test from 'node:test';
import assert from 'node:assert/strict';
import { createArcadeJourneyBriefing } from '../src/core/arcade/ArcadeJourneyBriefing.js';

test('the first-route briefing describes all three fixed Rift sectors and the weaponless middle sector', () => {
    for (const seed of [1, 3, 8, 100]) for (const tier of ['normal', 'hard', 'nightmare']) {
        const preview = createArcadeJourneyBriefing(seed, tier);
        assert.equal(preview.mapKey, 'parcours_rift');
        assert.equal(preview.label, 'Parcours Rift');
        assert.match(preview.text, /drei Sektoren/);
        assert.match(preview.text, /Sektor 2 ist ohne Waffen/);
        assert.equal(preview.scenarioId, undefined);
    }
});

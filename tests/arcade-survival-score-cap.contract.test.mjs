// Balance B2 (playtest 17.09.2026): "Sektor säubern" has no time limit, so keeping the last bot
// alive grew the survival points without end (211 s -> 4589 points, other sectors 300-900).
// Decision 18.09.2026: survival points stop growing after 90 seconds; no objective lasts longer.

import assert from 'node:assert/strict';
import test from 'node:test';

import { computeArcadeSectorScoreBreakdown } from '../src/state/arcade/ArcadeScoreOps.js';
import { ARCADE_SECTOR_OBJECTIVES } from '../src/entities/directors/ArcadeEncounterCatalog.js';

const survivalAfter = (duration) => computeArcadeSectorScoreBreakdown(
    { duration, kills: 0, selfCollisions: 0, itemUses: 0, stuckEvents: 0 },
    { sectorTemplateId: 'sector_pressure' },
).survival;

test('survival points stop growing after 90 seconds', () => {
    assert.equal(survivalAfter(211), survivalAfter(90));
    assert.equal(survivalAfter(120), survivalAfter(90));
    assert.ok(survivalAfter(90) > survivalAfter(60), 'the first 90 seconds still count');
});

test('every sector objective ends inside the counted window', () => {
    for (const objective of ARCADE_SECTOR_OBJECTIVES) {
        assert.ok(objective.durationSec <= 90, `${objective.id} lasts ${objective.durationSec} s`);
        assert.ok(survivalAfter(objective.durationSec) < survivalAfter(90), objective.id);
    }
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    computeArcadeSectorScoreBreakdown,
    mergeArcadeRunRecords,
} from '../src/state/arcade/ArcadeScoreOps.js';
import { createArcadeRunRecords } from '../src/state/arcade/ArcadeRunState.js';
import { normalizeArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';

const SCORE_MODEL_V2 = 'arcade-score.v2';
const RECORD_SCHEMA_V2 = 'arcade-run-profile.v2';

test('score v2 rewards late survival non-linearly and caps invalid long durations', () => {
    const atTwenty = computeArcadeSectorScoreBreakdown({ duration: 20, selfCollisions: 1, itemUses: 1 });
    const atForty = computeArcadeSectorScoreBreakdown({ duration: 40, selfCollisions: 1, itemUses: 1 });
    const atCap = computeArcadeSectorScoreBreakdown({ duration: 180, selfCollisions: 1, itemUses: 1 });
    const beyondCap = computeArcadeSectorScoreBreakdown({ duration: 1000, selfCollisions: 1, itemUses: 1 });

    assert.equal(atTwenty.survival, 200);
    assert.equal(atForty.survival, 480);
    assert.ok(atForty.survival > atTwenty.survival * 2);
    assert.equal(beyondCap.survival, atCap.survival);
});

test('persisted v1 settings migrate to the current score model', () => {
    assert.equal(normalizeArcadeRunSettings({ scoreModel: 'arcade-score.v1' }).scoreModel, SCORE_MODEL_V2);
    assert.equal(normalizeArcadeRunSettings({ scoreModel: 'unknown-model' }).scoreModel, SCORE_MODEL_V2);
});

test('legacy score records reset every score-dependent field during v2 migration', () => {
    const migrated = createArcadeRunRecords({
        schemaVersion: 'arcade-run-profile.v1',
        bestScore: 9999,
        lastScore: 8888,
        breakdownTotals: { survival: 7777, total: 7777 },
        replay: { lastRunId: 'legacy-last', bestRunId: 'legacy-best' },
        daily: { seed: 20260811, runsPlayed: 4, bestScore: 6666, lastScore: 5555 },
    });

    assert.equal(migrated.schemaVersion, RECORD_SCHEMA_V2);
    assert.equal(migrated.scoreModel, SCORE_MODEL_V2);
    assert.equal(migrated.bestScore, 0);
    assert.equal(migrated.lastScore, 0);
    assert.equal(migrated.breakdownTotals.total, 0);
    assert.deepEqual(migrated.replay, { lastRunId: '', bestRunId: '' });
    assert.equal(migrated.daily.runsPlayed, 0);
    assert.equal(migrated.daily.bestScore, 0);
});

test('current v2 records preserve comparable scores', () => {
    const current = createArcadeRunRecords({
        schemaVersion: RECORD_SCHEMA_V2,
        scoreModel: SCORE_MODEL_V2,
        runsPlayed: 3,
        bestScore: 1234,
        lastScore: 900,
    });

    assert.equal(current.runsPlayed, 3);
    assert.equal(current.bestScore, 1234);
    assert.equal(current.lastScore, 900);
});

test('record merge rejects summaries from an incompatible score model', () => {
    const current = createArcadeRunRecords({
        schemaVersion: RECORD_SCHEMA_V2,
        scoreModel: SCORE_MODEL_V2,
        runsPlayed: 3,
        bestScore: 1234,
    });
    const merged = mergeArcadeRunRecords(current, {
        scoreModel: 'arcade-score.v1',
        score: 9999,
    });

    assert.deepEqual(merged, current);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    computeArcadeSectorScoreBreakdown,
    mergeArcadeRunRecords,
} from '../src/state/arcade/ArcadeScoreOps.js';
import { createArcadeRunRecords } from '../src/state/arcade/ArcadeRunState.js';
import {
    ARCADE_RUN_PROFILE_SCHEMA_VERSION,
    ARCADE_RUN_PROFILE_STORAGE_KEY,
    normalizeArcadeRunSettings,
} from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import {
    createArcadeScorePresentation,
    createArcadeSectorScorePresentation,
} from '../src/shared/contracts/ArcadeScorePresentationContract.js';

const SCORE_MODEL_V2 = 'arcade-score.v3';
const RECORD_SCHEMA_V2 = ARCADE_RUN_PROFILE_SCHEMA_VERSION;

test('run profile uses a separate v3 key and current payload schema explicit', () => {
    assert.equal(ARCADE_RUN_PROFILE_STORAGE_KEY, 'cuviosclash.arcade-run-profile.v3');
    assert.equal(ARCADE_RUN_PROFILE_SCHEMA_VERSION, 'arcade-run-profile.v3');
});

test('score presentation reconciles raw components with multiplied awarded points', () => {
    const presentation = createArcadeScorePresentation({
        base: 100,
        survival: 50,
        kills: 20,
        penalty: 10,
    }, 320);

    assert.deepEqual(presentation, {
        rawSubtotal: 160,
        multiplierBonus: 160,
        scoredTotal: 320,
    });
});

test('sector score presentation separates rounded factors from the mission bonus', () => {
    const presentation = createArcadeSectorScorePresentation({
        breakdown: { base: 101, kills: 20, penalty: 1 },
        scoreFactor: 1.333,
        missionBonus: 75,
        awardedPoints: 235,
    });

    assert.deepEqual(presentation, {
        rawSubtotal: 120,
        factor: 1.333,
        factoredPoints: 160,
        multiplierBonus: 40,
        missionBonus: 75,
        scoredTotal: 235,
    });
    assert.equal(presentation.factoredPoints + presentation.missionBonus, presentation.scoredTotal);
});

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

test('legacy score records reset every score-dependent field in the new v3 record', () => {
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

test('current v3 records preserve comparable scores', () => {
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

test('unknown future run profiles fall back without importing incomparable fields', () => {
    const fallback = createArcadeRunRecords({
        schemaVersion: 'arcade-run-profile.v99',
        scoreModel: SCORE_MODEL_V2,
        runsPlayed: 88,
        bestScore: 999999,
    });

    assert.equal(fallback.schemaVersion, RECORD_SCHEMA_V2);
    assert.equal(fallback.runsPlayed, 0);
    assert.equal(fallback.bestScore, 0);
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

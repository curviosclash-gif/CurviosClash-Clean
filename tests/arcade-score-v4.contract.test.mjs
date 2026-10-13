import assert from 'node:assert/strict';
import test from 'node:test';

import { computeArcadeSectorScoreBreakdown, applyArcadeSectorScore } from '../src/state/arcade/ArcadeScoreOps.js';
import {
    beginArcadeSector,
    completeArcadeSector,
    createArcadeRunState,
} from '../src/state/arcade/ArcadeRunState.js';

function scoreObjective({ elapsed, durationSec, timeLimited = true, completed = true, failed = false, kills = 2 }) {
    return computeArcadeSectorScoreBreakdown({
        duration: elapsed,
        kills,
        selfCollisions: 0,
        itemUses: 0,
        stuckEvents: 0,
    }, {
        sectorTemplateId: 'sector_intro',
        objective: {
            id: 'destroy_units',
            timeLimited,
            durationSec,
            completed,
            failed,
            simulatedDurationSec: elapsed,
        },
    });
}

test('v4 pays faster successful objectives more at equal kills and caps 90/120 second targets', () => {
    const quick = scoreObjective({ elapsed: 20, durationSec: 90 });
    const delayed = scoreObjective({ elapsed: 70, durationSec: 90 });
    assert.equal(quick.kills, 120);
    assert.equal(quick.survival, 100);
    assert.equal(quick.time, 700);
    assert.ok(quick.total > delayed.total, 'the same successful objective and kills score better when completed sooner');

    const atNinety = scoreObjective({ elapsed: 90, durationSec: 90 });
    const afterNinety = scoreObjective({ elapsed: 240, durationSec: 90 });
    assert.equal(atNinety.survival, 450);
    assert.equal(afterNinety.survival, atNinety.survival);
    assert.equal(afterNinety.time, 0);

    const atOneHundred = scoreObjective({ elapsed: 100, durationSec: 120 });
    const afterOneHundredTwenty = scoreObjective({ elapsed: 180, durationSec: 120 });
    assert.equal(atOneHundred.survival, 500);
    assert.equal(atOneHundred.time, 200);
    assert.equal(afterOneHundredTwenty.survival, 600);
    assert.equal(afterOneHundredTwenty.time, 0);
});

test('untimed goals ignore their normalized one-second value and use one bounded scoring window', () => {
    const quick = scoreObjective({ elapsed: 30, durationSec: 1, timeLimited: false });
    const atWindow = scoreObjective({ elapsed: 90, durationSec: 1, timeLimited: false });
    const afterWindow = scoreObjective({ elapsed: 240, durationSec: 1, timeLimited: false });

    assert.equal(quick.survival, 150);
    assert.equal(quick.time, 600);
    assert.ok(quick.total > atWindow.total, 'waiting before an untimed goal completes cannot increase its score');
    assert.equal(afterWindow.survival, atWindow.survival);
    assert.equal(afterWindow.time, atWindow.time);
});

test('failed objectives receive no completion-time bonus and aborted runs do not score', () => {
    const failed = scoreObjective({ elapsed: 1, durationSec: 90, completed: false, failed: true });
    const succeeded = scoreObjective({ elapsed: 1, durationSec: 90 });
    assert.equal(failed.time, 0);
    assert.ok(succeeded.total > failed.total, 'a fast death cannot masquerade as a fast objective completion');

    const run = createArcadeRunState({ config: { enabled: true }, nowMs: 0 });
    const result = applyArcadeSectorScore(run, { reason: 'QUIT', duration: 1, kills: 9 }, { nowMs: 1000 });
    assert.equal(result.aborted, true);
    assert.equal(result.score.total, 0);
    assert.equal(result.lastSectorSummary, null);

    const dead = { ...run, objectiveState: { sectorIndex: 1, objectiveId: 'destroy_units', failed: true } };
    const deathResult = applyArcadeSectorScore(dead, { reason: 'ELIMINATION', duration: 1, kills: 9 }, { nowMs: 1000 });
    assert.equal(deathResult.score.total, 0, 'a death before objective completion cannot create a scored success sector');
});

test('the completed objective and simulation duration survive a paused delay and next-sector start', () => {
    let state = beginArcadeSector(createArcadeRunState({
        config: { enabled: true, sectorCount: 3 },
        nowMs: 0,
        runId: 'arcade-score-v4-snapshot',
    }), 0);
    state.encounterSequence = [
        { templateId: 'sector_intro', encounterId: 'completed-90s-goal' },
        { templateId: 'sector_pressure', encounterId: 'next-120s-goal' },
    ];
    state.objectiveState = {
        sectorIndex: 1,
        objectiveId: 'destroy_units',
        completed: true,
        failed: false,
        timeLimited: true,
        durationSec: 90,
        scoreWeight: 1.5,
        elapsedSec: 25,
    };
    state = completeArcadeSector(state, 1000, { simulatedDurationSec: 25 });
    assert.deepEqual(state.lastCompletedSectorResult.objectiveSnapshot, {
        sectorIndex: 1,
        id: 'destroy_units',
        completed: true,
        failed: false,
        timeLimited: true,
        durationSec: 90,
        scoreWeight: 1.5,
        simulatedDurationSec: 25,
    });

    // Simulate the intermission pause and the next sector becoming active before telemetry arrives.
    state = beginArcadeSector(state, 500_000);
    state.objectiveState = {
        sectorIndex: 2,
        objectiveId: 'survive_window',
        completed: false,
        failed: false,
        timeLimited: true,
        durationSec: 120,
        scoreWeight: 2,
        elapsedSec: 0,
    };
    const scored = applyArcadeSectorScore(state, {
        state: 'ROUND_END',
        duration: 500,
        kills: 1,
        selfCollisions: 0,
        itemUses: 0,
        stuckEvents: 0,
    }, { nowMs: 501_000 });

    assert.equal(scored.score.breakdown.survival, 125, 'paused wall time is ignored in favor of completed-sector simulation time');
    assert.equal(scored.score.breakdown.time, 650);
    assert.equal(scored.lastSectorSummary.objectiveMultiplierApplied, 1.5, 'the previous objective weight survives next-sector initialization');
    assert.equal(scored.lastSectorSummary.encounterId, 'completed-90s-goal');
});

test('combat objective bonuses leave parcours scoring unchanged', () => {
    const parcours = computeArcadeSectorScoreBreakdown({ duration: 30, kills: 99 }, {
        sectorTemplateId: 'sector_parcours',
        parcours: { completionTimeMs: 30_000, referenceTimeMs: 60_000, checkpointCount: 10 },
        objective: { id: 'survive_window', completed: true, timeLimited: true, durationSec: 90, simulatedDurationSec: 30 },
    });
    assert.deepEqual([parcours.total, parcours.survival, parcours.kills, parcours.completion, parcours.checkpoints, parcours.time], [1700, 0, 0, 500, 250, 750]);
});

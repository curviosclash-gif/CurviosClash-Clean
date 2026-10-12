// The arcade test driver's bookkeeping: playtest events become per-sector damage and
// deaths of the human ship, the run's own sector history adds time, points and missions,
// and several runs sum up into one measurement. The live part runs in the desktop app.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildArcadeSectorRows,
    createArcadeRunTally,
    diffPilotCounters,
    recordArcadeEvents,
    summarizeArcadeRunAttempts,
} from '../scripts/playtest/playtest-scenarios-arcade.mjs';
import { SCENARIOS } from '../scripts/playtest/playtest-scenarios.mjs';

/** Shaped like the playtest control log: damage carries the flattened damage result. */
const damage = (seq, targetIndex, applied, absorbedByShield = 0, cause = 'PROJECTILE') => ({ seq, type: 'damage', targetIndex, cause, damageResult: { applied, absorbedByShield } });
const death = (seq, player, isHuman, cause = 'PROJECTILE') => ({ seq, type: 'death', player, isHuman, cause });

test('only damage and deaths of the human ship count, each in the sector it happened in', () => {
    const tally = createArcadeRunTally();
    recordArcadeEvents(tally, 1, [damage(1, 0, 12, 4), damage(2, 3, 50), death(3, 3, false)]);
    recordArcadeEvents(tally, 2, [damage(4, 0, 30), death(5, 0, true)]);
    assert.equal(tally.lastSeq, 5, 'the next read continues after the last event');
    const [first, second] = buildArcadeSectorRows(tally, []);
    assert.deepEqual([first.damageTaken, first.shieldAbsorbed, first.deaths], [12, 4, 0], 'bot hits and bot deaths stay out');
    assert.deepEqual([second.damageTaken, second.deaths], [30, 1]);
});

test('damage is split by cause and every death keeps its cause, so a crash reads apart from a lost fight', () => {
    const tally = createArcadeRunTally();
    recordArcadeEvents(tally, 1, [damage(1, 0, 20, 0, 'WALL'), damage(2, 0, 15, 0, 'PROJECTILE'), damage(3, 0, 30, 0, 'WALL'), death(4, 0, true, 'WALL')], { nowMs: 1000 });
    recordArcadeEvents(tally, 1, [], { nowMs: 21_000 });
    const [row] = buildArcadeSectorRows(tally, []);
    assert.deepEqual(row.damageByCause, { WALL: 50, PROJECTILE: 15 });
    assert.deepEqual(row.deathCauses, ['WALL']);
    assert.equal(row.secondsObserved, 20, 'the sector was watched for twenty seconds');
});

test('a sector row joins the run history: cleared sectors carry time, points, missions and kills', () => {
    const tally = createArcadeRunTally();
    recordArcadeEvents(tally, 1, [damage(1, 0, 10)]);
    recordArcadeEvents(tally, 2, [damage(2, 0, 90), death(3, 0, true)]);
    const rows = buildArcadeSectorRows(tally, [
        { sectorIndex: 1, mapKey: 'standard', objectiveId: 'bounty_hunt', duration: 41.6, awardedPoints: 1200, missionsCompleted: 2, missionsTotal: 3, kills: 2 },
    ]);
    assert.deepEqual(rows.map((row) => [row.sectorIndex, row.cleared]), [[1, true], [2, false]], 'the sector the ship died in was reached, not cleared');
    assert.deepEqual(
        [rows[0].seconds, rows[0].points, rows[0].missions, rows[0].kills, rows[0].objectiveId],
        [42, 1200, '2/3', 2, 'bounty_hunt'],
    );
    assert.equal(rows[1].points, 0);
});

test('the summary counts every run, including blocked and timed-out ones, and averages per sector', () => {
    const row = (sectorIndex, cleared, seconds, damageTaken) => ({ sectorIndex, cleared, seconds, damageTaken });
    const summary = summarizeArcadeRunAttempts([
        { seed: 101, succeeded: true, completedSectors: 2, sectors: [row(1, true, 40, 10), row(2, true, 60, 30)] },
        { seed: 102, succeeded: false, completedSectors: 1, sectors: [row(1, true, 50, 20), row(2, false, null, 90)] },
        { seed: 103, succeeded: false, timedOut: true, completedSectors: 0, sectors: [row(1, false, null, 5)] },
        { seed: 104, blocked: true },
    ]);
    assert.deepEqual([summary.runs, summary.blocked, summary.won, summary.timedOut], [4, 1, 1, 1]);
    assert.equal(summary.meanClearedSectors, 1, 'cleared sectors are averaged over the runs that played');
    assert.deepEqual(summary.sectors, [
        { sectorIndex: 1, reached: 3, cleared: 2, meanSeconds: 45, meanDamageTaken: 12 },
        { sectorIndex: 2, reached: 2, cleared: 1, meanSeconds: 60, meanDamageTaken: 60 },
    ]);
});

test('pilot counters of a run start at zero although the pilot keeps counting across runs', () => {
    assert.deepEqual(diffPilotCounters({ frames: 832, mgFrames: 4 }, { frames: 1656, mgFrames: 4 }), { frames: 824, mgFrames: 0 });
    assert.equal(diffPilotCounters({ frames: 1 }, null), null);
});

test('the arcade run is offered in the scenario catalog', () => {
    assert.equal(typeof SCENARIOS.arcade_run?.run, 'function');
    assert.match(SCENARIOS.arcade_run.description, /gauntlet/);
});

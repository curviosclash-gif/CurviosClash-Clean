// Combat sectors have no ghost to race. The record run now leaves its score after every sector
// behind, and the intermission says how the current run stands against it ("Rekordtempo").
import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/core/Config.js';
import { buildArcadeSectorPlan } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { createArcadeRunRecords } from '../src/state/arcade/ArcadeRunState.js';
import { resolveArcadeRunPaceKey } from '../src/state/arcade/ArcadeRunPaceOps.js';
import { createArcadeIntermissionBlocks } from '../src/ui/arcade/postrun/ArcadePostRunBlocks.js';

const pilot = { index: 0, isBot: false, alive: true, hp: 80, maxHp: 100 };

function playRun(run, kills, { sectors = 3, die = true } = {}) {
    const strategy = new ArcadeModeStrategy();
    run.startRun({ strategy, encounterPlan: buildArcadeSectorPlan({ seed: 21, sectorCount: sectors }) });
    const paces = [];
    for (let i = 0; i < kills.length; i += 1) {
        if (i > 0) run.beginNextSector();
        run.deriveRoundEndPlan({ players: [pilot], inputs: { reason: '' }, baseController: {} });
        run.handleRoundEndTelemetry({ state: 'ROUND_END', duration: 30, kills: kills[i] });
        paces.push(run.getIntermissionState()?.pace ?? null);
    }
    if (die) {
        run.beginNextSector();
        run.deriveRoundEndPlan({ players: [{ ...pilot, alive: false, hp: 0 }], inputs: { reason: '' }, baseController: {} });
        run.handleRoundEndTelemetry({ state: 'MATCH_END', duration: 2, kills: 0 });
    }
    return paces;
}

function createRun() {
    const run = new ArcadeRunRuntime({ strategy: new ArcadeModeStrategy(), now: () => 100000 });
    run.configure({ arcade: { enabled: true, seed: 21, sectorCount: 3 } });
    return run;
}

test('the intermission compares the run with the record run after the same sector', () => {
    const run = createRun();
    assert.deepEqual(playRun(run, [4, 4]), [null, null], 'the very first run has no record to race');

    const paces = playRun(run, [1, 6]);
    assert.equal(paces[0]?.sector, 1);
    assert.ok(paces[0].deltaPoints < 0, 'fewer kills in sector 1 put the run behind the record');
    assert.ok(paces[0].recordPoints > 0);
    assert.equal(typeof paces[1]?.deltaPoints, 'number', 'sector 2 is compared as well');
});

test('a run of another length is not compared, and the records keep the pace bounded', () => {
    const run = createRun();
    playRun(run, [4, 4]);
    run.configure({ arcade: { enabled: true, seed: 21, sectorCount: 5 } });
    assert.deepEqual(playRun(run, [4], { sectors: 5 }), [null], 'five sectors are another race than three');

    const records = createArcadeRunRecords({ ...run._records, pace: Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [`gauntlet:normal:${i + 1}:free`, { score: i, sectors: [i] }])
    ) });
    assert.ok(Object.keys(records.pace).length <= 12, 'at most twelve paces are kept');
    assert.deepEqual(createArcadeRunRecords({ ...run._records, pace: 'kaputt' }).pace, {});
});

test('the public daily start gets a separate pace key from a free run with the same config', () => {
    const run = createRun();
    const strategy = new ArcadeModeStrategy();
    const encounterPlan = buildArcadeSectorPlan({ seed: 21, sectorCount: 3 });
    run.startDailyChallenge({ strategy, encounterPlan, date: '2026-10-14' });
    const dailyState = run.getStateSnapshot();
    assert.equal(dailyState.isDailyChallenge, true);
    assert.equal(resolveArcadeRunPaceKey(dailyState), 'gauntlet:normal:3:daily');

    run.resetRunState();
    run.startRun({ strategy, encounterPlan });
    assert.equal(resolveArcadeRunPaceKey(run.getStateSnapshot()), 'gauntlet:normal:3:free');
});

test('the intermission card reads the pace in plain words', () => {
    const rowsOf = (pace) => createArcadeIntermissionBlocks({ lastSectorPoints: 100, pace })[0].rows;
    assert.match(rowsOf({ sector: 3, deltaPoints: 1240, recordPoints: 5000 }).find((row) => row.key === 'pace')?.value ?? '', /\+1\.240 vor deinem Rekord/);
    assert.match(rowsOf({ sector: 3, deltaPoints: -300, recordPoints: 5000 }).find((row) => row.key === 'pace')?.value ?? '', /300 hinter deinem Rekord/);
    assert.equal(rowsOf(null).find((row) => row.key === 'pace'), undefined);
});

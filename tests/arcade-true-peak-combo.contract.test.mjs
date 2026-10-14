// "Beste Kombo" after a run showed the best combo at a sector end, not the best combo of the run:
// a chain of nine kills that ran out before the sector ended was gone from the result.
import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/core/Config.js';
import { buildArcadeSectorPlan } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { buildArcadeRunSummary } from '../src/state/arcade/ArcadeScoreOps.js';

test('the best combo of a run counts even when it decays before the sector ends', () => {
    const strategy = new ArcadeModeStrategy();
    const run = new ArcadeRunRuntime({ strategy, now: () => 100000 });
    run.configure({ arcade: { enabled: true, seed: 7, sectorCount: 3 } });
    run.startRun({ strategy, encounterPlan: buildArcadeSectorPlan({ seed: 7, sectorCount: 3 }) });

    for (let i = 0; i < 9; i += 1) run.applyGameplayEvent({ type: 'kill', playerIndex: 0, victimIndex: 1 });
    assert.equal(run.getStateSnapshot().score.combo, 9);
    run.tickGameplay(30);
    assert.equal(run.getStateSnapshot().score.combo, 0, 'thirty quiet seconds drain the chain');

    const score = run.getStateSnapshot().score;
    assert.equal(score.peakCombo, 9, 'the nine-kill chain stays the best combo');
    assert.equal(score.peakMultiplier, 5, 'and its factor the best factor');
    assert.equal(buildArcadeRunSummary(run.getStateSnapshot()).peakCombo, 9);
});

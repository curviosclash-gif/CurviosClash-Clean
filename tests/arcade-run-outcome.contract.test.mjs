import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/core/Config.js';
import { ARCADE_SCENARIOS } from '../src/entities/directors/ArcadeScenarioCatalog.js';
import { buildArcadeSectorPlan } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { RoundStateController } from '../src/state/RoundStateController.js';

const CONVOY = ARCADE_SCENARIOS.find((entry) => entry.id === 'bridge_convoy');
const SEED = 16;

/**
 * A run whose first sector carries the convoy objective: one `unit_goal_reached` for a tank
 * fails it, which is the cheapest way to reach the "objective failed" sector end without
 * building the map units around it.
 */
function makeRun(sectorCount) {
    const strategy = new ArcadeModeStrategy();
    const run = new ArcadeRunRuntime({ strategy, now: () => 100000 });
    run.configure({ arcade: { enabled: true, seed: SEED, sectorCount } });
    const plan = buildArcadeSectorPlan({ seed: SEED, sectorCount });
    plan.sequence[0] = { ...plan.sequence[0], objectiveId: 'intercept', objective: CONVOY.objective };
    run.startRun({ strategy, encounterPlan: plan });
    return run;
}

const pilot = () => ({ index: 0, isBot: false, alive: true, hp: 80, maxHp: 100 });
const baseController = new RoundStateController();

test('a run whose final sector objective fails does not count as succeeded', () => {
    const run = makeRun(1);
    run.applyGameplayEvent({ type: 'unit_goal_reached', unitKind: 'tank' });
    const plan = run.deriveRoundEndPlan({ players: [pilot()], inputs: { reason: 'ARCADE_OBJECTIVE_FAILED' }, baseController });
    assert.equal(plan.outcome.state, 'MATCH_END');
    run.handleRoundEndTelemetry({ state: 'MATCH_END', duration: 5, kills: 0 });

    const summary = run.getStateSnapshot().postRunSummary;
    assert.ok(summary, 'the failed finale finalizes the run');
    assert.equal(summary.succeeded, false, 'a lost final sector is not a finished run');
    assert.equal(summary.aborted, false, 'it is a regular end, not an abort');
});

test('a run whose final sector is cleared still counts as succeeded', () => {
    const run = makeRun(1);
    const plan = run.deriveRoundEndPlan({ players: [pilot()], inputs: { reason: '' }, baseController });
    assert.equal(run.getPhase(), 'victory');
    assert.equal(plan.outcome.state, 'ROUND_END');
    run.handleRoundEndTelemetry({ state: 'ROUND_END', duration: 5, kills: 0 });
    run.resolveVictoryChoice('finish');

    assert.equal(run.getStateSnapshot().postRunSummary.succeeded, true);
});

/**
 * Decision 13.10.2026: quitting counts like dying. Both runs clear sector 1 of 3; one quits
 * to the menu during the intermission, the other dies early in sector 2. The records must not
 * tell them apart, while only the quit is flagged as aborted (ranked boards skip aborted runs).
 */
test('an aborted run updates the records exactly like a death at the same point', () => {
    const clearFirstSector = () => {
        const run = makeRun(3);
        run.deriveRoundEndPlan({ players: [pilot()], inputs: { reason: '' }, baseController });
        run.handleRoundEndTelemetry({ state: 'ROUND_END', duration: 30, kills: 2 });
        assert.equal(run.getPhase(), 'intermission');
        return run;
    };

    const quit = clearFirstSector();
    quit.resetRunState();

    const died = clearFirstSector();
    died.beginNextSector();
    died.deriveRoundEndPlan({ players: [{ ...pilot(), alive: false, hp: 0 }], inputs: { reason: '' }, baseController });
    died.handleRoundEndTelemetry({ state: 'MATCH_END', duration: 3, kills: 0 });
    assert.equal(died.getStateSnapshot().postRunSummary.aborted, false);

    const pick = (records) => ({
        bestScore: records.bestScore, lastScore: records.lastScore, bestSector: records.bestSector,
        lastSector: records.lastSector, runsPlayed: records.runsPlayed,
    });
    assert.ok(died._records.bestScore > 0, 'the cleared sector scored points');
    assert.deepEqual(pick(quit._records), pick(died._records), 'quitting and dying leave the same records');
});

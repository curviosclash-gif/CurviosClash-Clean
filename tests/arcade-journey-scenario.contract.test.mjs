import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArcadeEncounterPlan } from '../src/core/runtime/GameRuntimeArcadeSupportOps.js';
import { resolveArcadeJourneyRunResult } from '../src/core/arcade/ArcadeJourneyEncounterPlan.js';
import { createArcadeRunConfig } from '../src/state/arcade/ArcadeRunState.js';
import { normalizeArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { evaluateArcadeJourneyMedal, resolveArcadeJourneyAccess, ARCADE_JOURNEY_SCHEMA } from '../src/shared/contracts/ArcadeJourneyContract.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { RoundStateController } from '../src/state/RoundStateController.js';

const config = (overrides = {}) => ({ enabled: true, runType: 'gauntlet', journeyStageId: 'worm_hunt', sectorCount: 20, seed: 8, ...overrides });

test('Wurmjagd always starts the authored worm objective in exactly one locked sector', () => {
    for (const seed of [1, 3, 8, 993]) {
        const plan = buildArcadeEncounterPlan({ arcade: config({ seed }), session: { mapKey: 'empty' } });
        assert.equal(plan.sectorCount, 1);
        assert.equal(plan.sequence.length, 1);
        const entry = plan.sequence[0];
        assert.equal(entry.scenarioId, 'worm_hunt');
        assert.equal(entry.mapKey, 'standard');
        assert.equal(entry.mapKeyLocked, true);
        assert.equal(entry.objectiveId, 'destroy_units');
        assert.deepEqual([entry.objective.unitKind, entry.objective.count, entry.objective.durationSec], ['creature', 100, 120]);
        assert.equal(entry.combatProfile, 'hunt');
        assert.equal(entry.parcoursEnabled, false);
    }
});

test('scenario selection cannot replace a free run, Daily, or another runtime kind', () => {
    const run = overrides => buildArcadeEncounterPlan({ arcade: config({ sectorCount: 5, ...overrides }), session: {} });
    for (const overrides of [{ journeyStageId: '' }, { dailyChallenge: true }, { runType: 'arena_waves' }]) {
        assert.deepEqual(run(overrides), run({ ...overrides, journeyStageId: '' }));
    }
});

test('both settings boundaries enforce the authored sector count only for valid journey settings', () => {
    for (const normalize of [normalizeArcadeRunSettings, createArcadeRunConfig]) {
        assert.equal(normalize(config()).sectorCount, 1);
        assert.equal(normalize(config()).journeyStageId, 'worm_hunt');
        for (const overrides of [{ dailyChallenge: true }, { runType: 'arena_waves' }, { journeyStageId: 'unknown' }]) {
            assert.equal(normalize(config(overrides)).sectorCount, 20);
            assert.equal(normalize(config(overrides)).journeyStageId, '');
        }
    }
});

test('worm medals require the real scenario objective and use gameplay time instead of points', () => {
    const state = { config: config(), encounterSequence: [{ scenarioId: 'worm_hunt' }],
        objectiveState: { objectiveId: 'destroy_units', status: 'completed' }, gameplayTimeMs: 75000 };
    const summary = { succeeded: true, score: 999999, aborted: false };
    const result = value => resolveArcadeJourneyRunResult({ _state: value }, summary);
    assert.deepEqual(result(state), { succeeded: true, value: 75000, aborted: false });
    assert.equal(evaluateArcadeJourneyMedal('worm_hunt', result(state)), 2);
    for (const invalid of [
        { ...state, objectiveState: { objectiveId: 'destroy_units', status: 'active' } },
        { ...state, objectiveState: { objectiveId: 'destroy_units', status: 'failed' } },
        { ...state, encounterSequence: [{ scenarioId: 'bomber_alarm' }] },
    ]) assert.equal(evaluateArcadeJourneyMedal('worm_hunt', result(invalid)), 0);
    assert.equal(evaluateArcadeJourneyMedal('worm_hunt', resolveArcadeJourneyRunResult({ _state: state }, { ...summary, aborted: true })), 0);
    assert.equal(evaluateArcadeJourneyMedal('worm_hunt', resolveArcadeJourneyRunResult({ _state: state }, { ...summary, succeeded: false })), 0);
    assert.deepEqual(result({ ...state, config: config({ journeyStageId: 'first_run' }) }), { succeeded: true, value: 999999, aborted: false });
});

test('explicit full unlock includes the new stage while party limits and ordinary gates remain', () => {
    const progress = { schema: ARCADE_JOURNEY_SCHEMA, stages: {}, allStagesUnlocked: true };
    assert.equal(resolveArcadeJourneyAccess('worm_hunt', progress, { playerCount: 3 }).unlocked, true);
    assert.equal(resolveArcadeJourneyAccess('worm_hunt', progress, { playerCount: 4 }).reason, 'player_count');
    assert.equal(resolveArcadeJourneyAccess('worm_hunt', { ...progress, allStagesUnlocked: false }).unlocked, false);
});

test('the live worm goal finalizes the mission directly, with no bonus-sector continuation', () => {
    const run = new ArcadeRunRuntime({ now: () => 100000 });
    const arcade = config();
    run.configure({ arcade });
    run.startRun({ encounterPlan: buildArcadeEncounterPlan({ arcade }) });
    run.tickGameplay(61);
    for (let index = 0; index < 100; index += 1) {
        run.applyGameplayEvent({ type: 'unit_destroyed', unitKind: 'creature' });
    }
    assert.equal(run.getStateSnapshot().objectiveState.status, 'completed');
    const outcome = run.deriveRoundEndPlan({ players: [{ index: 0, isBot: false, alive: true, hp: 100 }],
        inputs: { reason: 'ARCADE_OBJECTIVE' }, baseController: new RoundStateController() });
    assert.equal(outcome.outcome.state, 'MATCH_END');
    assert.equal(run.getPhase(), 'finished');
    assert.equal(run.resolveVictoryChoice('continue'), null);
    run.handleRoundEndTelemetry({ state: 'MATCH_END', duration: 61, kills: 0 });
    const summary = run.getStateSnapshot().postRunSummary;
    assert.equal(summary.succeeded, true);
    assert.equal(summary.sectorHistory.length, 1);
    assert.ok(summary.score > 0);
    assert.ok(summary.xpEarned > 0);
    assert.equal(evaluateArcadeJourneyMedal('worm_hunt', resolveArcadeJourneyRunResult(run, summary)), 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { RoundStateController } from '../src/state/RoundStateController.js';
import { buildArcadeEncounterPlan } from '../src/core/runtime/GameRuntimeArcadeSupportOps.js';
import { resolveArcadeJourneyRunResult } from '../src/core/arcade/ArcadeJourneyEncounterPlan.js';
import { createArcadeJourneyRunBinding, settleArcadeJourneyRun } from '../src/core/arcade/ArcadeJourneyRunBinding.js';
import { getArcadeJourneyStage, evaluateArcadeJourneyMedal, getArcadeJourneyNextStage, ARCADE_JOURNEY_SCHEMA, ARCADE_JOURNEY_WORLDS } from '../src/shared/contracts/ArcadeJourneyContract.js';
import { createArcadeRunConfig } from '../src/state/arcade/ArcadeRunState.js';
import { normalizeArcadeRunSettings } from '../src/shared/contracts/ArcadeRunSettingsContract.js';
import { registerMapCatalogConfigSource } from '../src/shared/contracts/RuntimeMapCatalogContract.js';
import { NOTRE_DAME_EVOLUTION_MAPS as NOTRE_DAME_MAPS } from '../src/core/config/maps/presets/notre_dame/NotreDameEvolution.js';
import { resolveArcadeSectorRuntimeProfile } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { PARCOURS_MAPS } from '../src/core/config/maps/presets/parcours_maps.js';

registerMapCatalogConfigSource({ MAPS: { standard: {}, ...PARCOURS_MAPS, ...NOTRE_DAME_MAPS } });
const config = (extra = {}) => ({ enabled: true, runType: 'gauntlet', journeyStageId: 'notre_dame', sectorCount: 8, seed: 7, ...extra });
const plan = extra => buildArcadeEncounterPlan({ arcade: config(extra), session: { mapKey: 'wrong' } });
const human = { index: 0, isBot: false, alive: true, hp: 100 };
function start() {
    const run = new ArcadeRunRuntime({ now: () => 100000 });
    run.configure({ arcade: config() }); run.startRun({ encounterPlan: plan() });
    return run;
}
function finish(run, completionTimeMs = 220000) {
    const outcome = run.deriveRoundEndPlan({ players: [human], inputs: { reason: 'PARCOURS_COMPLETE',
        parcours: { routeId: 'notre_dame_evolution_v1', completionTimeMs, penaltyTimeMs: 2400 } }, baseController: new RoundStateController() });
    run.handleRoundEndTelemetry({ state: outcome.outcome.state, duration: 1, kills: 0 });
    return outcome;
}

test('Notre-Dame pins one complete authored course for every seed and both settings boundaries', () => {
    const stage = getArcadeJourneyStage('notre_dame');
    assert.equal(stage.mapKey, 'notre_dame'); assert.equal(stage.parcours, true);
    assert.equal(NOTRE_DAME_MAPS.notre_dame.parcours.routeId, 'notre_dame_evolution_v1');
    assert.ok(NOTRE_DAME_MAPS.notre_dame.parcours.checkpoints.some(cp => cp.nextIds?.length > 1));
    assert.ok(NOTRE_DAME_MAPS.notre_dame.missions.some(m => m.type === 'TIME_TRIAL' && m.params.target * 1000 === stage.silver));
    for (const normalize of [createArcadeRunConfig, normalizeArcadeRunSettings]) assert.equal(normalize(config()).sectorCount, 1);
    for (const seed of [1,7,82,10999]) {
        const value = plan({ seed });
        assert.equal(value.sectorCount, 1); assert.equal(value.sequence.length, 1);
        assert.deepEqual(value.sequence, plan().sequence);
        assert.equal(value.sequence[0].mapKey, 'notre_dame'); assert.equal(value.sequence[0].mapKeyLocked, true);
        assert.equal(value.sequence[0].parcoursEnabled, true); assert.equal(value.sequence[0].botCount, 0);
        assert.equal(resolveArcadeSectorRuntimeProfile(value.sequence[0]).botCount, 0);
        assert.equal(value.sequence[0].isBoss, false); assert.equal(value.sequence[0].weaponsDisabled, false);
    }
    for (const extra of [{ dailyChallenge: true }, { journeyStageId: '' }, { runType: 'arena_waves' }]) {
        assert.deepEqual(plan(extra), plan({ ...extra, journeyStageId: '' }));
        assert.equal(createArcadeRunConfig(config(extra)).sectorCount, 8);
    }
});

test('one actual course completion ends the mission, carries penalty-inclusive time and offers no extra lap', () => {
    const run = start();
    run.tickGameplay(900);
    const outcome = finish(run);
    assert.equal(outcome.outcome.state, 'MATCH_END'); assert.match(outcome.outcome.messageText, /Notre-Dame geschafft/);
    const state = run.getStateSnapshot();
    assert.equal(state.phase, 'finished'); assert.equal(state.completedSectors, 1); assert.equal(state.intermission, null);
    assert.equal(state.postRunSummary.succeeded, true); assert.equal(run.resolveVictoryChoice('continue'), null);
    const result = resolveArcadeJourneyRunResult({ _state: state }, state.postRunSummary);
    assert.equal(result.value, 220000); assert.equal(evaluateArcadeJourneyMedal('notre_dame', result), 2);
    assert.equal(state.lastCompletedSectorResult.parcours.penaltyTimeMs, 2400);
    assert.equal(state.lastCompletedSectorResult.parcours.routeId, 'notre_dame_evolution_v1');
    assert.equal(run.deriveRoundEndPlan({ players: [human], inputs: { reason: 'PARCOURS_COMPLETE' }, baseController: new RoundStateController() }), null);
});

test('time medals follow exact boundaries and cannot be replaced by score, wall time or an incomplete result', () => {
    const summary = { succeeded: true, aborted: false, score: 99999999 };
    const state = { config: config(), completedSectors: 1, gameplayTimeMs: 1,
        lastCompletedSectorResult: { parcours: { completionTimeMs: 180000 } } };
    for (const [value, medal] of [[180000,3],[180001,2],[270000,2],[270001,1]]) {
        const result = resolveArcadeJourneyRunResult({ _state: { ...state, lastCompletedSectorResult: { parcours: { completionTimeMs: value } } } }, summary);
        assert.equal(evaluateArcadeJourneyMedal('notre_dame', result), medal);
    }
    for (const value of [0,-1,NaN,Infinity,undefined]) {
        const result = resolveArcadeJourneyRunResult({ _state: { ...state, lastCompletedSectorResult: { parcours: { completionTimeMs: value } } } }, summary);
        assert.equal(result.succeeded, false); assert.equal(evaluateArcadeJourneyMedal('notre_dame', result), 0);
    }
    for (const extra of [{ succeeded: false }, { aborted: true }]) {
        assert.equal(evaluateArcadeJourneyMedal('notre_dame', resolveArcadeJourneyRunResult({ _state: state }, { ...summary,...extra })), 0);
    }
    assert.equal(resolveArcadeJourneyRunResult({ _state: { ...state, completedSectors: 0 } }, summary).succeeded, false);
    assert.equal(resolveArcadeJourneyRunResult({ _state: { ...state, config: config({ journeyStageId: 'first_run' }) } }, summary).value, summary.score);
});

test('generic arena goals cannot clear Notre-Dame and abort or party defeat cannot earn its medal', () => {
    const run = start();
    assert.equal(run.deriveRoundEndPlan({ players: [human], inputs: { reason: 'ARCADE_OBJECTIVE' }, baseController: new RoundStateController() }), null);
    assert.equal(run.getStateSnapshot().completedSectors, 0);
    for (const [reason, players] of [['ABORT',[human]], ['ELIMINATION',[{ ...human,alive:false,hp:0 }]]]) {
        const candidate = start();
        const outcome = candidate.deriveRoundEndPlan({ players, inputs: { reason }, baseController: new RoundStateController() });
        assert.equal(outcome.outcome.state, 'MATCH_END');
        candidate.handleRoundEndTelemetry({ state: 'MATCH_END', duration: 1 });
        const state = candidate.getStateSnapshot();
        assert.equal(evaluateArcadeJourneyMedal('notre_dame', resolveArcadeJourneyRunResult({ _state:state }, state.postRunSummary)), 0);
    }
});

test('new course progression follows First Run without revoking the existing earned reward conditions', () => {
    const progress = { schema: ARCADE_JOURNEY_SCHEMA, stages: { first_run:{ medals:{ normal:{ medal:1 } } } } };
    assert.equal(getArcadeJourneyNextStage('first_run', progress, 1).id, 'notre_dame');
    assert.deepEqual(ARCADE_JOURNEY_WORLDS.find(w => w.id === 'departure').rewardStageIds, ['flight_school','first_run','weapon_race']);
    assert.equal(getArcadeJourneyStage('first_run').sectorCount, 3);
});

test('one shared course time is saved separately to one, two or three captured profiles and retry is idempotent', () => {
    for (const count of [1,2,3]) {
        const ports = Array.from({ length:count }, (_, index) => {
            let value = { schema:ARCADE_JOURNEY_SCHEMA, stages:{ first_run:{ medals:{ normal:{ medal:3,runId:'old' } } } },
                boards:{ 'first_run:normal:1':[{runId:'old',value:99999,medal:3,playerCount:1}] }, note:'preserve' };
            let attempts=0;
            return { get value(){return value;}, get attempts(){return attempts;},
                readJsonRecordResult:()=>({status:'found',value:structuredClone(value)}),
                saveJsonRecord(_key,next){ attempts++; if(index===1 && attempts===1)return false;value=structuredClone(next);return true; } };
        });
        const binding = createArcadeJourneyRunBinding({ stageId:'notre_dame',runType:'gauntlet',tierId:'normal',runId:'nd-run',
            participants:ports.map((store,index)=>({profileId:`p${index}`,store})) });
        settleArcadeJourneyRun(binding,{succeeded:true,value:220000});
        const result = settleArcadeJourneyRun(binding,{succeeded:true,value:1});
        assert.equal(result.status,'finished');assert.equal(result.medal,2);assert.equal(result.result.value,220000);
        for (const [index,port] of ports.entries()) {
            assert.equal(port.value.stages.notre_dame.medals.normal.medal,2);
            assert.equal(port.value.boards[`notre_dame:normal:${count}`][0].value,220000);
            assert.equal(port.value.stages.first_run.medals.normal.runId,'old');
            assert.equal(port.value.boards['first_run:normal:1'][0].value,99999);assert.equal(port.value.note,'preserve');
            assert.equal(port.attempts,index===1?2:1);
        }
    }
});

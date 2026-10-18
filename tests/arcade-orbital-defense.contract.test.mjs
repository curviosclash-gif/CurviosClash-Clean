import test from 'node:test';
import assert from 'node:assert/strict';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { RoundStateController } from '../src/state/RoundStateController.js';
import { buildArcadeEncounterPlan } from '../src/core/runtime/GameRuntimeArcadeSupportOps.js';
import { resolveArcadeJourneyRunResult } from '../src/core/arcade/ArcadeJourneyEncounterPlan.js';
import { resolveArcadeSectorRuntimeProfile } from '../src/entities/directors/ArcadeEncounterCatalog.js';
import { getArcadeJourneyStage, evaluateArcadeJourneyMedal, ARCADE_JOURNEY_WORLDS, resolveArcadeJourneyAccess } from '../src/shared/contracts/ArcadeJourneyContract.js';
import { registerMapCatalogConfigSource } from '../src/shared/contracts/RuntimeMapCatalogContract.js';
import { ORBITAL_SHIPYARD_MAPS } from '../src/core/config/maps/presets/orbital_shipyard/index.js';
import { ORBITAL_JOURNEY_SCENARIO_ID, ORBITAL_JOURNEY_TURRETS } from '../src/shared/contracts/OrbitalJourneyDefenseContract.js';
import { StaticTurretSystem } from '../src/entities/systems/StaticTurretSystem.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { EntitySetupOps } from '../src/entities/runtime/EntitySetupOps.js';
import { resolveEntityRuntimeConfig } from '../src/shared/contracts/EntityRuntimeConfig.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';

registerMapCatalogConfigSource({ MAPS: { standard: {}, ...ORBITAL_SHIPYARD_MAPS } });
const arcade = extra => ({ enabled: true, runType: 'gauntlet', journeyStageId: 'orbital_shipyard', sectorCount: 8, seed: 9, ...extra });
const plan = extra => buildArcadeEncounterPlan({ arcade: arcade(extra), session: { mapKey: 'wrong' } });
const human = { index: 0, isBot: false, alive: true, hp: 100 };

test('Orbital mission pins one authored course, two attacking bots and no race or random encounter', () => {
    const stage = getArcadeJourneyStage('orbital_shipyard');
    assert.equal(stage.silver, ORBITAL_SHIPYARD_MAPS.orbital_shipyard.missions.find(m => m.type === 'TIME_TRIAL').params.target * 1000);
    for (const seed of [1,9,323]) {
        const value = plan({ seed }); assert.equal(value.sectorCount, 1); assert.equal(value.sequence.length, 1);
        assert.deepEqual(value.sequence, plan().sequence);
        const p = resolveArcadeSectorRuntimeProfile(value.sequence[0]);
        assert.equal(p.mapKey, 'orbital_shipyard'); assert.equal(p.botCount, 2); assert.equal(p.parcoursEnabled, true);
        assert.equal(p.parcoursRacer, false); assert.equal(p.scenarioId, ORBITAL_JOURNEY_SCENARIO_ID);
        assert.equal(p.combatProfile, 'hunt'); assert.equal(p.weaponsDisabled, false); assert.ok(p.aggressiveness > 0);
    }
    for (const extra of [{ dailyChallenge: true }, { journeyStageId: '' }, { runType: 'arena_waves' }]) {
        assert.deepEqual(plan(extra), plan({ ...extra, journeyStageId: '' }));
    }
    assert.equal(resolveArcadeSectorRuntimeProfile({ templateId:'sector_parcours', parcoursEnabled:true }).parcoursRacer, true);
});

test('explicit combat bots choose the Hunt policy even after the parcours sector is activated', () => {
    const types = [], profile = resolveArcadeSectorRuntimeProfile(plan().sequence[0]);
    const owner = { renderer:{addToScene(){},removeFromScene(){},getGraphicsStyle:()=> 'modern'},
        entityRuntimeConfig:resolveEntityRuntimeConfig({}), runtimeConfig:{arcade:{...arcade(),...profile},bot:{policyStrategy:'auto'}},
        arena:{currentMapDefinition:null},players:[],humanPlayers:[],bots:[],botByPlayer:new Map(),botDifficulty:'NORMAL',botPolicyType:'rule-based',
        botPolicyRegistry:{create(type){types.push(type);return {setSensePhase(){}};}},
        gameModeStrategy:{isSectorParcours:()=>true,isEndlessParcours:()=>false},combatModeType:'HUNT' };
    try {
        new EntitySetupOps(owner).setupBotPlayers(1,2,{botTeamIds:[],botVehicleIds:['ship5'],defaultVehicleId:'ship5',modelScale:1});
        assert.deepEqual(types,['hunt','hunt']); assert.ok(owner.players.every(p=>p.isArcadeParcoursCompetitor===false));
    } finally { for (const player of owner.players) player.dispose(); }
});

function turrets(extra = {}, mapKey = 'orbital_shipyard') {
    const config = { ...arcade(), scenarioId:ORBITAL_JOURNEY_SCENARIO_ID, ...extra };
    const strategy = new ArcadeModeStrategy({runType:'gauntlet',combatProfile:'hunt'});
    strategy.setSectorType('sector_parcours'); strategy.setScenarioId(config.scenarioId);
    const manager = {runtimeConfig:{arcade:config},gameModeStrategy:strategy,
        arena:{currentMapKey:mapKey,currentMapDefinition:ORBITAL_SHIPYARD_MAPS.orbital_shipyard}};
    const system = new StaticTurretSystem(manager);
    system._createTurret = definition => ({ ...definition });
    system.clear = () => {system.turrets=[];};
    try { system.startRound(); return system.turrets; } finally { system.dispose(); }
}
test('exactly two rocket and two MG turrets belong only to this active mission/map', () => {
    const values = turrets(); assert.equal(values.length, 4);
    assert.equal(values.filter(t=>t.weapon==='rocket').length, 2); assert.equal(values.filter(t=>t.weapon==='mg').length, 2);
    assert.ok(values.every(t=>t.destructible && t.maxHp===90 && t.respawnSeconds===0 && t.targetPlayers==='humans'));
    assert.equal(ORBITAL_SHIPYARD_MAPS.orbital_shipyard.staticTurrets, undefined);
    for (const extra of [{enabled:false},{dailyChallenge:true},{journeyStageId:''},{journeyStageId:'notre_dame'},{runType:'arena_waves'},{scenarioId:''}]) {
        assert.equal(turrets(extra).length, 0);
    }
    assert.equal(turrets({},'notre_dame').length, 0);
    assert.equal(new Set(ORBITAL_JOURNEY_TURRETS.map(t=>t.id)).size,4);
});

test('only a real course finish earns a time medal, including penalties; kills cannot settle the mission', () => {
    const runtime = new ArcadeRunRuntime({now:()=>100000});runtime.configure({arcade:arcade()});runtime.startRun({encounterPlan:plan()});
    const baseController = new RoundStateController();
    assert.equal(runtime.deriveRoundEndPlan({players:[human],inputs:{reason:'ELIMINATION'},baseController}),null);
    assert.equal(runtime.deriveRoundEndPlan({players:[human],inputs:{reason:'ARCADE_OBJECTIVE'},baseController}),null);
    const outcome=runtime.deriveRoundEndPlan({players:[human],inputs:{reason:'PARCOURS_COMPLETE',parcours:{routeId:'orbital_shipyard_v1',completionTimeMs:102400,penaltyTimeMs:2400}},baseController});
    assert.equal(outcome.outcome.state,'MATCH_END');runtime.handleRoundEndTelemetry({state:'MATCH_END',duration:1});
    const state=runtime.getStateSnapshot(),result=resolveArcadeJourneyRunResult({_state:state},state.postRunSummary);
    assert.equal(result.value,102400);assert.equal(evaluateArcadeJourneyMedal('orbital_shipyard',result),2);
    assert.equal(state.intermission,null);assert.equal(runtime.resolveVictoryChoice('continue'),null);
    for(const [value,medal] of [[100000,3],[100001,2],[150000,2],[150001,1]])assert.equal(evaluateArcadeJourneyMedal('orbital_shipyard',{succeeded:true,value}),medal);
    assert.equal(evaluateArcadeJourneyMedal('orbital_shipyard',{succeeded:true,value:1,aborted:true}),0);
});

test('attacking bots are not time-trial entrants and the mission keeps historic badge requirements', () => {
    const system=new ParcoursProgressSystem({runtimeConfig:{arcade:{scenarioId:ORBITAL_JOURNEY_SCENARIO_ID}}});
    system._route={};
    assert.equal(system.updatePlayerProgress({index:1,isBot:true,alive:true},{},1000),null);
    assert.equal(resolveArcadeJourneyAccess('orbital_shipyard',{schema:'arcade-journey.v1',stages:{}}).unlocked,false);
    assert.equal(resolveArcadeJourneyAccess('orbital_shipyard',{schema:'arcade-journey.v1',stages:{notre_dame:{medals:{normal:{medal:1}}}}}).unlocked,false);
    assert.equal(resolveArcadeJourneyAccess('orbital_shipyard',{schema:'arcade-journey.v1',stages:{bridge_convoy:{completed:true}}}).unlocked,true);
    assert.ok(ARCADE_JOURNEY_WORLDS.every(w=>!w.rewardStageIds.includes('orbital_shipyard')));
});

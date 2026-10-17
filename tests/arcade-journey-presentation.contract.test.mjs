import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCADE_JOURNEY_MAP_NODES as nodes } from '../src/shared/contracts/ArcadeJourneyMapContract.js';
import { ARCADE_JOURNEY_STAGES as stages, ARCADE_JOURNEY_SCHEMA, resolveArcadeJourneyAccess } from '../src/shared/contracts/ArcadeJourneyContract.js';
import { resolveJourneyNodeState, nextJourneyNode, journeyMedalTarget } from '../src/shared/contracts/ArcadeJourneyPresentationContract.js';

test('map access and next recommendation match every predecessor/party/exception combination', () => {
    for (let mask = 0; mask < 2 ** stages.length; mask++) {
        const medals = Object.fromEntries(stages.filter((_, i) => mask & (1 << i)).map(stage => [stage.id, {medals:{normal:{medal:1}}}]));
        for (const playerCount of [1,2,3,4]) for (const legacyAccess of [false,true]) for (const allStagesUnlocked of [false,true]) {
            const progress = {schema:ARCADE_JOURNEY_SCHEMA, stages:medals, allStagesUnlocked};
            const context = {progress,playerCount,legacyAccess,available:true};
            for (const node of nodes.filter(node => node.stageId)) assert.equal(resolveJourneyNodeState(node,context).unlocked,resolveArcadeJourneyAccess(node.stageId,progress,context).unlocked,node.id);
            const next=nextJourneyNode(nodes,context);
            if(next){assert.equal(resolveJourneyNodeState(next,context).unlocked,true);assert.equal(medals[next.stageId],undefined);}
        }
    }
});

test('invalid saved medal values never claim that all medals were earned', () => {
    for(const medal of [4,Infinity,NaN,1.5,-1,'3']) assert.match(journeyMedalTarget(stages.find(stage=>stage.id==='notre_dame'),{stages:{notre_dame:{medals:{normal:{medal}}}}},'normal',1,[]),/Nächstes Ziel: Bronze/);
});

test('development and unreadable data never inherit special access or claim lost medals', () => {
    const context={progress:{schema:ARCADE_JOURNEY_SCHEMA,stages:{},allStagesUnlocked:true},playerCount:1,legacyAccess:true,available:false};
    assert.equal(nextJourneyNode(nodes,context),null);
    for(const node of nodes){const state=resolveJourneyNodeState(node,context);if(node.development){assert.equal(state.unlocked,false);assert.equal(state.free,false);}if(node.stageId){assert.equal(state.unlocked,false);assert.equal(state.reason,'unavailable');}}
    assert.equal(resolveJourneyNodeState(nodes.find(node=>node.id==='portal_chain_k19'),context).free,true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeDocument } from './helpers/fake-hangar-dom.mjs';
import { ArcadeEndlessHudSection } from '../src/ui/arcade/ArcadeEndlessHudSection.js';
import { EndlessParcoursRuntime } from '../src/entities/endless/EndlessParcoursRuntime.js';
import { buildEndlessParcoursBlocks } from '../src/ui/postmatch/PostMatchParcoursBlocks.js';

const create=fakeDocument.createElement;fakeDocument.createElement=tag=>Object.assign(create(tag),{style:{},removeChild(child){this.children=this.children.filter(n=>n!==child);child.parentElement=null;return child;}});
fakeDocument.body=fakeDocument.createElement('body');

test('compact endless HUD shows the five metrics beside existing points and streak, while retaining safety warnings',()=>{
    const hud=new ArcadeEndlessHudSection();
    const state={maxProgressMeters:1234,wave:{number:4,phase:'attack',remainingSeconds:12},revives:2,maxRevives:3,
        biomeId:'crystal',submerged:true,streakMultiplier:2,streakRemainingSeconds:3,reviveArmed:true,
        spawnWarning:{side:'left'},voidWarning:{active:true,remainingMeters:15},
        survivalSeconds:999,botKills:999,recordScore:999,newMilestones:['old-extra-info']};
    hud.update(state);
    assert.deepEqual(hud.element.querySelectorAll('.arcade-score-hud-metric-label').map(n=>n.textContent),['Distanz','Welle','Rettungen','Zone','Wasser']);
    assert.deepEqual(hud.element.querySelectorAll('.arcade-score-hud-metric-value').map(n=>n.textContent),['1234 m','4 · Angriff · 12 s','2 / 3','Kristallhöhle','Unter Wasser']);
    assert.equal(hud.element.querySelectorAll('.arcade-endless-streak-value')[0].textContent,'x2.0');
    assert.equal(hud._streakDecay.style.transform,'scaleX(0.500)');
    assert.equal(hud._spawnWarning.style.display,'block');assert.equal(hud._voidWarning.style.display,'flex');
    assert.equal(hud._reviveBadge.style.display,'block');
    hud.update({...state,submerged:false,revives:3,reviveArmed:false,spawnWarning:null,voidWarning:null});
    assert.equal(hud._values.water.textContent,'Trocken');assert.equal(hud._values.rescues.textContent,'3 / 3');
    assert.equal(hud._reviveBadge.style.display,'none');assert.equal(hud._spawnWarning.style.display,'none');
    hud.hide();assert.equal(hud.element.style.display,'none');assert.equal(hud._overlay.style.display,'none');hud.dispose();
});

test('HUD water and rescue counters come from the actual player and runtime, not a planned wet module',()=>{
    const human={waterSubmerged:false},r=new EndlessParcoursRuntime({baseSeed:130202,entityManager:{humanPlayers:[human],bots:[]}});
    try {
        r.reviveCount=3;human.waterSubmerged=true;
        const state=r.getHudState();assert.equal(state.submerged,true);assert.equal(state.revives,3);assert.equal(state.maxRevives,3);
        assert.equal(state.reviveArmed,false);assert.equal(state.biomeId,r.activeModules.get(r.currentModuleIndex).biomeId);
        human.waterSubmerged=false;assert.equal(r.getHudState().submerged,false);
    } finally {r.dispose();}
});

test('removed live details remain available on the actual end-of-run result board',()=>{
    const r=new EndlessParcoursRuntime({baseSeed:130202,entityManager:{humanPlayers:[],bots:[]}});
    try {
        r.survivalSeconds=95;r.botKills=4;r.checkpointsPassed=2;r.completedModules=5;r.reviveCount=2;
        const summary=r.finalize('ENDLESS_PLAYER_DEATH',{persist:false});
        const blocks=buildEndlessParcoursBlocks({parcours:{endlessSummary:summary}}),detail=blocks.find(b=>b.id==='endless-parcours-detail');
        const rows=new Map(detail.rows.map(row=>[row.key,row.value]));
        assert.equal(rows.get('kills'),4);assert.equal(rows.get('gates'),2);assert.equal(rows.get('modules'),5);assert.equal(rows.get('revives'),2);
        assert.equal(rows.get('zone'),'Industrie');assert.equal(rows.get('threat'),'INTRO');
        assert.equal(blocks[0].rows.find(row=>row.key==='survival').value,95);
    } finally {r.dispose();}
});

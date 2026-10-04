import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ARCADE_COLORS_STORAGE_KEY, createArcadeColorProgress, loadArcadeColors, trackArcadeColorEvent, unlockArcadeColors, filterArcadePartColors } from '../src/shared/contracts/ArcadeColorProgressContract.js';
import { emitArcadeDamageEvent } from '../src/entities/runtime/EntityArcadeGameplayEvents.js';
import { resolveArcadeMilestoneCosmetics, selectArcadeMilestoneCosmetic } from '../src/shared/contracts/ArcadeMilestoneCosmeticContract.js';
import { resolveArcadeVehicleActiveStats } from '../src/shared/contracts/ArcadeVehicleActiveStatsContract.js';
import { resolvePlayerMachineGunConfig } from '../src/hunt/mg/MGConfigResolver.js';
import { applyArcadeMilestonePattern } from '../src/shared/vehicle-lab/ArcadeMilestoneAppearance.js';
import { readArcadeVehicleProfileRecord } from '../src/shared/contracts/ArcadeVehicleProfileContract.js';

function store(){const values=new Map();return {values,readJsonRecordResult:key=>values.has(key)?{status:'found',value:values.get(key)}:{status:'missing'},loadJsonRecord:(key,fallback)=>values.get(key)??fallback,saveJsonRecord:(key,value)=>{values.set(key,structuredClone(value));return true;}};}
function run(options={}){const s=store();return {s,progress:createArcadeColorProgress({runType:'gauntlet',storesByIndex:{0:s},...options})};}
const colors=s=>loadArcadeColors(s).unlockedColorIds;

test('Frost needs an actually completed clean sector and any shield contact breaks it',()=>{
    const {s,progress}=run();
    const human={index:0,isBot:false,hp:100,maxHp:100};
    const events=[];emitArcadeDamageEvent({players:[human],onArcadeGameplayEvent:event=>{events.push(event);trackArcadeColorEvent(progress,event);}},{target:human,damageResult:{applied:0,absorbedByShield:5}});
    assert.deepEqual(events.map(event=>event.type),['shield_hit']);
    assert.deepEqual(colors(s),['standard']);
    trackArcadeColorEvent(progress,{type:'sector_complete'});
    assert.deepEqual(colors(s),['standard']);
    trackArcadeColorEvent(progress,{type:'sector_complete'});
    assert.ok(colors(s).includes('frost'));
    const failed=run();trackArcadeColorEvent(failed.progress,{type:'run_complete',succeeded:false});assert.deepEqual(colors(failed.s),['standard']);
});

test('ten credited kills belong to one human and one run; ambient bot removal grants nothing',()=>{
    const first=store(),second=store();
    const progress=createArcadeColorProgress({runType:'arena_waves',storesByIndex:{0:first,1:second},humanIndices:[0,1]});
    for(let n=0;n<15;n++)trackArcadeColorEvent(progress,{type:'kill',count:0,victimIndex:9});
    for(let n=0;n<9;n++)trackArcadeColorEvent(progress,{type:'kill',count:1,playerIndex:0});
    trackArcadeColorEvent(progress,{type:'kill',count:1,playerIndex:1});assert.deepEqual(colors(first),['standard']);
    trackArcadeColorEvent(progress,{type:'kill',count:1,playerIndex:0});assert.ok(colors(first).includes('ember'));assert.deepEqual(colors(second),['standard']);
    assert.equal(createArcadeColorProgress({runType:'weapon_race'}),null);assert.equal(createArcadeColorProgress({runType:'hangar_test'}),null);
});

test('Ion requires improving an existing time; Solar requires successful Daily',()=>{
    const {s,progress}=run({dailyChallenge:true});
    trackArcadeColorEvent(progress,{type:'best_time',playerIndex:0,previousBestTimeMs:0,totalTimeMs:100});
    trackArcadeColorEvent(progress,{type:'run_complete',succeeded:false});assert.deepEqual(colors(s),['standard']);
    trackArcadeColorEvent(progress,{type:'best_time',playerIndex:0,previousBestTimeMs:100,totalTimeMs:100});assert.deepEqual(colors(s),['standard']);
    trackArcadeColorEvent(progress,{type:'best_time',playerIndex:0,previousBestTimeMs:100,totalTimeMs:90});assert.ok(colors(s).includes('ion'));
    trackArcadeColorEvent(progress,{type:'run_complete',succeeded:true});assert.ok(colors(s).includes('solar'));
    const normal=run();trackArcadeColorEvent(normal.progress,{type:'run_complete',succeeded:true});assert.ok(!colors(normal.s).includes('solar'));
});

test('Violet needs reaching wave ten; Prism needs nightmare success or ten completed waves',()=>{
    for(const runType of ['arena_waves','endless_parcours']){
        const {s,progress}=run({runType,tierId:'nightmare'});
        trackArcadeColorEvent(progress,{type:'wave_reached',wave:10});assert.ok(colors(s).includes('violet'));assert.ok(!colors(s).includes('prism'));
        trackArcadeColorEvent(progress,{type:'run_complete',succeeded:false});trackArcadeColorEvent(progress,{type:'wave_complete',completedWaves:9});assert.ok(!colors(s).includes('prism'));
        trackArcadeColorEvent(progress,{type:'wave_complete',completedWaves:10});assert.ok(colors(s).includes('prism'));
    }
    const gauntlet=run({tierId:'nightmare'});trackArcadeColorEvent(gauntlet.progress,{type:'run_complete',succeeded:false});assert.ok(!colors(gauntlet.s).includes('prism'));
    trackArcadeColorEvent(gauntlet.progress,{type:'run_complete',succeeded:true});assert.ok(colors(gauntlet.s).includes('prism'));
});

test('color writes protect future/unreadable data and failed writes; legacy selections normalize safely',()=>{
    const s=store();s.values.set(ARCADE_COLORS_STORAGE_KEY,{schemaVersion:'future',unlockedColorIds:['mystery']});
    assert.deepEqual(unlockArcadeColors(s,['frost']),[]);assert.equal(s.values.get(ARCADE_COLORS_STORAGE_KEY).schemaVersion,'future');
    const failed=store();failed.saveJsonRecord=()=>({success:false});assert.deepEqual(unlockArcadeColors(failed,['frost']),[]);assert.deepEqual(colors(failed),['standard']);
    const read=readArcadeVehicleProfileRecord({ship5:{vehicleId:'ship5',xp:5000,xpBank:3000,trailStyleId:'acid',weaponStyleIds:{mg:'nova'}}});
    assert.equal(read.profiles.ship5.trailStyleId,'standard');assert.equal(read.profiles.ship5.weaponStyleIds.mg,'standard');assert.equal(read.profiles.ship5.xpBank,3000);
    assert.deepEqual(filterArcadePartColors({Hull:{color:0xabcdef,scale:1.1}},null),{Hull:{scale:1.1}});
});

test('milestone cosmetics remain freely selectable, have no level cap and never spend XP',()=>{
    const profile={vehicleId:'arcade_lab_1',level:150,xp:100000,xpBank:1200};
    const title=selectArcadeMilestoneCosmetic(profile,'milestoneTitleLevel',20);assert.equal(title.ok,true);assert.equal(title.profile.xpBank,1200);
    assert.equal(resolveArcadeMilestoneCosmetics(title.profile).title,'Meister 20');assert.equal(resolveArcadeMilestoneCosmetics(profile).earnedLevel,150);
    assert.equal(selectArcadeMilestoneCosmetic(profile,'milestoneBadgeLevel',160).ok,false);
    assert.equal(selectArcadeMilestoneCosmetic({...profile,vehicleId:'ship5'},'milestonePatternId','grid').ok,false);
    assert.equal(selectArcadeMilestoneCosmetic({...profile,level:10},'milestonePatternId','grid').ok,false);
});

test('seven MG masteries change only shot presentation, starting at level sixty',()=>{
    assert.equal(resolveArcadeMilestoneCosmetics({level:59}).masterCount,0);assert.equal(resolveArcadeMilestoneCosmetics({level:60}).masterCount,1);assert.equal(resolveArcadeMilestoneCosmetics({level:120}).masterCount,7);
    const profile={level:59,selectedMachineGunId:'vector_m7',mgLevel:5};
    const before=resolveArcadeVehicleActiveStats('ship5',profile),after=resolveArcadeVehicleActiveStats('ship5',{...profile,level:60});
    const base={DAMAGE:10,FIRE_INTERVAL:0.1,RANGE:90};
    const ordinary=resolvePlayerMachineGunConfig(base,{arcadeWeaponLoadout:before.weaponLoadout});const mastered=resolvePlayerMachineGunConfig(base,{arcadeWeaponLoadout:after.weaponLoadout});
    for(const key of Object.keys(ordinary).filter(key=>!key.startsWith('TRACER_')))assert.deepEqual(mastered[key],ordinary[key],key);
    assert.ok(mastered.TRACER_MUZZLE_SCALE>ordinary.TRACER_MUZZLE_SCALE);
});

test('Lab patterns decorate materials without changing geometry and release owned textures',()=>{
    const mesh=new THREE.Group();mesh.isModularVehicle=true;const material=new THREE.MeshStandardMaterial();const geometry=new THREE.BoxGeometry(1,2,3);const body=new THREE.Mesh(geometry,material);mesh.add(body);
    const profile={vehicleId:'arcade_lab_1',level:20,milestonePatternId:'grid'};applyArcadeMilestonePattern(mesh,profile);const texture=material.map;assert.ok(texture?.isDataTexture);assert.equal(body.geometry,geometry);
    let disposed=false;texture.addEventListener('dispose',()=>{disposed=true;});applyArcadeMilestonePattern(mesh,{...profile,vehicleId:'ship5'});assert.equal(material.map,null);assert.equal(disposed,true);geometry.dispose();material.dispose();
});

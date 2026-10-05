import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ARCADE_COLORS_STORAGE_KEY, createArcadeColorProgress, loadArcadeColors, trackArcadeColorEvent, unlockArcadeColors, filterArcadePartColors } from '../src/shared/contracts/ArcadeColorProgressContract.js';
import { emitArcadeDamageEvent } from '../src/entities/runtime/EntityArcadeGameplayEvents.js';
import { resolveArcadeMilestoneCosmetics, selectArcadeMilestoneCosmetic } from '../src/shared/contracts/ArcadeMilestoneCosmeticContract.js';
import { resolveArcadeVehicleActiveStats } from '../src/shared/contracts/ArcadeVehicleActiveStatsContract.js';
import { resolvePlayerMachineGunConfig } from '../src/hunt/mg/MGConfigResolver.js';
import { HUNT_CONFIG } from '../src/hunt/HuntConfig.js';
import { arcadeMachineGunSelectionLabel, progressionDetailText } from '../src/ui/hangar/HangarWorkshopRenderText.js';
import { MGTracerFx } from '../src/hunt/mg/MGTracerFx.js';
import { ARCADE_MACHINE_GUN_IDS } from '../src/shared/contracts/ArcadeMachineGunContract.js';
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

test('seven MG masteries change only shot presentation at levels sixty through one hundred twenty',()=>{
    assert.equal(resolveArcadeMilestoneCosmetics({level:59}).masterCount,0);
    assert.deepEqual([60,70,80,90,100,110,120].map(level=>resolveArcadeVehicleActiveStats(
        'ship5',{level,selectedMachineGunId:'vector_m7'},
    ).weaponLoadout.masterCount),[1,2,3,4,5,6,7]);
    const profile={level:59,selectedMachineGunId:'vector_m7',mgLevel:5};
    const ordinaryLoadout=resolveArcadeVehicleActiveStats('ship5',profile).weaponLoadout;
    const ordinary=resolvePlayerMachineGunConfig(HUNT_CONFIG.MG,{arcadeWeaponLoadout:ordinaryLoadout});
    const level60Loadout=resolveArcadeVehicleActiveStats('ship5',{...profile,level:60}).weaponLoadout;
    const level60=resolvePlayerMachineGunConfig(HUNT_CONFIG.MG,{arcadeWeaponLoadout:level60Loadout});
    assert.equal(ordinaryLoadout.masterCount,0);
    assert.equal(level60Loadout.masterCount,1);
    assert.notEqual(ordinary.TRACER_STYLE,'master-sunflare');
    assert.equal(level60.TRACER_STYLE,'master-sunflare');
    const configs=ARCADE_MACHINE_GUN_IDS.map(machineGunId=>({
        ordinary:resolvePlayerMachineGunConfig(HUNT_CONFIG.MG,{arcadeWeaponLoadout:{...ordinaryLoadout,machineGunId,masterCount:0}}),
        mastered:resolvePlayerMachineGunConfig(HUNT_CONFIG.MG,{arcadeWeaponLoadout:{...ordinaryLoadout,machineGunId,masterCount:7}}),
    }));
    const masterConfigs=configs.map(({mastered})=>mastered);
    for(const {ordinary:base,mastered} of configs){
        for(const key of Object.keys(base).filter(key=>!key.startsWith('TRACER_')))assert.deepEqual(mastered[key],base[key],key);
    }
    assert.equal(new Set(masterConfigs.map(config=>config.TRACER_STYLE)).size,7);
    assert.equal(new Set(masterConfigs.map(config=>config.TRACER_MUZZLE_COLOR)).size,7);
    assert.equal(arcadeMachineGunSelectionLabel('Vektor M7',true,false),'Vektor M7 · ausgewählt');
    assert.equal(arcadeMachineGunSelectionLabel('Vektor M7',false,true),'Vektor M7');
    assert.equal(arcadeMachineGunSelectionLabel('Vektor M7',true,true),'Vektor M7 · ausgewählt · Meister');
    assert.match(progressionDetailText({level:59,xpForNextLevel:100,xpRemaining:1}),/MG-Meisterung.*60/);
    for (const [level, next] of [[9,10],[59,60],[120,130]]) assert.match(progressionDetailText({level,xpForNextLevel:100,xpRemaining:1}),new RegExp(`Nächster Meilenstein: Level ${next}`));
    assert.match(progressionDetailText({level:120,xpForNextLevel:100,xpRemaining:1}),/Alle 7 MG-Meisterungen erreicht/);

    const meshes=[];
    const tracerFx=new MGTracerFx({renderer:{addToScene:mesh=>meshes.push(mesh)}});
    const start=new THREE.Vector3(),end=new THREE.Vector3(0,0,-20),override=0x123456;
    tracerFx.spawnTracer(start,end,false,ordinary,override);
    tracerFx.spawnTracer(start,end,false,masterConfigs[0],override);
    assert.equal(meshes[0].children[0].material.color.getHex(),override);
    assert.equal(meshes[0].children[4].material.color.getHex(),override);
    assert.equal(meshes[1].children[0].material.color.getHex(),override);
    assert.equal(meshes[1].children[4].material.color.getHex(),masterConfigs[0].TRACER_MUZZLE_COLOR);
    tracerFx.clear();
});

test('Lab patterns decorate materials without changing geometry and release owned textures',()=>{
    const mesh=new THREE.Group();mesh.isModularVehicle=true;const material=new THREE.MeshStandardMaterial();const geometry=new THREE.BoxGeometry(1,2,3);const body=new THREE.Mesh(geometry,material);mesh.add(body);
    const profile={vehicleId:'arcade_lab_1',level:20,milestonePatternId:'grid'};applyArcadeMilestonePattern(mesh,profile);const texture=material.map;assert.ok(texture?.isDataTexture);assert.equal(body.geometry,geometry);
    let disposed=false;texture.addEventListener('dispose',()=>{disposed=true;});applyArcadeMilestonePattern(mesh,{...profile,vehicleId:'ship5'});assert.equal(material.map,null);assert.equal(disposed,true);geometry.dispose();material.dispose();
});

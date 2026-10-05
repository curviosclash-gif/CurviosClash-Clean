import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCADE_HANGAR_GUIDE_STORAGE_KEY, ARCADE_HANGAR_GUIDE_SCHEMA_VERSION, createArcadeHangarGuideRecord, loadArcadeHangarGuideRecord, saveArcadeHangarGuideRecord, finishArcadeHangarTutorial, resolveArcadeHangarNextGoal, toArcadeGuideTimeMs } from '../src/shared/contracts/ArcadeHangarGuideContract.js';
import { createHangarGuideSnapshot } from '../src/ui/hangar/HangarGuideSnapshot.js';
import { ARCADE_STONE_WORKSHOP_STORAGE_KEY } from '../src/shared/contracts/ArcadeStoneWorkshopContract.js';
import { ARCADE_COLORS_STORAGE_KEY } from '../src/shared/contracts/ArcadeColorProgressContract.js';
import { PLAYER_PROFILE_RECORD_KINDS, getPlayerProfileRecordDefinitionByKind, resolvePlayerScopedStorageKey } from '../src/shared/contracts/PlayerProfileStorageContract.js';

function store() { const values=new Map();let writes=0;return { values, get writes(){return writes;}, loadJsonRecord:(key,fallback)=>values.get(key)??fallback, readJsonRecordResult:key=>values.has(key)?{status:'found',value:values.get(key)}:{status:'missing'}, saveJsonRecord:(key,value)=>{writes++;values.set(key,structuredClone(value));return true;} }; }
const profile={vehicleId:'ship5',xp:0,level:1,xpBank:0};

test('one next goal prioritizes actual free resources and finite purchases over endless weapons',()=>{
    const base={xpBank:500,offers:[{id:'mg',system:'weapons',areaId:'weapons',label:'MG',costXp:50,finite:false},{id:'size',system:'size',areaId:'size',label:'Größe',costXp:100}]};
    assert.equal(resolveArcadeHangarNextGoal(base).id,'size');
    assert.equal(resolveArcadeHangarNextGoal({...base,stones:{available:true,unplacedCount:2,freeSlotCount:1},size:{unlocked:true,freeSteps:2,canPlace:true}}).id,'place-stone');
    assert.equal(resolveArcadeHangarNextGoal({...base,stones:{available:false,unplacedCount:2,freeSlotCount:1},size:{unlocked:true,freeSteps:2,canPlace:true}}).id,'place-size');
    assert.equal(resolveArcadeHangarNextGoal({...base,xpBank:0}).group,'save');
    assert.equal(resolveArcadeHangarNextGoal({...base,offers:[],achievement:{id:'frost',system:'cosmetics',areaId:'colors',label:'Frost',detail:'Sektor ohne Treffer'}}).id,'frost');
    assert.equal(resolveArcadeHangarNextGoal({}).id,'start-run');
});

test('equal XP gaps resolve deterministically: save before level, then system and ID',()=>{
    const goal=resolveArcadeHangarNextGoal({xpBank:0,offers:[{id:'b',system:'storage',costXp:100,label:'B'},{id:'a',system:'size',costXp:100,label:'A'}],levelGates:[{id:'level',system:'stones',xpNeeded:100,label:'Level'}]});
    assert.equal(goal.id,'a');assert.equal(goal.group,'save');
    assert.equal(resolveArcadeHangarNextGoal({offers:[{id:'save',system:'size',costXp:101}],levelGates:[{id:'level',system:'stones',xpNeeded:100}]}).id,'level');
});

test('snapshot never writes or invents stone goals when the pool cannot be read',()=>{
    const s=store();s.readJsonRecordResult=key=>key===ARCADE_STONE_WORKSHOP_STORAGE_KEY?{status:'unavailable'}:{status:'missing'};
    const snapshot=createHangarGuideSnapshot({store:s,profile,profiles:{ship5:profile},draft:{stoneSlots:{}},previousVisitAt:0});
    assert.equal(snapshot.stones.available,false);assert.equal(snapshot.offers.some(offer=>offer.system==='stones'),false);
    assert.equal(snapshot.levelGates.some(gate=>gate.system==='stones'),false);assert.equal(s.writes,0);
    assert.equal(resolveArcadeHangarNextGoal(snapshot).id,'size-unlock');
    const missing=store();const fresh=createHangarGuideSnapshot({store:missing,profile,profiles:{},draft:{stoneSlots:{}},previousVisitAt:0});
    assert.equal(fresh.stones.unplacedCount,3);assert.equal(resolveArcadeHangarNextGoal(fresh).id,'place-stone');assert.equal(missing.writes,0);
});

test('shrinking never manufactures free size steps; only later achievements are new',()=>{
    const s=store();s.values.set(ARCADE_COLORS_STORAGE_KEY,{schemaVersion:'arcade-colors.v1',unlockedColorIds:['standard','frost','ion'],unlockedAt:{frost:100,ion:new Date(300).toISOString()}});
    const p={...profile,sizeWorkshopUnlocked:true,purchasedSizeSteps:2,partSizes:{hull:110,nose:80,wings:100,engines:100,utility:100}};
    const snapshot=createHangarGuideSnapshot({store:s,profile:p,profiles:{},draft:{stoneSlots:{}},previousVisitAt:200});
    assert.equal(snapshot.size.freeSteps,0);assert.deepEqual(snapshot.newColorIds,['ion']);assert.equal(s.writes,0);
    assert.ok(Number.isNaN(toArcadeGuideTimeMs('')));assert.equal(toArcadeGuideTimeMs(0),0);
});

test('next XP goals include the real MG unlock levels and the next cosmetic milestone',()=>{
    const s=store();
    const p={...profile,level:59,xp:45319};
    const snapshot=createHangarGuideSnapshot({store:s,profile:p,profiles:{},draft:{stoneSlots:{}},previousVisitAt:0});
    const milestone=snapshot.levelGates.find(gate=>gate.id==='next-milestone');
    assert.match(milestone.label,/Level 60/);assert.ok(milestone.xpNeeded>0);
    const fresh=createHangarGuideSnapshot({store:s,profile,profiles:{},draft:{stoneSlots:{}},previousVisitAt:0});
    assert.ok(fresh.levelGates.some(gate=>gate.id.startsWith('unlock-')&&gate.areaId==='weapons'&&gate.xpNeeded>0));
    assert.equal(s.writes,0);
});

test('first Hangar visit does not announce old achievements as newly unlocked',()=>{
    const s=store();
    s.values.set(ARCADE_COLORS_STORAGE_KEY,{schemaVersion:'arcade-colors.v1',unlockedColorIds:['standard','frost'],unlockedAt:{frost:100}});
    const snapshot=createHangarGuideSnapshot({store:s,profile,profiles:{},draft:{stoneSlots:{}},previousVisitAt:0});
    assert.deepEqual(snapshot.newColorIds,[]);
    assert.equal(s.writes,0);
});

test('tutorial is profile scoped, safely persisted and does not overwrite future or unreadable data',()=>{
    const first=store(),second=store();
    const finished=finishArcadeHangarTutorial(createArcadeHangarGuideRecord(),'skipped',100);
    assert.equal(saveArcadeHangarGuideRecord(first,finished),true);assert.equal(loadArcadeHangarGuideRecord(first).tutorial,'skipped');assert.equal(loadArcadeHangarGuideRecord(second).tutorial,'pending');
    const definition=getPlayerProfileRecordDefinitionByKind(PLAYER_PROFILE_RECORD_KINDS.ARCADE_HANGAR_GUIDE);
    assert.notEqual(resolvePlayerScopedStorageKey('one',definition.legacyKey),resolvePlayerScopedStorageKey('two',definition.legacyKey));
    first.values.set(ARCADE_HANGAR_GUIDE_STORAGE_KEY,{schemaVersion:'future',custom:'preserve'});
    assert.equal(loadArcadeHangarGuideRecord(first),null);assert.equal(saveArcadeHangarGuideRecord(first,finished),false);assert.equal(first.values.get(ARCADE_HANGAR_GUIDE_STORAGE_KEY).custom,'preserve');
    second.saveJsonRecord=()=>({success:false});assert.equal(saveArcadeHangarGuideRecord(second,finished),false);
    second.values.set(ARCADE_HANGAR_GUIDE_STORAGE_KEY,{schemaVersion:ARCADE_HANGAR_GUIDE_SCHEMA_VERSION,tutorial:'invalid'});assert.equal(loadArcadeHangarGuideRecord(second).tutorial,'pending');
});
